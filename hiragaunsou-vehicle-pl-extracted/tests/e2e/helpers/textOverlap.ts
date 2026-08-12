import type { Page } from "@playwright/test";
import type {
  Overlap,
  StickyBox,
  TextRect,
} from "../../helpers/textOverlapGeometry";
import {
  finalizeStickyBox,
  finalizeTextRect,
  type ClipConstraint,
  type StickyBoxCandidate,
  type TextRectCandidate,
  type ViewportRect,
} from "../../helpers/textOverlapMeasurements";

export {
  findOverlaps,
  findStickyIntrusions,
  formatOverlaps,
  formatStickyIntrusions,
  MIN_OVERLAP_PX,
  MIN_OVERLAP_RATIO,
} from "../../helpers/textOverlapGeometry";
export type {
  Overlap,
  StickyBox,
  StickyIntrusion,
  TextRect,
} from "../../helpers/textOverlapGeometry";

/**
 * 「文字が重なって読めない」を機械的に見つけるための共通部品。
 *
 * これまで実際に起きた2件は、原因がまったく別物だった:
 *   1. グラフの中の描画座標の衝突 (SVGの ▲883万円 と 横軸の 7月)
 *   2. 通常のDOMのはみ出し (操作帯の負の下マージンに後続要素が食い込む)
 * どちらも「最後は画面上の矩形が重なる」という同じ形で表面化する。
 * だから原因ごとに守りを書くのではなく、
 *   1. 描かれた文字同士の矩形が重なっていないか
 *   2. 不透明なstickyの箱に、部品外の文字が入り込んでいないか
 * という2つの座標判定で両方を見る。
 *
 * この物差しの生死を分けるのは誤検出である。意図して重ねている表現
 * (バッジ・引き出し・貼り付いた帯) まで拾うと警告だらけになり、誰も見なくなって
 * 仕組みとして死ぬ。そこで「読めなくなっている重なり」だけが残るよう、
 * 収集の段階で以下を落とす (下の collectTextRects のコメント参照)。
 */

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
  const measured = await page.evaluate(
    ({ maxTextLength }) => {
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

      /** DOMRectはそのままではpage境界を越えられないため、数値だけのplain objectへ移す。 */
      function rectData(rect: DOMRect): ViewportRect {
        return {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        };
      }

      /** 測り終わった素材。id と祖先関係は全部集めてから振る (下の「祖先」の説明を参照) */
      const raw: { el: Element; text: string; rect: ViewportRect; inSvg: boolean }[] = [];

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
      const clipCache = new Map<Element, ClipConstraint[]>();

      function clipsOf(el: Element | null): ClipConstraint[] {
        if (!el) return [];
        const cached = clipCache.get(el);
        if (cached) return cached;
        const parent = clipsOf(el.parentElement);
        const style = getComputedStyle(el);
        const clips =
          style.overflowX !== "visible" || style.overflowY !== "visible" || style.clipPath !== "none";
        let constraints = parent;
        if (clips) {
          const clipX = style.overflowX !== "visible" || style.clipPath !== "none";
          const clipY = style.overflowY !== "visible" || style.clipPath !== "none";
          constraints = [
            ...parent,
            { rect: rectData(el.getBoundingClientRect()), clipX, clipY },
          ];
        }
        clipCache.set(el, constraints);
        return constraints;
      }

      function push(el: Element, text: string, rect: DOMRect, inSvg: boolean): void {
        raw.push({ el, text, rect: rectData(rect), inSvg });
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
        親のidを解決できない。親の直接文字とabsolute子の衝突を検出する陽性対照で使う。
      */
      const idOf = new Map<Element, number>();
      for (const item of raw) if (!idOf.has(item.el)) idOf.set(item.el, idOf.size);

      /*
        本来の位置での「貼り付く部品」の箱。
        背景が透けるものは下の文字を隠さないので対象から外す。
      */
      const stickyCandidates: StickyBoxCandidate[] = [];
      for (const [index, { el }] of stickied.entries()) {
        const style = getComputedStyle(el);
        stickyCandidates.push({
          index,
          path: describe(el),
          backgroundColor: style.backgroundColor,
          visible: el.checkVisibility({
            contentVisibilityAuto: true,
            opacityProperty: true,
            visibilityProperty: true,
          }),
          rect: rectData(el.getBoundingClientRect()),
        });
      }

      const textCandidates: TextRectCandidate[] = raw.map((item) => {
        const ancestors: number[] = [];
        for (let cur = item.el.parentElement; cur; cur = cur.parentElement) {
          const id = idOf.get(cur);
          if (id !== undefined) ancestors.push(id);
        }
        return {
          id: idOf.get(item.el)!,
          ancestors,
          text: item.text,
          rect: item.rect,
          clips: clipsOf(item.el),
          path: describe(item.el),
          inSvg: item.inSvg,
          insideSticky: stickied
            .map(({ el }, index) => (el.contains(item.el) ? index : -1))
            .filter((index) => index >= 0),
        };
      });

      for (const { el, original } of stickied) el.style.position = original;

      return {
        textCandidates,
        stickyCandidates,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
        maxTextLength,
      };
    },
    { maxTextLength: 24 },
  );

  return {
    rects: measured.textCandidates
      .map((candidate) =>
        finalizeTextRect(candidate, measured.scrollX, measured.scrollY, measured.maxTextLength),
      )
      .filter((rect): rect is TextRect => rect !== null),
    stickyBoxes: measured.stickyCandidates
      .map((candidate) => finalizeStickyBox(candidate, measured.scrollX, measured.scrollY))
      .filter((box): box is StickyBox => box !== null),
  };
}
