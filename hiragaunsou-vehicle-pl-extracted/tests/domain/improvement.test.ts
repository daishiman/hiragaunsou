import { describe, expect, it } from "vitest";
import {
  countImprovementsByStatus,
  filterImprovements,
  groupImprovementsByScreen,
  improvementHandlingError,
  improvementPeriodStart,
  improvementStatusLabel,
  improvementStatusTone,
  isAcceptableShot,
  isImprovementPeriod,
  isImprovementStatus,
  normalizeImprovementBody,
  shotBytesOf,
  IMPROVEMENT_SHOT_MAX_BYTES,
  type ImprovementRow,
} from "../../src/domain/rules/improvement";

/** 1×1の実データ。magic bytes の検査が本物を通すことを確かめるために使う。 */
const PNG_1PX =
  "data:image/png;base64," +
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const JPEG_1PX =
  "data:image/jpeg;base64," +
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

function row(over: Partial<ImprovementRow> = {}): ImprovementRow {
  return {
    id: "improve_1",
    status: "open",
    path: "/grid",
    routePattern: "/grid",
    screenLabel: "月次収支表",
    createdAt: new Date("2026-08-10T00:00:00Z"),
    ...over,
  };
}

describe("改善要望の状態", () => {
  it("画面には日本語の呼び名を出す (DBの値をそのまま見せない)", () => {
    expect(improvementStatusLabel("open")).toBe("未対応");
    expect(improvementStatusLabel("dropped")).toBe("見送り");
  });

  it("未対応は判断待ちの色、見送りは分類の色にする", () => {
    expect(improvementStatusTone("open")).toBe("caution");
    expect(improvementStatusTone("doing")).toBe("brand");
    expect(improvementStatusTone("done")).toBe("brand");
    expect(improvementStatusTone("dropped")).toBe("neutral");
  });

  it("扱ってよい状態だけを通す", () => {
    expect(isImprovementStatus("doing")).toBe(true);
    expect(isImprovementStatus("archived")).toBe(false);
  });
});

describe("対応状況を保存するときのルール", () => {
  it("見送りは理由が無いと保存できない", () => {
    expect(improvementHandlingError("open", null, "dropped", null)).toBe(
      "「見送り」にする理由を入力してください。",
    );
    expect(improvementHandlingError("open", null, "dropped", " ")).toBe(
      "「見送り」にする理由を入力してください。",
    );
    expect(improvementHandlingError("open", null, "dropped", "別の画面で直したため")).toBeNull();
  });

  it("状態もメモも変わらない保存は断る", () => {
    expect(improvementHandlingError("doing", "来週直す", "doing", "来週直す")).toBe(
      "変更する内容がありません。",
    );
  });

  it("同じ状態のままメモだけ直せる・空にできる", () => {
    expect(improvementHandlingError("doing", "来週直す", "doing", "今週直す")).toBeNull();
    expect(improvementHandlingError("doing", "来週直す", "doing", null)).toBeNull();
  });

  it("対応済みからでも未対応へ戻せる (閉じ間違いを取り返せる)", () => {
    expect(improvementHandlingError("done", "直した", "open", "直した")).toBeNull();
  });
});

describe("本文と画像の受け取り", () => {
  it("改行を揃え、前後の空白を落とす (中身は削らない)", () => {
    expect(normalizeImprovementBody("  1行目\r\n2行目  ")).toBe("1行目\n2行目");
  });

  it("data URL の文字数から元のバイト数を見積もる", () => {
    // "AAAA" は 3 バイト、"AA==" は 1 バイト
    expect(shotBytesOf("data:image/png;base64,AAAA")).toBe(3);
    expect(shotBytesOf("data:image/png;base64,AA==")).toBe(1);
    expect(shotBytesOf("これはdataURLではない")).toBe(0);
  });

  it("PNG と JPEG は先頭バイトまで見て受け取る", () => {
    expect(isAcceptableShot(PNG_1PX)).toBe(true);
    expect(isAcceptableShot(JPEG_1PX)).toBe(true);
  });

  it("画像と名乗っていても中身が違うものは受け取らない", () => {
    // 形式は image/png だが中身は文字列 ("hello world" を base64 にしたもの)
    expect(isAcceptableShot("data:image/png;base64,aGVsbG8gd29ybGQh")).toBe(false);
  });

  it("画像以外の data URL は受け取らない", () => {
    expect(isAcceptableShot("data:text/html;base64,PHNjcmlwdD4=")).toBe(false);
    expect(isAcceptableShot("https://example.com/a.png")).toBe(false);
  });

  it("上限を超える大きさは受け取らない", () => {
    const huge = "data:image/png;base64," + "A".repeat(Math.ceil((IMPROVEMENT_SHOT_MAX_BYTES * 4) / 3) + 8);
    expect(isAcceptableShot(huge)).toBe(false);
  });
});

describe("一覧の絞り込みと集計", () => {
  const rows: ImprovementRow[] = [
    row({ id: "a", status: "open", routePattern: "/grid", screenLabel: "月次収支表" }),
    row({ id: "b", status: "done", routePattern: "/grid", screenLabel: "月次収支表" }),
    row({
      id: "c",
      status: "open",
      routePattern: "/vehicle/[vehicleNo]",
      screenLabel: "1台の明細",
      createdAt: new Date("2026-07-01T00:00:00Z"),
    }),
  ];

  it("状態・画面・期間で絞り込む", () => {
    expect(filterImprovements(rows, { status: "open" }).map((r) => r.id)).toEqual(["a", "c"]);
    expect(filterImprovements(rows, { routePattern: "/grid" }).map((r) => r.id)).toEqual(["a", "b"]);
    expect(
      filterImprovements(rows, { since: new Date("2026-08-01T00:00:00Z") }).map((r) => r.id),
    ).toEqual(["a", "b"]);
  });

  it("0件の状態も欠かさず数える", () => {
    // 状態を1つ足したら、ここも必ず落ちる。
    // 「札は出るのに件数が数えられない」状態を見逃さないための落ち方なので、
    // 足りない状態を書き足して直す (数え方の側を緩めない)。
    expect(countImprovementsByStatus(rows)).toEqual({
      open: 2,
      doing: 0,
      review: 0,
      done: 1,
      dropped: 0,
      invalid: 0,
      duplicate: 0,
    });
  });

  it("実URLではなく画面の単位で数え、多い順に並べる", () => {
    const withDetail: ImprovementRow[] = [
      ...rows,
      row({ id: "d", path: "/vehicle/1177", routePattern: "/vehicle/[vehicleNo]", screenLabel: "1台の明細" }),
      row({ id: "e", path: "/vehicle/2244", routePattern: "/vehicle/[vehicleNo]", screenLabel: "1台の明細" }),
    ];
    expect(groupImprovementsByScreen(withDetail)).toEqual([
      { routePattern: "/vehicle/[vehicleNo]", screenLabel: "1台の明細", count: 3 },
      { routePattern: "/grid", screenLabel: "月次収支表", count: 2 },
    ]);
  });
});

describe("期間の選択", () => {
  it("すべては起点なし、7日/30日はその日数だけさかのぼる", () => {
    const now = new Date("2026-08-15T00:00:00Z");
    expect(improvementPeriodStart("all", now)).toBeNull();
    expect(improvementPeriodStart("7d", now)?.toISOString()).toBe("2026-08-08T00:00:00.000Z");
    expect(improvementPeriodStart("30d", now)?.toISOString()).toBe("2026-07-16T00:00:00.000Z");
  });

  it("扱ってよい期間だけを通す", () => {
    expect(isImprovementPeriod("30d")).toBe(true);
    expect(isImprovementPeriod("1y")).toBe(false);
  });
});
