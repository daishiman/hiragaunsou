/**
 * 書き込み (注釈と黒塗り) を、元の画像そのものに焼き込む。
 *
 * ここでいう「焼き込む」は、元画像の上にレイヤーを重ねて表示することではなく、
 * 元画像のピクセルを塗りつぶして1枚の画像にしてしまうこと。
 *
 * 重ねる方式にすると、元画像と印を別々に持つことになる。持っている限り、
 * 保存先・送信の中身・後から作る書き出し機能のどこか1つで元画像が出てしまい、
 * 黒塗りは「隠したつもり」で終わる。隠した本人はそれに気づけない。
 * だから、元画像を復元できる形では一切残さない。
 *
 * この判断のために、描く処理を画面 (FeedbackWidget) から切り出してある。
 * 切り出さないと「塗った下のピクセルが本当に取れないか」をテストで確かめられない。
 */

export type Point = { x: number; y: number };

export type Shape =
  | { kind: "pen"; color: string; points: Point[] }
  | { kind: "rect"; color: string; from: Point; to: Point }
  | { kind: "arrow"; color: string; from: Point; to: Point }
  | { kind: "mask"; color: string; from: Point; to: Point }
  | { kind: "text"; color: string; at: Point; text: string };

export type Tool = Shape["kind"];

/**
 * 黒塗りの色。テーマの色ではなく、この定数を使う。
 *
 * テーマの色 (--mark-ink) は見た目のための値で、透明度が入っても壊れない。
 * だが黒塗りに半透明が混ざると、下の文字が薄く読めてしまう。
 * 隠すための道具は、見た目の設定から切り離して常に不透明の黒にする。
 */
export const MASK_COLOR = "#000000";

/** 文字の縁取りの色。濃い場所の上でも読めるようにするためだけに使う。 */
export const TEXT_OUTLINE_COLOR = "#ffffff";

/** 線の太さの基準。画像の幅に対して決めるので、大きい画像でも細くなりすぎない。 */
export function unitOf(width: number): number {
  return Math.max(2, Math.round(width / 400));
}

/**
 * 印を1つずつ、渡された描画面へ焼き込む。
 *
 * 呼ぶ側は、先に元画像を同じ描画面へ描いておく。ここでは元画像を持たない。
 */
export function paintShapes(
  ctx: CanvasRenderingContext2D,
  shapes: readonly Shape[],
  width: number,
): void {
  const unit = unitOf(width);

  for (const shape of shapes) {
    // 1つ前の印の設定を引きずらないよう、毎回そろえ直す。
    // 特に黒塗りの前に半透明が残っていると、塗ったのに下が読める状態になる。
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.lineWidth = unit;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = shape.color;
    ctx.fillStyle = shape.color;

    if (shape.kind === "pen") {
      ctx.beginPath();
      shape.points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.stroke();
    } else if (shape.kind === "rect") {
      ctx.strokeRect(shape.from.x, shape.from.y, shape.to.x - shape.from.x, shape.to.y - shape.from.y);
    } else if (shape.kind === "mask") {
      // 黒塗りだけは色を受け取らない。呼ぶ側が何を渡しても、必ず不透明の黒で塗る。
      ctx.fillStyle = MASK_COLOR;
      const { x, y, w, h } = normalizedRect(shape.from, shape.to);
      ctx.fillRect(x, y, w, h);
    } else if (shape.kind === "arrow") {
      const { from, to } = shape;
      const angle = Math.atan2(to.y - from.y, to.x - from.x);
      const head = unit * 5;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(to.x, to.y);
      ctx.lineTo(to.x - head * Math.cos(angle - 0.4), to.y - head * Math.sin(angle - 0.4));
      ctx.lineTo(to.x - head * Math.cos(angle + 0.4), to.y - head * Math.sin(angle + 0.4));
      ctx.closePath();
      ctx.fill();
    } else {
      const size = unit * 7;
      ctx.font = `700 ${size}px sans-serif`;
      ctx.textBaseline = "top";
      // 濃い場所でも読めるよう、文字の周りを白で縁取る
      ctx.strokeStyle = TEXT_OUTLINE_COLOR;
      ctx.lineWidth = unit;
      ctx.strokeText(shape.text, shape.at.x, shape.at.y);
      ctx.fillText(shape.text, shape.at.x, shape.at.y);
    }
  }
}

/**
 * 右上から左下へ引かれた四角でも、同じ範囲を指すように直す。
 *
 * 幅や高さが負のままでも canvas は塗ってくれるが、
 * 「どこを隠したか」を後から数字で確かめられなくなる。
 */
export function normalizedRect(from: Point, to: Point): { x: number; y: number; w: number; h: number } {
  return {
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    w: Math.abs(to.x - from.x),
    h: Math.abs(to.y - from.y),
  };
}
