/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { DataTable } from "../../app/_components/DataTable";

const columns = [
  { key: "name", header: "利用者", cell: (row: { name: string }) => row.name },
] as const;

describe("DataTable", () => {
  it("高さ上限がある比較表は、内部スクロールと固定列見出しを一組にする", () => {
    const { container } = render(
      <DataTable
        caption="利用者の比較"
        columns={columns}
        rows={[{ name: "田中" }]}
        rowKey={(row) => row.name}
        maxHeight="20rem"
        empty={<p>対象はありません</p>}
      />,
    );

    const scrollContainer = container.querySelector("table")?.parentElement;
    const head = container.querySelector("thead");
    expect(scrollContainer).toHaveStyle({ maxHeight: "20rem" });
    expect(head).toHaveAttribute("data-sticky", "thead");
    expect(head).toHaveClass("sticky", "top-0");
  });

  it("短い表は不要な内部スクロールを作らない", () => {
    const { container } = render(
      <DataTable
        caption="短い表"
        columns={columns}
        rows={[{ name: "田中" }]}
        rowKey={(row) => row.name}
        empty={<p>対象はありません</p>}
      />,
    );

    const head = container.querySelector("thead");
    expect(head).not.toHaveAttribute("data-sticky");
    expect(head).not.toHaveClass("sticky");
  });
});
