import { describe, expect, it } from "vitest";
import { hasPermission } from "../../src/domain/rules/permissions";

describe("hasPermission", () => {
  it("adminはすべての権限を持つ", () => {
    expect(hasPermission("admin", "view")).toBe(true);
    expect(hasPermission("admin", "input")).toBe(true);
    expect(hasPermission("admin", "approve_anomaly")).toBe(true);
    expect(hasPermission("admin", "edit_master")).toBe(true);
    expect(hasPermission("admin", "confirm_close")).toBe(true);
    expect(hasPermission("admin", "report_settings")).toBe(true);
    expect(hasPermission("admin", "manage_api_keys")).toBe(true);
  });

  it("input_staffは締め確定・レポート配信設定を持たない", () => {
    expect(hasPermission("input_staff", "view")).toBe(true);
    expect(hasPermission("input_staff", "input")).toBe(true);
    expect(hasPermission("input_staff", "approve_anomaly")).toBe(true);
    expect(hasPermission("input_staff", "edit_master")).toBe(true);
    expect(hasPermission("input_staff", "confirm_close")).toBe(false);
    expect(hasPermission("input_staff", "report_settings")).toBe(false);
    expect(hasPermission("input_staff", "manage_api_keys")).toBe(false);
  });

  it("executiveは閲覧とレポート配信設定のみ", () => {
    expect(hasPermission("executive", "view")).toBe(true);
    expect(hasPermission("executive", "report_settings")).toBe(true);
    expect(hasPermission("executive", "input")).toBe(false);
    expect(hasPermission("executive", "edit_master")).toBe(false);
    expect(hasPermission("executive", "manage_api_keys")).toBe(false);
  });

  it("APIキー管理はadmin専用 (画面を使うのが管理者のみのため)", () => {
    expect(hasPermission("admin", "manage_api_keys")).toBe(true);
    expect(hasPermission("input_staff", "manage_api_keys")).toBe(false);
    expect(hasPermission("executive", "manage_api_keys")).toBe(false);
  });

  it("未知のロールはすべて拒否する", () => {
    expect(hasPermission("unknown_role", "view")).toBe(false);
  });
});
