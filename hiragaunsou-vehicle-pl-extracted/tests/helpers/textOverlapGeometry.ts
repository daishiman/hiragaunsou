/** 画面上に描かれた「文字の塊」1つ分。座標はページ左上を原点とする実数px。 */
export interface TextRect {
  /** 収集順の通し番号 (親子関係の判定に使う) */
  id: number;
  /** 自分より上位にある収集対象の id (親子関係の診断・検証用) */
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
 * 隣り合う文字は行の中で接するため、0を超えたら即失敗にすると全画面が誤検出で埋まる。
 * 「1文字ぶんの一部が本当に潜り込んでいる」ところから拾うための、縦横それぞれの下限。
 */
export const MIN_OVERLAP_PX = 2;
/** 小さいほうの文字塊の面積に対して12%以上が隠れたときだけ、不具合として扱う。 */
export const MIN_OVERLAP_RATIO = 0.12;

/** 2つの矩形が重なる横幅と縦幅を返す。離れている軸の値は負になる。 */
function intersectionOf(
  a: Pick<TextRect, "x" | "y" | "width" | "height">,
  b: Pick<TextRect, "x" | "y" | "width" | "height">,
): { width: number; height: number } {
  return {
    width: Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
    height: Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
  };
}

/** 閾値以上の交差なら、小さい矩形に占める割合を返す。そうでなければ null。 */
function qualifyingRatio(
  intersection: { width: number; height: number },
  smallerArea: number,
): number | null {
  if (intersection.width < MIN_OVERLAP_PX || intersection.height < MIN_OVERLAP_PX) return null;
  const ratio = (intersection.width * intersection.height) / smallerArea;
  return ratio < MIN_OVERLAP_RATIO ? null : ratio;
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
      // ちょうど下限ぶん重なる相手は判定対象。下限未満になって初めて走査を終える。
      if (b.y > aBottom - MIN_OVERLAP_PX) break;
      // 同じ要素の同じテキストノードが折り返してできた行同士だけを除く。
      // 祖先・子孫でも別要素の文字は別描画であり、absolute配置なら実際に衝突し得る。
      if (a.id === b.id) continue;

      const intersection = intersectionOf(a, b);
      const smallerArea = Math.min(a.width * a.height, b.width * b.height);
      const ratio = qualifyingRatio(intersection, smallerArea);
      if (ratio === null) continue;

      found.push({
        a,
        b,
        overlapWidth: intersection.width,
        overlapHeight: intersection.height,
        ratio,
      });
    }
  }
  return found;
}

/**
 * 貼り付く帯の「本来の位置」の箱に、帯の中身でない文字が入り込んでいないか。
 *
 * 帯は下地が透けない板なので、箱に入り込んだ文字は帯が貼り付いた瞬間に隠れて読めなくなる。
 */
export function findStickyIntrusions(
  rects: readonly TextRect[],
  boxes: readonly StickyBox[],
): StickyIntrusion[] {
  const found: StickyIntrusion[] = [];
  for (const box of boxes) {
    if (!box.opaque) continue;
    for (const text of rects) {
      if (text.insideSticky.includes(box.index)) continue;
      const intersection = intersectionOf(box, text);
      const ratio = qualifyingRatio(intersection, text.width * text.height);
      if (ratio === null) continue;
      found.push({
        box,
        text,
        overlapWidth: intersection.width,
        overlapHeight: intersection.height,
        ratio,
      });
    }
  }
  return found;
}

/** 帯に隠される文字の失敗メッセージ。数値の丸めもここで一元化する。 */
export function formatStickyIntrusions(
  where: string,
  items: readonly StickyIntrusion[],
): string {
  const lines = items.map(
    (item) =>
      [
        `  ・貼り付く帯の下: 「${item.text.text}」が帯に隠されます`,
        `      隠れる量 ${item.overlapWidth.toFixed(1)} × ${item.overlapHeight.toFixed(1)} px` +
          ` (その文字の ${Math.round(item.ratio * 100)}%)`,
        `      帯: ${item.box.path}`,
        `      文字: ${item.text.path}`,
      ].join("\n"),
  );
  return `${where}: 貼り付く帯に隠されて読めない文字が ${items.length} 件あります\n${lines.join("\n")}`;
}

/** どの文字が、どれだけ重なったかを示す失敗メッセージ。 */
export function formatOverlaps(where: string, overlaps: readonly Overlap[]): string {
  const lines = overlaps.map((overlap) => {
    const kind = overlap.a.inSvg || overlap.b.inSvg ? "グラフの中" : "画面の中";
    return [
      `  ・${kind}: 「${overlap.a.text}」と「${overlap.b.text}」が重なっています`,
      `      重なり ${overlap.overlapWidth.toFixed(1)} × ${overlap.overlapHeight.toFixed(1)} px` +
        ` (小さいほうの ${Math.round(overlap.ratio * 100)}%)`,
      `      ${overlap.a.path}`,
      `      ${overlap.b.path}`,
    ].join("\n");
  });
  return `${where}: 文字が重なって読めない箇所が ${overlaps.length} 件あります\n${lines.join("\n")}`;
}
