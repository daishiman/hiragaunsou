import { describe, expect, it } from "vitest";
import {
  findOverlaps,
  findStickyIntrusions,
  formatOverlaps,
  formatStickyIntrusions,
  MIN_OVERLAP_PX,
  MIN_OVERLAP_RATIO,
  type StickyBox,
  type TextRect,
} from "./textOverlapGeometry";

const DEFAULT_RECT: TextRect = {
  id: 1,
  ancestors: [],
  text: "A",
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  path: "main > p.a",
  inSvg: false,
  insideSticky: [],
};

function rect(id: number, overrides: Partial<TextRect> = {}): TextRect {
  return {
    ...DEFAULT_RECT,
    id,
    text: String.fromCharCode(64 + id),
    path: `main > p.r${id}`,
    ...overrides,
  };
}

function box(overrides: Partial<StickyBox> = {}): StickyBox {
  return {
    index: 0,
    path: "main > div.sticky",
    opaque: true,
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    ...overrides,
  };
}

describe("findOverlaps", () => {
  it("空・非重なり・辺が接するだけの矩形を報告しない", () => {
    expect(findOverlaps([])).toEqual([]);
    expect(findOverlaps([rect(1), rect(2, { y: 20 })])).toEqual([]);
    expect(findOverlaps([rect(1), rect(2, { x: 10 })])).toEqual([]);
  });

  it.each([
    { overlap: MIN_OVERLAP_PX - 0.001, expected: 0 },
    { overlap: MIN_OVERLAP_PX, expected: 1 },
    { overlap: MIN_OVERLAP_PX + 0.001, expected: 1 },
  ])("横幅 $overlap px の境界を判定する", ({ overlap, expected }) => {
    const result = findOverlaps([
      rect(1),
      rect(2, { x: DEFAULT_RECT.width - overlap }),
    ]);
    expect(result).toHaveLength(expected);
    if (expected === 1) expect(result[0]!.overlapWidth).toBeCloseTo(overlap, 10);
  });

  it.each([
    { overlap: MIN_OVERLAP_PX - 0.001, expected: 0 },
    { overlap: MIN_OVERLAP_PX, expected: 1 },
    { overlap: MIN_OVERLAP_PX + 0.001, expected: 1 },
  ])("縦幅 $overlap px の境界を判定する", ({ overlap, expected }) => {
    // 入力を上下逆順にし、Y座標での並べ替えも通す。
    const result = findOverlaps([
      rect(2, { y: DEFAULT_RECT.height - overlap }),
      rect(1),
    ]);
    expect(result).toHaveLength(expected);
    if (expected === 1) expect(result[0]!.overlapHeight).toBeCloseTo(overlap, 10);
  });

  it.each([
    { ratio: MIN_OVERLAP_RATIO - 0.00001, expected: 0 },
    { ratio: MIN_OVERLAP_RATIO, expected: 1 },
    { ratio: MIN_OVERLAP_RATIO + 0.00001, expected: 1 },
  ])("面積比 $ratio の境界を判定する", ({ ratio, expected }) => {
    const overlapWidth = MIN_OVERLAP_PX;
    const overlapHeight = (DEFAULT_RECT.width * DEFAULT_RECT.height * ratio) / overlapWidth;
    const result = findOverlaps([
      rect(1),
      rect(2, {
        x: DEFAULT_RECT.width - overlapWidth,
        y: DEFAULT_RECT.height - overlapHeight,
      }),
    ]);
    expect(result).toHaveLength(expected);
    if (expected === 1) expect(result[0]!.ratio).toBeCloseTo(ratio, 10);
  });

  it("完全に包含された矩形を100%の重なりとして報告する", () => {
    const result = findOverlaps([
      rect(1, { width: 20, height: 20 }),
      rect(2, { x: 5, y: 5, width: 4, height: 4 }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ overlapWidth: 4, overlapHeight: 4, ratio: 1 });
  });

  it("同一要素の複数行だけを除外する", () => {
    expect(findOverlaps([rect(1), rect(1, { text: "同じ要素の別行" })])).toEqual([]);
  });

  it("親の直接文字とabsolute配置された子の文字の衝突を報告する", () => {
    expect(findOverlaps([rect(1), rect(2, { ancestors: [1] })])).toHaveLength(1);
    expect(findOverlaps([rect(1, { ancestors: [2] }), rect(2)])).toHaveLength(1);
  });

  it("負座標でも交差量を正しく計算する", () => {
    const result = findOverlaps([
      rect(1, { x: -100, y: -100 }),
      rect(2, { x: -95, y: -95 }),
    ]);

    expect(result[0]).toMatchObject({ overlapWidth: 5, overlapHeight: 5, ratio: 0.25 });
  });

  it("安全整数範囲内の大きな座標でも交差量を正しく計算する", () => {
    const large = Number.MAX_SAFE_INTEGER - 1_000;
    const result = findOverlaps([
      rect(1, { x: large, y: large, width: 100, height: 100 }),
      rect(2, { x: large + 80, y: large, width: 100, height: 100 }),
    ]);

    expect(result[0]).toMatchObject({ overlapWidth: 20, overlapHeight: 100 });
    expect(result[0]!.ratio).toBeCloseTo(0.2, 10);
  });
});

describe("findStickyIntrusions", () => {
  it("箱が無い、背景が透ける、帯の中身である場合は報告しない", () => {
    expect(findStickyIntrusions([rect(1)], [])).toEqual([]);
    expect(findStickyIntrusions([rect(1)], [box({ opaque: false })])).toEqual([]);
    expect(findStickyIntrusions([rect(1, { insideSticky: [0] })], [box()])).toEqual([]);
  });

  it.each([
    { overlap: MIN_OVERLAP_PX - 0.001, expected: 0 },
    { overlap: MIN_OVERLAP_PX, expected: 1 },
    { overlap: MIN_OVERLAP_PX + 0.001, expected: 1 },
  ])("帯との横幅 $overlap px の境界を判定する", ({ overlap, expected }) => {
    const result = findStickyIntrusions(
      [rect(1, { x: 10 - overlap })],
      [box()],
    );
    expect(result).toHaveLength(expected);
    if (expected === 1) expect(result[0]!.overlapWidth).toBeCloseTo(overlap, 10);
  });

  it.each([
    { overlap: MIN_OVERLAP_PX - 0.001, expected: 0 },
    { overlap: MIN_OVERLAP_PX, expected: 1 },
    { overlap: MIN_OVERLAP_PX + 0.001, expected: 1 },
  ])("帯との縦幅 $overlap px の境界を判定する", ({ overlap, expected }) => {
    const result = findStickyIntrusions(
      [rect(1, { y: 10 - overlap })],
      [box()],
    );
    expect(result).toHaveLength(expected);
    if (expected === 1) expect(result[0]!.overlapHeight).toBeCloseTo(overlap, 10);
  });

  it.each([
    { ratio: MIN_OVERLAP_RATIO - 0.00001, expected: 0 },
    { ratio: MIN_OVERLAP_RATIO, expected: 1 },
    { ratio: MIN_OVERLAP_RATIO + 0.00001, expected: 1 },
  ])("帯との面積比 $ratio の境界を判定する", ({ ratio, expected }) => {
    const overlapWidth = MIN_OVERLAP_PX;
    const overlapHeight = (DEFAULT_RECT.width * DEFAULT_RECT.height * ratio) / overlapWidth;
    const result = findStickyIntrusions(
      [
        rect(1, {
          x: 10 - overlapWidth,
          y: 10 - overlapHeight,
        }),
      ],
      [box()],
    );
    expect(result).toHaveLength(expected);
    if (expected === 1) expect(result[0]!.ratio).toBeCloseTo(ratio, 10);
  });

  it("完全に帯の中へ入った文字を100%の侵入として報告する", () => {
    const sticky = box({ x: -10, y: -10, width: 30, height: 30 });
    const text = rect(1);
    const result = findStickyIntrusions([text], [sticky]);

    expect(result).toEqual([
      {
        box: sticky,
        text,
        overlapWidth: 10,
        overlapHeight: 10,
        ratio: 1,
      },
    ]);
  });
});

describe("失敗メッセージの数値出力", () => {
  it("通常DOMとSVGの重なり量・割合を丸めて出力する", () => {
    const dom = rect(1, { text: "DOM" });
    const svg = rect(2, { text: "SVG", inSvg: true });
    const overlap = { a: dom, b: svg, overlapWidth: 2.04, overlapHeight: 3.06, ratio: 0.1249 };

    expect(formatOverlaps("/report", [overlap])).toBe(
      "/report: 文字が重なって読めない箇所が 1 件あります\n" +
        "  ・グラフの中: 「DOM」と「SVG」が重なっています\n" +
        "      重なり 2.0 × 3.1 px (小さいほうの 12%)\n" +
        "      main > p.r1\n" +
        "      main > p.r2",
    );
    expect(formatOverlaps("/empty", [])).toBe(
      "/empty: 文字が重なって読めない箇所が 0 件あります\n",
    );
    expect(formatOverlaps("/dom", [{ ...overlap, b: rect(2) }])).toContain("・画面の中:");
  });

  it("sticky侵入の量・割合と経路を丸めて出力する", () => {
    const text = rect(1, { text: "隠れる文字" });
    const sticky = box();
    const intrusion = {
      box: sticky,
      text,
      overlapWidth: 2.05,
      overlapHeight: 4.04,
      ratio: 0.125,
    };

    expect(formatStickyIntrusions("/settings", [intrusion])).toBe(
      "/settings: 貼り付く帯に隠されて読めない文字が 1 件あります\n" +
        "  ・貼り付く帯の下: 「隠れる文字」が帯に隠されます\n" +
        "      隠れる量 2.0 × 4.0 px (その文字の 13%)\n" +
        "      帯: main > div.sticky\n" +
        "      文字: main > p.r1",
    );
  });
});
