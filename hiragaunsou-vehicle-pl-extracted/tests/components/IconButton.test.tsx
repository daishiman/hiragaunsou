/** @vitest-environment jsdom */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { IconButton } from "../../app/_components/IconButton";

describe("IconButton", () => {
  it("デスクトップの32px表示を保つ共通クラスを持つ", () => {
    render(<IconButton name="menu" label="メニューを開く" onClick={vi.fn()} />);
    expect(screen.getByRole("button", { name: "メニューを開く" })).toHaveClass(
      "icon-button",
      "h-8",
      "w-8",
    );
  });

  it("coarse pointerではタップ領域を44px以上にする", () => {
    const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");
    const coarsePointerRule = css.match(/@media \(pointer: coarse\) \{([\s\S]*?)\n\}/)?.[1];

    expect(coarsePointerRule).toContain(".icon-button");
    expect(coarsePointerRule).toContain("min-width: 44px");
    expect(coarsePointerRule).toContain("min-height: 44px");
  });
});
