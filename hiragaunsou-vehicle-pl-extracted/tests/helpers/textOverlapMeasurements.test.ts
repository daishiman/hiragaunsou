import { describe, expect, it } from "vitest";
import {
  clippedRect,
  finalizeStickyBox,
  finalizeTextRect,
  isOpaqueBackground,
  type StickyBoxCandidate,
  type TextRectCandidate,
  type ViewportRect,
} from "./textOverlapMeasurements";

function viewportRect(overrides: Partial<ViewportRect> = {}): ViewportRect {
  return {
    left: 0,
    top: 0,
    right: 10,
    bottom: 10,
    width: 10,
    height: 10,
    ...overrides,
  };
}

function textCandidate(overrides: Partial<TextRectCandidate> = {}): TextRectCandidate {
  return {
    id: 1,
    ancestors: [],
    text: "1234567890",
    rect: viewportRect(),
    clips: [],
    path: "main > p",
    inSvg: false,
    insideSticky: [],
    ...overrides,
  };
}

function stickyCandidate(overrides: Partial<StickyBoxCandidate> = {}): StickyBoxCandidate {
  return {
    index: 0,
    path: "main > div.sticky",
    backgroundColor: "rgb(255, 255, 255)",
    visible: true,
    rect: viewportRect(),
    ...overrides,
  };
}

describe("clippedRect", () => {
  it("切り取り条件が無ければ元の矩形を返す", () => {
    const rect = viewportRect();
    expect(clippedRect(rect, [])).toEqual(rect);
  });

  it("Xだけ・Yだけ・両軸の祖先条件を順に適用する", () => {
    const result = clippedRect(viewportRect(), [
      { rect: viewportRect({ left: 2, right: 9, width: 7 }), clipX: true, clipY: false },
      { rect: viewportRect({ top: 3, bottom: 8, height: 5 }), clipX: false, clipY: true },
      {
        rect: viewportRect({ left: 4, top: 4, right: 7, bottom: 7, width: 3, height: 3 }),
        clipX: true,
        clipY: true,
      },
      { rect: viewportRect({ left: 99, top: 99 }), clipX: false, clipY: false },
    ]);

    expect(result).toEqual({ left: 4, top: 4, right: 7, bottom: 7, width: 3, height: 3 });
  });

  it("完全に切り取られた軸は負の大きさとして返し、呼び出し側で不可視にできる", () => {
    expect(
      clippedRect(viewportRect(), [
        { rect: viewportRect({ left: 20, right: 30 }), clipX: true, clipY: false },
      ]),
    ).toMatchObject({ left: 20, right: 10, width: -10 });
  });
});

describe("isOpaqueBackground", () => {
  it.each([
    ["transparent", false],
    ["rgba(0, 0, 0, 0)", false],
    ["rgba(1, 2, 3, 0.5)", false],
    ["rgba(1, 2, 3, 0.5001)", true],
    ["rgb(0, 0, 0)", true],
    ["rgba(不正)", true],
  ] as const)("%s の不透明判定は %s", (backgroundColor, expected) => {
    expect(isOpaqueBackground(backgroundColor)).toBe(expected);
  });
});

describe("finalizeTextRect", () => {
  it("viewport座標をページ座標へ移し、境界と属性をそのまま保つ", () => {
    expect(finalizeTextRect(textCandidate({ ancestors: [9] }), 5, 7, 10)).toEqual({
      id: 1,
      ancestors: [9],
      text: "1234567890",
      x: 5,
      y: 7,
      width: 10,
      height: 10,
      path: "main > p",
      inSvg: false,
      insideSticky: [],
    });
  });

  it("最大文字数を超えた表示名だけを省略する", () => {
    expect(finalizeTextRect(textCandidate(), 0, 0, 9)?.text).toBe("123456789…");
  });

  it("祖先に切り取られた後の実寸と座標を使う", () => {
    const result = finalizeTextRect(
      textCandidate({
        clips: [
          {
            rect: viewportRect({ left: 2, top: 3, right: 8, bottom: 9, width: 6, height: 6 }),
            clipX: true,
            clipY: true,
          },
        ],
      }),
      10,
      20,
      20,
    );
    expect(result).toMatchObject({ x: 12, y: 23, width: 6, height: 6 });
  });

  it("幅・高さが1px未満なら除外し、ちょうど1pxは残す", () => {
    expect(
      finalizeTextRect(textCandidate({ rect: viewportRect({ right: 0.999, width: 0.999 }) }), 0, 0, 20),
    ).toBeNull();
    expect(
      finalizeTextRect(textCandidate({ rect: viewportRect({ bottom: 0.999, height: 0.999 }) }), 0, 0, 20),
    ).toBeNull();
    expect(
      finalizeTextRect(
        textCandidate({ rect: viewportRect({ right: 1, bottom: 1, width: 1, height: 1 }) }),
        0,
        0,
        20,
      ),
    ).not.toBeNull();
  });

  it("ページの左または上へ完全に逃がした矩形を除外し、境界上は残す", () => {
    expect(
      finalizeTextRect(
        textCandidate({ rect: viewportRect({ left: -11, right: -1 }) }),
        0,
        0,
        20,
      ),
    ).toBeNull();
    expect(
      finalizeTextRect(
        textCandidate({ rect: viewportRect({ top: -11, bottom: -1 }) }),
        0,
        0,
        20,
      ),
    ).toBeNull();
    expect(
      finalizeTextRect(
        textCandidate({ rect: viewportRect({ left: -10, right: 0, top: -10, bottom: 0 }) }),
        0,
        0,
        20,
      ),
    ).not.toBeNull();
  });

  it("負座標・大きな安全座標とscroll量を精度を失わず変換する", () => {
    const large = Number.MAX_SAFE_INTEGER - 1_000;
    const result = finalizeTextRect(
      textCandidate({
        rect: viewportRect({ left: -100, top: -200, right: -90, bottom: -190 }),
      }),
      large,
      large,
      20,
    );
    expect(result).toMatchObject({ x: large - 100, y: large - 200 });
  });
});

describe("finalizeStickyBox", () => {
  it("見えていない・幅または高さが1px未満のstickyを除外する", () => {
    expect(finalizeStickyBox(stickyCandidate({ visible: false }), 0, 0)).toBeNull();
    expect(
      finalizeStickyBox(stickyCandidate({ rect: viewportRect({ right: 0, width: 0 }) }), 0, 0),
    ).toBeNull();
    expect(
      finalizeStickyBox(stickyCandidate({ rect: viewportRect({ bottom: 0, height: 0 }) }), 0, 0),
    ).toBeNull();
  });

  it("不透明度とscroll後のページ座標を持つ箱へ変換する", () => {
    expect(
      finalizeStickyBox(
        stickyCandidate({ backgroundColor: "rgba(0, 0, 0, 0)" }),
        30,
        40,
      ),
    ).toEqual({
      index: 0,
      path: "main > div.sticky",
      opaque: false,
      x: 30,
      y: 40,
      width: 10,
      height: 10,
    });
  });
});
