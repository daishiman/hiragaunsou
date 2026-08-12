import type { Page } from "@playwright/test";

/**
 * 「文字が重なって読めない」を機械的に見つけるための共通部品。
 *
 * これまで実際に起きた2件は、原因がまったく別物だった:
 *   1. グラフの中の描画座標の衝突 (SVGの ▲883万円 と 横軸の 7月)
 *   2. 通常のDOMのはみ出し (操作帯の負の下マージンに後続要素が食い込む)
 * どちらも「最後は画面上で文字と文字が重なる」という同じ形で表面化する。
 * だから原因ごとに守りを書くのではなく、**描かれた文字の矩形が重なっていないか**
 * という1つの物差しで両方を見る。
 *
 * この物差しの生死を分けるのは誤検出である。意図して重ねている表現
 * (バッジ・引き出し・貼り付いた帯) まで拾うと警告だらけになり、誰も見なくなって
 * 仕組みとして死ぬ。そこで「読めなくなっている重なり」だけが残るよう、
 * 収集の段階で以下を落とす (下の collectTextRects のコメント参照)。
 */

/** 画面上に描かれた「文字の塊」1つ分。座標はページ左上を原点とする実数px。 */
export interface TextRect {
  /** 収集順の通し番号 (親子関係の判定に使う) */
  id: number;
  /** 自分より上位にある収集対象の id (親子・祖先-子孫の重なりを除くため) */
  ancestors: number[];
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** 失敗メッセージ用の居場所 (例: main > section.card > p) */
  path: string;
  /** SVGの中の文字か (グラフ由来かを失敗メッセージで区別する) */
  inSvg: boolean;
  /** この文字を中に含んでいる「貼り付く部品」の番号 (StickyBox.index) */
  insideSticky: number[];
}

/** 貼り付く部品 (帯・見出し) の、貼り付きを解除した本来の位置での箱。 */
export interface StickyBox {
  index: number;
  path: string;
  /** 背景が透けないか (透ける帯は下の文字を隠さないので対象外) */
  opaque: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface StickyIntrusion {
  box: StickyBox;
  text: TextRect;
  overlapWidth: number;
  overlapHeight: number;
  ratio: number;
}

export interface Overlap {
  a: TextRect;
  b: TextRect;
  /** 横方向・縦方向それぞれの重なり量 (px) */
  overlapWidth: number;
  overlapHeight: number;
  /** 小さいほうの文字塊の面積に対する重なりの割合 (0〜1) */
  ratio: number;
}

/**
 * 重なりとみなす下限。
 *
 * 隣り合う文字は行の中で接するため、0を超えたら即失敗にすると全画面が真っ赤になる。
 * 「1文字ぶんの一部が本当に潜り込んでいる」ところから拾いたいので、
 * 縦横それぞれ2px以上かつ、小さいほうの面積の12%以上を条件にする。
 * (実際に起きた ▲883万円 × 7月 は縦16px・横20px以上の重なりで、余裕で超える)
 */
const MIN_OVERLAP_PX = 2;
const MIN_OVERLAP_RATIO = 0.12;

/**
 * 意図的に重ねている表現の許可リスト。
 *
 * ここに足すときは「なぜ読めなくならないのか」を必ず1件ずつ書く。
 * 件数が増えてきたら、それは許可リストの問題ではなく上の判定条件が
 * 間違っている合図なので、条件のほうを直すこと。
 * **失敗を0件にするためにここへ流し込むのは禁止**。この仕組みが無意味になる。
 */
export interface OverlapAllowance {
  /** 画面のパス。省略時は全画面に適用 */
  screen?: string;
  a: RegExp;
  b: RegExp;
  reason: string;
}

export const ALLOWED_OVERLAPS: readonly OverlapAllowance[] = [];

/** 許可リストに載っている組み合わせか (順不同で照合する)。 */
export function isAllowed(overlap: Overlap, screen: string): boolean {
  return ALLOWED_OVERLAPS.some((rule) => {
    if (rule.screen !== undefined && rule.screen !== screen) return false;
    const { a, b } = overlap;
    return (
      (rule.a.test(a.text) && rule.b.test(b.text)) || (rule.a.test(b.text) && rule.b.test(a.text))
    );
  });
}

/**
 * いま描かれている文字の矩形をすべて集める。
 *
 * 対象から外すもの (外さないと誤検出で埋まる):
 *   - 見えていないもの (display/visibility/opacity/中身ゼロ)。checkVisibility が祖先まで見る
 *   - aria-hidden の中身 (読み上げ対象外の飾り。凡例の色見本など)
 *   - 位置が fixed のもの (引き出し・ダイアログ。本文の上に乗せるのが仕様)
 *
 * 貼り付く帯 (sticky) は、測る直前だけ貼り付きを解除して**本来の位置**に戻してから測る。
 * 貼り付いている最中に本文の上を通過するのは仕様なので、そのまま測ると警告だらけになる。
 * 貼り付きは周りの要素の位置に影響しないので、解除しても他は1pxも動かない。
 * 併せて、その本来の位置での帯の箱 (stickyBoxes) も返す。帯の中身でない文字が箱の中に
 * 入り込んでいたら、貼り付いたときに帯がその文字を覆い隠す
 * (率マスタ設定で実際に起きた不具合。findStickyIntrusions で判定する)。
 *
 * 矩形は要素の箱ではなく **文字そのものの矩形** を使う (Range.getClientRects)。
 * 要素の箱で測ると余白やパディングまで含み、隣り合うカードが「重なった」ことになる。
 */
export async function collectTextRects(
  page: Page,
): Promise<{ rects: TextRect[]; stickyBoxes: StickyBox[] }> {
  return page.evaluate(
    ({ maxTextLength }) => {
      interface Collected {
        id: number;
        ancestors: number[];
        text: string;
        x: number;
        y: number;
        width: number;
        height: number;
        path: string;
        inSvg: boolean;
        insideSticky: number[];
      }
      interface CollectedSticky {
        index: number;
        path: string;
        opaque: boolean;
        x: number;
        y: number;
        width: number;
        height: number;
      }

      /*
        貼り付き (sticky) をいったん解除して、本来の位置に戻してから測る。
        解除しても周りの要素は動かない (貼り付きは自分の見かけの位置だけを変える仕組み)。
        測り終わったら元に戻す (この関数の最後)。
      */
      const stickied: { el: HTMLElement; original: string }[] = [];
      for (const el of Array.from(document.querySelectorAll("*"))) {
        if (!(el instanceof HTMLElement)) continue;
        if (getComputedStyle(el).position !== "sticky") continue;
        stickied.push({ el, original: el.style.position });
        el.style.position = "static";
      }

      /** その要素が「上に乗せる層」に居るか (fixed = 引き出し・ダイアログ) */
      function inFloatingLayer(start: Element): boolean {
        let el: Element | null = start;
        while (el && el !== document.body) {
          if (el instanceof HTMLElement && getComputedStyle(el).position === "fixed") return true;
          el = el.parentElement;
        }
        return false;
      }

      function describe(el: Element): string {
        const parts: string[] = [];
        let cur: Element | null = el;
        while (cur && cur !== document.body && parts.length < 4) {
          const cls = (cur.getAttribute("class") ?? "")
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .join(".");
          parts.unshift(cls ? `${cur.tagName.toLowerCase()}.${cls}` : cur.tagName.toLowerCase());
          cur = cur.parentElement;
        }
        return parts.join(" > ");
      }

      /** 測り終わった素材。id と祖先関係は全部集めてから振る (下の「祖先」の説明を参照) */
      const raw: { el: Element; text: string; rect: DOMRect; inSvg: boolean }[] = [];

      function visible(el: Element): boolean {
        if (!(el instanceof HTMLElement) && !(el instanceof SVGElement)) return false;
        if (el.closest('[aria-hidden="true"]')) return false;
        if (typeof el.checkVisibility === "function") {
          if (
            !el.checkVisibility({
              contentVisibilityAuto: true,
              opacityProperty: true,
              visibilityProperty: true,
            })
          ) {
            return false;
          }
        }
        return !inFloatingLayer(el);
      }

      /*
        祖先の枠に切り取られた後の、実際に目に入っている範囲を求める。

        文字そのものの矩形 (Range) は、祖先が overflow で切り取っていても
        切られる前の大きさで返ってくる。この差を無視すると、
          - 読み上げ専用の文字 (sr-only。1px四方に切り詰めた入れ物の中にある)
          - 高さを決めた表の枠から外に出ている行
        が「画面上の文字」として集まり、重なっていると誤って報告される。
        実際にこの2つで誤検出が出た。
      */
      interface Box {
        left: number;
        top: number;
        right: number;
        bottom: number;
      }
      const clipCache = new Map<Element, Box>();
      const NO_CLIP: Box = {
        left: -Infinity,
        top: -Infinity,
        right: Infinity,
        bottom: Infinity,
      };

      function clipOf(el: Element | null): Box {
        if (!el) return NO_CLIP;
        const cached = clipCache.get(el);
        if (cached) return cached;
        const parent = clipOf(el.parentElement);
        const style = getComputedStyle(el);
        const clips =
          style.overflowX !== "visible" || style.overflowY !== "visible" || style.clipPath !== "none";
        let box = parent;
        if (clips) {
          const own = el.getBoundingClientRect();
          const clipX = style.overflowX !== "visible" || style.clipPath !== "none";
          const clipY = style.overflowY !== "visible" || style.clipPath !== "none";
          box = {
            left: clipX ? Math.max(parent.left, own.left) : parent.left,
            top: clipY ? Math.max(parent.top, own.top) : parent.top,
            right: clipX ? Math.min(parent.right, own.right) : parent.right,
            bottom: clipY ? Math.min(parent.bottom, own.bottom) : parent.bottom,
          };
        }
        clipCache.set(el, box);
        return box;
      }

      function push(el: Element, text: string, rect: DOMRect, inSvg: boolean): void {
        if (rect.width < 1 || rect.height < 1) return;
        const clip = clipOf(el);
        const visibleRect = new DOMRect(
          Math.max(rect.left, clip.left),
          Math.max(rect.top, clip.top),
          Math.min(rect.right, clip.right) - Math.max(rect.left, clip.left),
          Math.min(rect.bottom, clip.bottom) - Math.max(rect.top, clip.top),
        );
        if (visibleRect.width < 1 || visibleRect.height < 1) return;
        // ページの外へ逃がしてある要素 (閉じた引き出しなど) は見えていない
        if (visibleRect.right + window.scrollX < 0 || visibleRect.bottom + window.scrollY < 0) return;
        raw.push({ el, text, rect: visibleRect, inSvg });
      }

      /*
        SVGの中の文字。グラフはここでしか出てこない。
        Range で測ると環境によって0が返るので、要素の矩形 (= 字の外接矩形) を使う。
      */
      for (const text of Array.from(document.querySelectorAll("svg text"))) {
        const content = (text.textContent ?? "").trim();
        if (!content || !visible(text)) continue;
        push(text, content, text.getBoundingClientRect(), true);
      }

      /*
        通常のDOMの文字。要素ではなく「テキストノード」を1つずつ測る。
        行ごとに矩形が分かれるので、折り返した長文でも行単位で正しく比較できる。
      */
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const content = (node.textContent ?? "").replace(/\s+/g, " ").trim();
        if (!content) continue;
        const parent = node.parentElement;
        if (!parent) continue;
        if (parent.closest("svg")) continue; // SVGは上で拾い済み
        if (parent.closest("script, style, title, head")) continue;
        if (!visible(parent)) continue;

        const range = document.createRange();
        range.selectNodeContents(node);
        for (const rect of Array.from(range.getClientRects())) push(parent, content, rect, false);
        range.detach();
      }

      /*
        祖先-子孫の関係は、全部集め終わってから振る。
        集めながら振ると <span><b>子</b>親</span> のように子の文字が先に出てくる並びで
        親を見落とし、親子の重なりを不具合として報告してしまう。
      */
      const idOf = new Map<Element, number>();
      for (const item of raw) if (!idOf.has(item.el)) idOf.set(item.el, idOf.size);

      /*
        本来の位置での「貼り付く部品」の箱。
        背景が透けるものは下の文字を隠さないので対象から外す。
      */
      const stickyBoxes: CollectedSticky[] = [];
      const stickyEls: HTMLElement[] = [];
      for (const { el } of stickied) {
        const style = getComputedStyle(el);
        const bg = style.backgroundColor;
        const alpha = /rgba?\([^)]*?,\s*([\d.]+)\s*\)$/.exec(bg);
        const opaque = bg !== "transparent" && bg !== "rgba(0, 0, 0, 0)" && (!alpha || Number(alpha[1]) > 0.5);
        const rect = el.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) continue;
        if (!el.checkVisibility({ contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true })) {
          continue;
        }
        stickyBoxes.push({
          index: stickyEls.length,
          path: describe(el),
          opaque,
          x: rect.left + window.scrollX,
          y: rect.top + window.scrollY,
          width: rect.width,
          height: rect.height,
        });
        stickyEls.push(el);
      }

      const out: Collected[] = raw.map((item) => {
        const ancestors: number[] = [];
        for (let cur = item.el.parentElement; cur; cur = cur.parentElement) {
          const id = idOf.get(cur);
          if (id !== undefined) ancestors.push(id);
        }
        return {
          id: idOf.get(item.el)!,
          ancestors,
          text:
            item.text.length > maxTextLength ? `${item.text.slice(0, maxTextLength)}…` : item.text,
          x: item.rect.left + window.scrollX,
          y: item.rect.top + window.scrollY,
          width: item.rect.width,
          height: item.rect.height,
          path: describe(item.el),
          inSvg: item.inSvg,
          insideSticky: stickyEls
            .map((sticky, index) => (sticky.contains(item.el) ? index : -1))
            .filter((index) => index >= 0),
        };
      });

      for (const { el, original } of stickied) el.style.position = original;

      return { rects: out, stickyBoxes };
    },
    { maxTextLength: 24 },
  );
}

/**
 * 集めた矩形の中から、重なっている組を探す。
 *
 * 全組み合わせを総当たりすると表の多い画面で数十万回になるため、
 * 上端で並べ替えて「まだ縦に届いている相手」だけを見る。
 */
export function findOverlaps(rects: readonly TextRect[]): Overlap[] {
  const sorted = [...rects].sort((a, b) => a.y - b.y);
  const found: Overlap[] = [];

  for (let i = 0; i < sorted.length; i += 1) {
    const a = sorted[i]!;
    const aBottom = a.y + a.height;
    for (let j = i + 1; j < sorted.length; j += 1) {
      const b = sorted[j]!;
      if (b.y >= aBottom - MIN_OVERLAP_PX) break; // これ以降は縦に届かない
      if (a.id === b.id) continue;
      if (a.ancestors.includes(b.id) || b.ancestors.includes(a.id)) continue;

      const overlapWidth = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const overlapHeight = Math.min(aBottom, b.y + b.height) - Math.max(a.y, b.y);
      if (overlapWidth < MIN_OVERLAP_PX || overlapHeight < MIN_OVERLAP_PX) continue;

      const smaller = Math.min(a.width * a.height, b.width * b.height);
      const ratio = (overlapWidth * overlapHeight) / smaller;
      if (ratio < MIN_OVERLAP_RATIO) continue;

      found.push({ a, b, overlapWidth, overlapHeight, ratio });
    }
  }
  return found;
}

/**
 * 貼り付く帯の「本来の位置」の箱に、帯の中身でない文字が入り込んでいないか。
 *
 * 帯は下地が透けない板なので、箱に入り込んだ文字は帯が貼り付いた瞬間に隠れて読めなくなる。
 * 文字どうしの重なりだけを見ていると、食い込みが数pxのときに見逃す
 * (率マスタ設定の不具合を再現したところ、実際に見逃した)。箱で見れば確実に捕まる。
 *
 * 帯は「画面の最後に置く」前提の部品なので、後ろに要素が続くこと自体が設計の破れである。
 * 逆に言うと、正しく最後に置いてある限りこの判定は絶対に鳴らない (誤検出しない)。
 */
export function findStickyIntrusions(
  rects: readonly TextRect[],
  boxes: readonly StickyBox[],
): StickyIntrusion[] {
  const found: StickyIntrusion[] = [];
  for (const box of boxes) {
    if (!box.opaque) continue;
    for (const text of rects) {
      if (text.insideSticky.includes(box.index)) continue; // 帯の中身
      const overlapWidth = Math.min(box.x + box.width, text.x + text.width) - Math.max(box.x, text.x);
      const overlapHeight =
        Math.min(box.y + box.height, text.y + text.height) - Math.max(box.y, text.y);
      if (overlapWidth < MIN_OVERLAP_PX || overlapHeight < MIN_OVERLAP_PX) continue;
      const ratio = (overlapWidth * overlapHeight) / (text.width * text.height);
      if (ratio < MIN_OVERLAP_RATIO) continue;
      found.push({ box, text, overlapWidth, overlapHeight, ratio });
    }
  }
  return found;
}

/** 帯に隠される文字の失敗メッセージ。 */
export function formatStickyIntrusions(where: string, items: readonly StickyIntrusion[]): string {
  const lines = items.map(
    (i) =>
      [
        `  ・貼り付く帯の下: 「${i.text.text}」が帯に隠されます`,
        `      隠れる量 ${i.overlapWidth.toFixed(1)} × ${i.overlapHeight.toFixed(1)} px` +
          ` (その文字の ${Math.round(i.ratio * 100)}%)`,
        `      帯: ${i.box.path}`,
        `      文字: ${i.text.path}`,
      ].join("\n"),
  );
  return `${where}: 貼り付く帯に隠されて読めない文字が ${items.length} 件あります\n${lines.join("\n")}`;
}

/** 失敗メッセージ。どの文字とどの文字が、どれだけ重なったかを1行ずつ出す。 */
export function formatOverlaps(where: string, overlaps: readonly Overlap[]): string {
  const lines = overlaps.map((o) => {
    const kind = o.a.inSvg || o.b.inSvg ? "グラフの中" : "画面の中";
    return [
      `  ・${kind}: 「${o.a.text}」と「${o.b.text}」が重なっています`,
      `      重なり ${o.overlapWidth.toFixed(1)} × ${o.overlapHeight.toFixed(1)} px` +
        ` (小さいほうの ${Math.round(o.ratio * 100)}%)`,
      `      ${o.a.path}`,
      `      ${o.b.path}`,
    ].join("\n");
  });
  return `${where}: 文字が重なって読めない箇所が ${overlaps.length} 件あります\n${lines.join("\n")}`;
}
