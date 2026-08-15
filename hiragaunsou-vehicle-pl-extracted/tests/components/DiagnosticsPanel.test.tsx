/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DiagnosticsPanel } from "../../app/(app)/admin/improvements/[id]/DiagnosticsPanel";
import type { StoredDiagnostics } from "../../src/domain/rules/diagnostics";

/**
 * 管理画面に出す「送信時の記録」。
 *
 * 見せ方の要点は2つ。
 *  1. 普段は畳んでおく (毎回読むものではない)
 *  2. 何も無いときも枠を残し、「取れなかった」と書く
 *     (枠ごと消すと、集め忘れと本当に何も無かったのが区別できない)
 */
function diagnostics(over: Partial<StoredDiagnostics> = {}): StoredDiagnostics {
  return {
    version: 1,
    referrer: "/grid",
    build: { id: "abc123@2026-08-15", commit: "abc123" },
    environment: {
      userAgent: "Mozilla/5.0",
      browser: "Chrome 141",
      os: "Windows 10/11",
      viewport: "1440×900",
      devicePixelRatio: 2,
      touch: false,
      language: "ja",
      timezone: "Asia/Tokyo",
      online: true,
    },
    performance: { pageLoadMs: 820, slowestApi: null, medianApiMs: "取得不可" },
    console: [],
    errors: [],
    network: [],
    slowApi: [],
    breadcrumbs: [],
    notes: [],
    occurredAt: { utc: "2026-08-15T01:00:00.000Z", jst: "2026-08-15 10:00:00 JST" },
    screen: {
      path: "/vehicle/1177",
      routePattern: "/vehicle/[vehicleNo]",
      label: "車両別の収支",
      sourceFile: "app/(app)/vehicle/[vehicleNo]/page.tsx",
    },
    reporter: { id: "u1", name: "入力担当", role: "input_staff", companyId: "（1社専用のため会社IDなし）" },
    ...over,
  };
}

describe("DiagnosticsPanel", () => {
  it("記録が無い要望でも、枠を残して理由を書く", () => {
    render(<DiagnosticsPanel d={null} />);
    expect(screen.getByText(/記録が付いていません/)).toBeTruthy();
  });

  it("いつ・どこ・どの版かを、開かなくても読める位置に出す", () => {
    render(<DiagnosticsPanel d={diagnostics()} />);
    expect(screen.getByText("2026-08-15 10:00:00 JST")).toBeTruthy();
    expect(screen.getByText("app/(app)/vehicle/[vehicleNo]/page.tsx")).toBeTruthy();
    expect(screen.getByText("abc123@2026-08-15")).toBeTruthy();
  });

  it("量の多いものは畳んでおき、件数を見出しに出す", () => {
    render(
      <DiagnosticsPanel
        d={diagnostics({
          errors: [
            { kind: "uncaught", message: "boom", stack: "at x", source: null, at: "10:00" },
          ],
          breadcrumbs: [{ kind: "click", target: "button#save", at: "10:00" }],
        })}
      />,
    );
    expect(screen.getByText("直近のエラー（例外 1件 / console 0件）")).toBeTruthy();
    expect(screen.getByText("操作の足あと（1件）")).toBeTruthy();
    // 中身は畳まれていても、DOM には出ている（開けば読める）。
    expect(screen.getByText("boom")).toBeTruthy();
    expect(screen.getByText(/button#save/)).toBeTruthy();
  });

  it("空の一覧には「無い」と書く（無言で空にしない）", () => {
    render(<DiagnosticsPanel d={diagnostics()} />);
    expect(screen.getByText("失敗した通信はありません。")).toBeTruthy();
    expect(
      screen.getByText("3秒を超えた通信はありません。うまくいった通信は記録していません。"),
    ).toBeTruthy();
  });

  it("捨てたものがあれば注記を出す", () => {
    render(<DiagnosticsPanel d={diagnostics({ notes: ["大きすぎたため、古い順に捨てました。"] })} />);
    expect(screen.getByText(/古い順に捨てました/)).toBeTruthy();
  });

  it("失敗した通信は、突き合わせ用の印まで出す", () => {
    render(
      <DiagnosticsPanel
        d={diagnostics({
          network: [
            {
              method: "POST",
              url: "/api/vehicles?ym=[伏せ字]",
              status: 500,
              durationMs: 340,
              requestId: "rid-1",
              cfRay: "9a1b-NRT",
              responseExcerpt: "保存できませんでした。",
              at: "10:00",
              ok: false,
            },
          ],
        })}
      />,
    );
    expect(screen.getByText(/9a1b-NRT/)).toBeTruthy();
    expect(screen.getByText(/rid-1/)).toBeTruthy();
    expect(screen.getByText(/保存できませんでした。/)).toBeTruthy();
  });
});
