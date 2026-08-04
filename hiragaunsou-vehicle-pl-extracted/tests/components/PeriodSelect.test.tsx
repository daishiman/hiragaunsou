/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PeriodSelect } from "../../app/_components/PeriodSelect";

const presets = [
  { label: "直近3ヶ月", from: "2026-03", to: "2026-05" },
  { label: "直近6ヶ月", from: "2025-12", to: "2026-05" },
];

describe("PeriodSelect", () => {
  it("現在のfrom/toと一致するプリセットにaria-current=trueを付ける", () => {
    render(
      <PeriodSelect
        basePath="/dashboard"
        from="2026-03"
        to="2026-05"
        presets={presets}
        options={["2026-05", "2026-04", "2026-03", "2025-12"]}
      />,
    );

    expect(screen.getByRole("link", { name: "直近3ヶ月" })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("link", { name: "直近6ヶ月" })).not.toHaveAttribute("aria-current");
  });

  it("どのプリセットにも一致しないときはaria-currentを付けない", () => {
    render(
      <PeriodSelect
        basePath="/dashboard"
        from="2024-01"
        to="2024-02"
        presets={presets}
        options={["2024-02", "2024-01"]}
      />,
    );

    for (const p of presets) {
      expect(screen.getByRole("link", { name: p.label })).not.toHaveAttribute("aria-current");
    }
  });

  it("プリセットのリンク先はbasePathとfrom/toのクエリを含む", () => {
    render(
      <PeriodSelect
        basePath="/dashboard"
        from="2026-03"
        to="2026-05"
        presets={presets}
        options={["2026-05", "2026-03"]}
      />,
    );

    expect(screen.getByRole("link", { name: "直近6ヶ月" })).toHaveAttribute(
      "href",
      "/dashboard?from=2025-12&to=2026-05",
    );
  });

  it("任意期間フォームはbasePathへGET送信し、選択肢に渡したoptionsを両方のselectへ描画する", () => {
    render(
      <PeriodSelect
        basePath="/dashboard"
        from="2026-03"
        to="2026-05"
        presets={presets}
        options={["2026-05", "2026-04", "2026-03"]}
      />,
    );

    const form = screen.getByRole("group", { name: "期間のプリセット" }).parentElement!.querySelector("form");
    expect(form).toHaveAttribute("action", "/dashboard");
    expect(form).toHaveAttribute("method", "get");

    const fromSelect = screen.getByLabelText("開始月") as HTMLSelectElement;
    const toSelect = screen.getByLabelText("終了月") as HTMLSelectElement;
    expect(fromSelect.value).toBe("2026-03");
    expect(toSelect.value).toBe("2026-05");
    expect(screen.getAllByRole("option")).toHaveLength(6);
  });
});
