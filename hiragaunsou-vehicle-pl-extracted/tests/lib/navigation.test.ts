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
    expect(labels.indexOf("儲かっているかを見る")).toBeLessThan(
      labels.indexOf("毎月の締め(この順に進む)"),
    );
  });

  it("「直した内容の反映」は一番最後のグループに単独で置く(マスタ登録とは性質が違うため)", () => {
    const last = NAV_GROUPS[NAV_GROUPS.length - 1];
    expect(last.label).toBe("直した内容の反映(最後に確認)");
    expect(last.items.map((i) => i.href)).toEqual(["/master-changes"]);
  });

  it("3つのマスタ画面は1グループにまとまっている", () => {
    const master = NAV_GROUPS.find((g) => g.label === "計算の基準(先に登録しておく)");
    expect(master?.items.map((i) => i.href)).toEqual([
      "/rate-settings",
      "/admin/vehicle-master",
      "/admin/driver-master",
    ]);
  });

  it("要確認の一覧は毎月の締めグループのチェックの直後に並ぶ(同じ内容の別表示であるため)", () => {
    const monthly = NAV_GROUPS.find((g) => g.label === "毎月の締め(この順に進む)");
    const hrefs = monthly?.items.map((i) => i.href) ?? [];
    expect(hrefs.indexOf("/todo")).toBe(hrefs.indexOf("/anomaly") + 1);
  });

  it("月次収支表と年間集計は名前だけで見分けられる(似た画面の取り違え防止)", () => {
    const grid = NAV_ITEMS.find((i) => i.href === "/grid");
    const annual = NAV_ITEMS.find((i) => i.href === "/annual");
    expect(grid?.label).toContain("1か月");
    expect(annual?.label).toContain("1年");
  });

  it("NAV_ITEMSは全グループのitemsを平坦化したもの", () => {
    const expectedCount = NAV_GROUPS.reduce((sum, g) => sum + g.items.length, 0);
    expect(NAV_ITEMS.length).toBe(expectedCount);
  });

  it("項目にstepフィールドを持たない(業務フローSTEP番号バッジは初心者に分かりにくいため廃止)", () => {
    for (const item of NAV_ITEMS) {
      expect(item).not.toHaveProperty("step");
    }
  });

  it("全項目がホバー説明(desc)を持つ(ホームを含め、どの項目もホバーで説明が出る)", () => {
    for (const item of NAV_ITEMS) {
      expect(typeof item.desc).toBe("string");
      expect(item.desc.length).toBeGreaterThan(0);
    }
  });

  it("ホーム項目のdescが具体的な説明文になっている", () => {
    const home = NAV_ITEMS.find((i) => i.href === "/");
    expect(home?.desc).toBe("今やることを1つだけ案内します。まずはここから");
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
    expect(hrefs).toEqual(["/", "/logic", "/profile"]);
  });

  it("全項目が除外されたグループはそのものが結果から消える", () => {
    const groups = visibleNavGroups("unknown-role");
    const labels = groups.map((g) => g.label);
    // 分析グループの全項目はpermission指定ありのため空になり、消える
    expect(labels).not.toContain("儲かっているかを見る");
    // 「仕組みの説明」は無権限項目(/logic)を含むため残る
    expect(labels).toContain("仕組みの説明");
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

  it("できあがった収支表グループの画面はdata", () => {
    expect(kindOf("/grid")).toBe("data");
  });

  it("仕組みの説明グループの画面はspec", () => {
    expect(kindOf("/logic")).toBe("spec");
  });

  it("マスタ画面はmaster(設定・管理と混ざらないよう別のkindにする)", () => {
    expect(kindOf("/rate-settings")).toBe("master");
    expect(kindOf("/master-changes")).toBe("master");
  });

  it("未登録のhrefはnull", () => {
    expect(kindOf("/no-such-page")).toBeNull();
  });
});

describe("KIND_LABELS", () => {
  it("6種類のkindすべてに日本語ラベルを持つ", () => {
    expect(KIND_LABELS).toEqual({
      ops: "毎月の締め",
      data: "できあがった収支表",
      analysis: "分析",
      master: "計算の基準",
      spec: "仕組みの説明",
      tool: "設定・管理",
    });
  });
});

/**
 * 依頼者が決めた2点。どちらも「押せるのに開けない」「実装済みなのに辿れない」という
 * 見えない不具合になりやすいので、サイドバーの並びとして固定しておく。
 */
describe("サイドバーの構成(2026-08-09 の決定)", () => {
  it("要確認の一覧はサイドバーの毎月の締めから辿れる", () => {
    expect(kindOf("/todo")).toBe("ops");
    const items = visibleNavGroups("input_staff").flatMap((g) => g.items);
    expect(items.some((i) => i.href === "/todo")).toBe(true);
  });

  it("率マスタ設定は管理者だけに出す(1つ書き換えると全車両・全月が動くため)", () => {
    const forInput = visibleNavGroups("input_staff").flatMap((g) => g.items);
    expect(forInput.some((i) => i.href === "/rate-settings")).toBe(false);

    const forAdmin = visibleNavGroups("admin").flatMap((g) => g.items);
    expect(forAdmin.some((i) => i.href === "/rate-settings")).toBe(true);
  });
});
