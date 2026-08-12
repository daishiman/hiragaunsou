import type { StickyBox, TextRect } from "./textOverlapGeometry";

/** ブラウザのviewportを原点にした、シリアライズ可能な矩形。 */
export interface ViewportRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

/** overflow / clip-path を持つ祖先1つの切り取り条件。 */
export interface ClipConstraint {
  rect: ViewportRect;
  clipX: boolean;
  clipY: boolean;
}

/** ブラウザで収集し、Node側の純粋計算へ渡す文字矩形。 */
export interface TextRectCandidate {
  id: number;
  ancestors: number[];
  text: string;
  rect: ViewportRect;
  clips: ClipConstraint[];
  path: string;
  inSvg: boolean;
  insideSticky: number[];
}

/** ブラウザで収集し、Node側の純粋計算へ渡すsticky矩形。 */
export interface StickyBoxCandidate {
  index: number;
  path: string;
  backgroundColor: string;
  visible: boolean;
  rect: ViewportRect;
}

function hasArea(rect: Pick<ViewportRect, "width" | "height">): boolean {
  return rect.width >= 1 && rect.height >= 1;
}

/** 祖先の切り取り条件を順に適用し、実際に描画される範囲を返す。 */
export function clippedRect(
  rect: ViewportRect,
  constraints: readonly ClipConstraint[],
): ViewportRect {
  let left = rect.left;
  let top = rect.top;
  let right = rect.right;
  let bottom = rect.bottom;

  for (const constraint of constraints) {
    if (constraint.clipX) {
      left = Math.max(left, constraint.rect.left);
      right = Math.min(right, constraint.rect.right);
    }
    if (constraint.clipY) {
      top = Math.max(top, constraint.rect.top);
      bottom = Math.min(bottom, constraint.rect.bottom);
    }
  }

  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

/** computed background-color が、下の文字を隠す不透明度か。 */
export function isOpaqueBackground(backgroundColor: string): boolean {
  if (backgroundColor === "transparent" || backgroundColor === "rgba(0, 0, 0, 0)") return false;
  // rgb() の第3色成分をalphaと誤認しないよう、4成分の rgba() だけを読む。
  const alpha = /^rgba\([^)]*?,\s*([\d.]+)\s*\)$/.exec(backgroundColor);
  return alpha === null || Number(alpha[1]) > 0.5;
}

/** 生の文字矩形を切り取り、ページ座標の検査用矩形へ変換する。 */
export function finalizeTextRect(
  candidate: TextRectCandidate,
  scrollX: number,
  scrollY: number,
  maxTextLength: number,
): TextRect | null {
  const rect = clippedRect(candidate.rect, candidate.clips);
  if (!hasArea(rect)) return null;
  // 左上へ逃がした閉じた部品など、ページ座標でも完全に負側にあるものは見えていない。
  if (rect.right + scrollX < 0 || rect.bottom + scrollY < 0) return null;

  return {
    id: candidate.id,
    ancestors: candidate.ancestors,
    text:
      candidate.text.length > maxTextLength
        ? `${candidate.text.slice(0, maxTextLength)}…`
        : candidate.text,
    x: rect.left + scrollX,
    y: rect.top + scrollY,
    width: rect.width,
    height: rect.height,
    path: candidate.path,
    inSvg: candidate.inSvg,
    insideSticky: candidate.insideSticky,
  };
}

/** 生のsticky矩形をページ座標の検査用矩形へ変換する。 */
export function finalizeStickyBox(
  candidate: StickyBoxCandidate,
  scrollX: number,
  scrollY: number,
): StickyBox | null {
  if (!candidate.visible || !hasArea(candidate.rect)) return null;
  return {
    index: candidate.index,
    path: candidate.path,
    opaque: isOpaqueBackground(candidate.backgroundColor),
    x: candidate.rect.left + scrollX,
    y: candidate.rect.top + scrollY,
    width: candidate.rect.width,
    height: candidate.rect.height,
  };
}
