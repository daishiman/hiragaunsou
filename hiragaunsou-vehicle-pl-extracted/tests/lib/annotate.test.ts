import { describe, expect, it } from "vitest";
import { MASK_COLOR, normalizedRect, paintShapes, type Shape } from "../../app/_lib/annotate";

/**
 * 黒塗りが「隠したつもり」で終わっていないことを確かめる。
 *
 * ここで見たいのは見た目ではなく、塗った後のピクセルそのもの。
 * だから本物の canvas ではなく、色の並びを配列で持つだけの描画面を用意して、
 * paintShapes に渡す。塗った範囲から元の色が1つでも取れたら不合格。
 */
class FakeCanvas {
  readonly pixels: [number, number, number, number][][];
  globalAlpha = 1;
  globalCompositeOperation = "source-over";
  fillStyle = "#000000";
  strokeStyle = "#000000";
  lineWidth = 1;
  lineCap = "butt";
  lineJoin = "miter";
  font = "";
  textBaseline = "alphabetic";

  constructor(
    readonly width: number,
    readonly height: number,
    fill: [number, number, number, number],
  ) {
    this.pixels = Array.from({ length: height }, () =>
      Array.from({ length: width }, () => [...fill] as [number, number, number, number]),
    );
  }

  fillRect(x: number, y: number, w: number, h: number) {
    const [r, g, b] = parseColor(this.fillStyle);
    const alpha = this.globalAlpha;
    for (let py = Math.round(y); py < Math.round(y + h); py++) {
      for (let px = Math.round(x); px < Math.round(x + w); px++) {
        const row = this.pixels[py];
        const old = row?.[px];
        if (!row || !old) continue;
        // 半透明なら下の色が透ける。実際の canvas と同じ振る舞いにしておかないと、
        // 「透けていても気づかないテスト」になってしまう。
        row[px] = [
          Math.round(old[0] * (1 - alpha) + r * alpha),
          Math.round(old[1] * (1 - alpha) + g * alpha),
          Math.round(old[2] * (1 - alpha) + b * alpha),
          255,
        ];
      }
    }
  }

  colorAt(x: number, y: number): [number, number, number, number] {
    const value = this.pixels[y]?.[x];
    if (!value) throw new Error(`画面の外です: ${x},${y}`);
    return value;
  }

  /* 黒塗り以外の道具は、下の色を消さないので何もしない。 */
  beginPath() {}
  moveTo() {}
  lineTo() {}
  closePath() {}
  stroke() {}
  fill() {}
  strokeRect() {}
  strokeText() {}
  fillText() {}
}

function parseColor(css: string): [number, number, number] {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(css);
  if (m) return [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)];
  const rgba = /rgba?\(([^)]+)\)/.exec(css);
  if (rgba) {
    const [r = 0, g = 0, b = 0] = rgba[1]!.split(",").map((v) => Number(v.trim()));
    return [r, g, b];
  }
  throw new Error(`色を読めません: ${css}`);
}

/** テストの中だけの詰め物。FakeCanvas は必要な道具しか持っていない。 */
function asCtx(fake: FakeCanvas): CanvasRenderingContext2D {
  return fake as unknown as CanvasRenderingContext2D;
}

const SECRET: [number, number, number, number] = [220, 30, 40, 255];

describe("黒塗りの焼き込み", () => {
  it("塗った範囲から元のピクセルが取れない", () => {
    const canvas = new FakeCanvas(40, 20, SECRET);
    const mask: Shape = { kind: "mask", color: MASK_COLOR, from: { x: 5, y: 5 }, to: { x: 15, y: 15 } };

    paintShapes(asCtx(canvas), [mask], canvas.width);

    for (let y = 5; y < 15; y++) {
      for (let x = 5; x < 15; x++) {
        expect(canvas.colorAt(x, y)).toEqual([0, 0, 0, 255]);
      }
    }
    // 塗っていないところは元のまま。塗りすぎていないことも確かめる。
    expect(canvas.colorAt(4, 4)).toEqual(SECRET);
    expect(canvas.colorAt(16, 16)).toEqual(SECRET);
  });

  it("半透明の色を渡されても、不透明の黒で塗る", () => {
    const canvas = new FakeCanvas(20, 20, SECRET);
    const mask: Shape = {
      kind: "mask",
      // 画面側が誤って半透明の色を渡した場合。それでも下は読めてはいけない。
      color: "rgba(22, 25, 29, 0.2)",
      from: { x: 2, y: 2 },
      to: { x: 10, y: 10 },
    };

    paintShapes(asCtx(canvas), [mask], canvas.width);

    expect(canvas.colorAt(5, 5)).toEqual([0, 0, 0, 255]);
  });

  it("直前の印の透明度を引きずらない", () => {
    const canvas = new FakeCanvas(20, 20, SECRET);
    canvas.globalAlpha = 0.2;
    const mask: Shape = { kind: "mask", color: MASK_COLOR, from: { x: 2, y: 2 }, to: { x: 10, y: 10 } };

    paintShapes(asCtx(canvas), [mask], canvas.width);

    expect(canvas.colorAt(5, 5)).toEqual([0, 0, 0, 255]);
  });

  it("右下から左上へ引いても、同じ範囲を隠す", () => {
    const canvas = new FakeCanvas(20, 20, SECRET);
    const mask: Shape = { kind: "mask", color: MASK_COLOR, from: { x: 12, y: 12 }, to: { x: 4, y: 4 } };

    paintShapes(asCtx(canvas), [mask], canvas.width);

    expect(canvas.colorAt(5, 5)).toEqual([0, 0, 0, 255]);
    expect(canvas.colorAt(11, 11)).toEqual([0, 0, 0, 255]);
    expect(canvas.colorAt(3, 3)).toEqual(SECRET);
  });

  it("四角以外の印は、下の色を消さない（隠す道具は黒塗りだけ）", () => {
    const canvas = new FakeCanvas(20, 20, SECRET);
    const shapes: Shape[] = [
      { kind: "rect", color: "#ff0000", from: { x: 2, y: 2 }, to: { x: 10, y: 10 } },
      { kind: "arrow", color: "#ff0000", from: { x: 2, y: 2 }, to: { x: 10, y: 10 } },
      { kind: "pen", color: "#ff0000", points: [{ x: 2, y: 2 }, { x: 9, y: 9 }] },
      { kind: "text", color: "#ff0000", at: { x: 2, y: 2 }, text: "ここ" },
    ];

    paintShapes(asCtx(canvas), shapes, canvas.width);

    expect(canvas.colorAt(5, 5)).toEqual(SECRET);
  });

  it("向きが逆でも同じ範囲になる", () => {
    expect(normalizedRect({ x: 10, y: 8 }, { x: 2, y: 3 })).toEqual({ x: 2, y: 3, w: 8, h: 5 });
  });
});
