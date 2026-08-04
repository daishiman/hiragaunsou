import { describe, expect, it } from "vitest";
import {
  findNavItem,
  KIND_LABELS,
  kindOf,
  NAV_GROUPS,
  NAV_ITEMS,
  visibleNavGroups,
} from "../../app/_lib/navigation";

describe("NAV_GROUPS / NAV_ITEMS", () => {
  it("分析グループが毎月の締めグループより前に来る(分析が主目的であるため)", () => {
    const labels = NAV_GROUPS.map((g) => g.label);
    expect(labels.indexOf("分析")).toBeLessThan(labels.indexOf("毎月の締め(業務フロー順)"));
  });

  it("NAV_ITEMSは全グループのitemsを平坦化したもの", () => {
    const expectedCount = NAV_GROUPS.reduce((sum, g) => sum + g.items.length, 0);
    expect(NAV_ITEMS.length).toBe(expectedCount);
  });
});

describe("visibleNavGroups", () => {
  it("adminはすべての画面が見える", () => {
    const groups = visibleNavGroups("admin");
    const hrefs = groups.flatMap((g) => g.items.map((i) => i.href));
    expect(hrefs).toEqual(NAV_ITEMS.map((i) => i.href));
  });

  it("executiveは入力系(input権限)とAPIキー管理(manage_api_keys権限)の画面が消える", () => {
    const groups = visibleNavGroups("executive");
    const hrefs = groups.flatMap((g) => g.items.map((i) => i.href));
    expect(hrefs).not.toContain("/import");
    expect(hrefs).not.toContain("/manual-entry");
    expect(hrefs).not.toContain("/ai-settings");
    // view/report_settings は許可されているので残る
    expect(hrefs).toContain("/dashboard");
    expect(hrefs).toContain("/report");
  });

  it("権限を一つも持たないロールでは、権限指定の無い画面だけが残る", () => {
    const groups = visibleNavGroups("unknown-role");
    const hrefs = groups.flatMap((g) => g.items.map((i) => i.href));
    expect(hrefs).toEqual(["/", "/logic"]);
  });

  it("全項目が除外されたグループはそのものが結果から消える", () => {
    const groups = visibleNavGroups("unknown-role");
    const labels = groups.map((g) => g.label);
    // 「分析」グループの全項目はpermission指定ありのため空になり、消える
    expect(labels).not.toContain("分析");
    // 「仕様の合意」は無権限項目(/logic)を含むため残る
    expect(labels).toContain("仕様の合意");
  });
});

describe("findNavItem", () => {
  it("ルートパスは完全一致でホームを返す", () => {
    expect(findNavItem("/")?.href).toBe("/");
  });

  it("登録済みのパスに一致する項目を返す", () => {
    expect(findNavItem("/dashboard")?.href).toBe("/dashboard");
  });

  it("登録パスのサブパスも前方一致で拾う", () => {
    expect(findNavItem("/report/settings")?.href).toBe("/report");
  });

  it("一致する項目が無ければnull", () => {
    expect(findNavItem("/no-such-page")).toBeNull();
  });

  it("登録パス配下の深い階層のパスでも前方一致で拾う(ホームの/自体は候補から除外される)", () => {
    expect(findNavItem("/import/extra")?.href).toBe("/import");
  });
});

describe("kindOf", () => {
  it("分析グループの画面はanalysis", () => {
    expect(kindOf("/dashboard")).toBe("analysis");
  });

  it("現状データグループの画面はdata", () => {
    expect(kindOf("/grid")).toBe("data");
  });

  it("仕様の合意グループの画面はspec", () => {
    expect(kindOf("/logic")).toBe("spec");
  });

  it("未登録のhrefはnull", () => {
    expect(kindOf("/no-such-page")).toBeNull();
  });
});

describe("KIND_LABELS", () => {
  it("5種類のkindすべてに日本語ラベルを持つ", () => {
    expect(KIND_LABELS).toEqual({
      ops: "毎月の締め",
      data: "現状データ",
      analysis: "分析",
      spec: "仕様の合意",
      tool: "補助ツール",
    });
  });
});
