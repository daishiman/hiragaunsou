/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AccessDenied, describeAllowedRoles } from "../../app/_components/AccessDenied";

/**
 * 権限が無い画面を黙ってホームへ戻すのをやめた代わりの表示。
 * 文言は権限マトリクスから組み立てているので、マトリクスを変えたら
 * ここの説明も自動で追随する(古い説明が残らない)ことを固定する。
 */
describe("describeAllowedRoles", () => {
  it("その権限を持つロールだけを並べる", () => {
    expect(describeAllowedRoles("manage_imports")).toBe("管理者");
    expect(describeAllowedRoles("view")).toContain("入力担当");
  });
});

describe("AccessDenied", () => {
  it("開けない理由と、誰に頼めばよいかを出す", () => {
    render(<AccessDenied screenName="率マスタ設定" permission="manage_imports" />);
    expect(screen.getByText("「率マスタ設定」は管理者のみが開けます。")).toBeInTheDocument();
    expect(screen.getByText("必要な場合は管理者にご依頼ください。")).toBeInTheDocument();
  });

  it("行き止まりにせず、ホームへ戻る導線を置く", () => {
    render(<AccessDenied screenName="ユーザー管理" permission="manage_users" />);
    expect(screen.getByRole("link", { name: "ホームに戻る" })).toHaveAttribute("href", "/");
  });

  it("開けない画面の中身は一切描かない(露出の条件は変えない)", () => {
    const { container } = render(
      <AccessDenied screenName="運転者マスタ管理" permission="manage_imports" />,
    );
    expect(container.querySelector("table")).toBeNull();
  });
});
