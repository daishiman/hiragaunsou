/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ImportDiffAlertList, describe as describeDiff } from "../../app/_components/ImportDiffAlertList";
import type { ImportDiff } from "../../src/domain/rules/importDiffDetection";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
}));

/**
 * 「前回と異なります」の出し方。
 *
 * 一番大事なのは強弱。見落とすと収支表が静かに壊れるものだけを開いて出し、
 * 起きて当たり前の変更は畳む。全部を同じ強さで出すと、どれも読まれなくなる。
 */
function diff(overrides: Partial<ImportDiff> = {}): ImportDiff {
  return {
    fingerprint: "f1",
    kind: "value_changed",
    severity: "caution",
    targetKind: "driver",
    targetKey: "1002",
    targetLabel: "鈴木一郎",
    field: "driverName",
    fieldLabel: "氏名",
    before: "鈴木一郎",
    after: "鈴木 一朗",
    counterpartLabel: null,
    ...overrides,
  };
}

const fetchMock = vi.fn();

beforeEach(() => {
  refresh.mockReset();
  fetchMock.mockReset().mockResolvedValue({ ok: true, json: async () => ({ count: 1 }) });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ImportDiffAlertList の強弱", () => {
  it("要確認のものは開いたまま並べ、件数を見出しに出す", () => {
    render(
      <ImportDiffAlertList
        diffs={[
          diff({ fingerprint: "c1", severity: "critical", kind: "digit_jump", fieldLabel: "リース料", before: "50000", after: "500000" }),
          diff({ fingerprint: "c2", severity: "critical", kind: "row_removed", targetLabel: "車番 24" }),
        ]}
      />,
    );

    expect(screen.getByText("前回と異なります(要確認 2件)")).toBeInTheDocument();
    expect(screen.getByText(/50000 → 500000 \(桁が違います\)/)).toBeInTheDocument();
    expect(screen.getByText(/前回はありましたが、今回は入っていません/)).toBeInTheDocument();
  });

  it("ふつうの変更は畳んでおき、開いたときだけ中身を出す", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <ImportDiffAlertList diffs={[diff(), diff({ fingerprint: "f2" })]} />,
    );

    expect(screen.getByText("前回と異なります(2件)")).toBeInTheDocument();
    // 中身は畳まれた状態で置く (開くまで読まされない)
    expect(container.querySelector("details")).not.toHaveAttribute("open");

    await user.click(screen.getByText("ふつうの変更も見る (2件)"));
    expect(container.querySelector("details")).toHaveAttribute("open");
    expect(screen.getAllByText(/鈴木一郎 の氏名: 鈴木一郎 → 鈴木 一朗/)).toHaveLength(2);
  });

  it("1件ずつ確認済みにできる", async () => {
    const user = userEvent.setup();
    render(<ImportDiffAlertList diffs={[diff({ severity: "critical" })]} />);

    await user.click(screen.getByRole("button", { name: "確認済みにする" }));

    const [, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    expect(JSON.parse(init.body)).toMatchObject({
      fingerprints: ["f1"],
      targetKind: "driver",
      targetLabel: "鈴木一郎",
      summary: "鈴木一郎 の氏名: 鈴木一郎 → 鈴木 一朗",
    });
    expect(refresh).toHaveBeenCalled();
  });

  it("ふつうの変更はまとめて確認済みにできる", async () => {
    const user = userEvent.setup();
    render(<ImportDiffAlertList diffs={[diff(), diff({ fingerprint: "f2" })]} />);

    await user.click(screen.getByText("ふつうの変更も見る (2件)"));
    await user.click(screen.getByRole("button", { name: "これらをまとめて確認済みにする" }));

    const [, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    expect(JSON.parse(init.body).fingerprints).toEqual(["f1", "f2"]);
  });

  it("確認済みにできなかったときは理由を出す", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: "保存できませんでした" }) });
    render(<ImportDiffAlertList diffs={[diff({ severity: "critical" })]} />);

    await user.click(screen.getByRole("button", { name: "確認済みにする" }));

    expect(await screen.findByText("保存できませんでした")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("通信できなくても押しっぱなしにならない", async () => {
    const user = userEvent.setup();
    fetchMock.mockRejectedValue(new Error("offline"));
    render(<ImportDiffAlertList diffs={[diff({ severity: "critical" })]} />);

    await user.click(screen.getByRole("button", { name: "確認済みにする" }));

    expect(await screen.findByText("確認済みにできませんでした")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "確認済みにする" })).toBeEnabled();
  });
});

describe("1件の違いを1行にする言い方", () => {
  it("種類ごとに、何がどう違うのかだけを書く", () => {
    expect(describeDiff(diff({ kind: "row_added", targetLabel: "車番 300" }))).toBe(
      "車番 300: 今回から新しく入っています",
    );
    expect(
      describeDiff(diff({ kind: "unassigned", fieldLabel: "車番", before: "300" })),
    ).toBe("鈴木一郎: 車番が空になりました (300 → 未割当)");
    expect(
      describeDiff(diff({ kind: "mojibake", fieldLabel: "氏名", after: "�木一郎" })),
    ).toBe("鈴木一郎 の氏名: �木一郎 (文字が壊れている可能性があります)");
    expect(
      describeDiff(
        diff({ kind: "duplicate_candidate", counterpartLabel: "鈴木 一郎", before: "1002", after: "1003" }),
      ),
    ).toBe("鈴木一郎 と 鈴木 一郎: 同じものが2件あります (1002 / 1003)");
    expect(
      describeDiff(diff({ kind: "near_match", counterpartLabel: "鈴木一朗", before: "鈴木一郎", after: "鈴木一朗" })),
    ).toContain("よく似ています");
    expect(describeDiff(diff({ kind: "link_changed", fieldLabel: "車番", before: "300", after: "24" }))).toBe(
      "鈴木一郎 の車番: 300 → 24",
    );
  });

  /** 空欄を空文字のまま出すと「→ 」で終わって、消えたのか読み取れない */
  it("空欄は(空)と書く", () => {
    expect(describeDiff(diff({ before: null, after: "" }))).toBe("鈴木一郎 の氏名: (空) → (空)");
  });
});
