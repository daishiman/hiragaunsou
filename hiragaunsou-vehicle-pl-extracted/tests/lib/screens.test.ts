import { describe, expect, it } from "vitest";
import {
  FLOW_SCREENS,
  flowPositionOf,
  findScreen,
  getScreen,
  SCREENS,
  SCREEN_GROUPS,
} from "../../app/_lib/screens";

/**
 * 画面の情報設計(名前・所属グループ・順序・リード文・工程順)は screens.ts の1ファイルだけが正。
 * サイドバー・ページ見出し・工程の前後リンクはすべてここから描かれるので、
 * 定義の抜けはそのまま「画面に文言が出ない」という無言の不具合になる。ここで固定しておく。
 */
describe("SCREENS の定義漏れ防止", () => {
  it("hrefが重複していない", () => {
    const hrefs = SCREENS.map((s) => s.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("全画面が label / title / lead / does を持つ(ヘッダの3行が空欄にならない)", () => {
    for (const s of SCREENS) {
      expect(s.label.length, s.href).toBeGreaterThan(0);
      expect(s.title.length, s.href).toBeGreaterThan(0);
      expect(s.lead.length, s.href).toBeGreaterThan(0);
      expect(s.does.length, s.href).toBeGreaterThan(0);
    }
  });

  it("全画面が登録済みのグループに属している", () => {
    const ids = new Set(SCREEN_GROUPS.map((g) => g.id));
    for (const s of SCREENS) {
      expect(ids.has(s.group), s.href).toBe(true);
    }
  });

  it("「ここでは見ないこと」「終わったら次に」のリンク先はすべて実在の画面", () => {
    for (const s of SCREENS) {
      for (const p of [s.notHere, s.next]) {
        if (p?.href) expect(getScreen(p.href), `${s.href} -> ${p.href}`).not.toBeNull();
      }
    }
  });

  /**
   * 依頼者の指示 (2026-08-09): 画面に出る括弧は全角にそろえる。
   * 半角括弧は前後の日本語と字間が詰まって読みにくく、画面ごとに混ざると落ち着かないため。
   */
  it("画面に出る文言に半角括弧を使わない", () => {
    const halfWidth = /[()]/;
    for (const g of SCREEN_GROUPS) {
      expect(halfWidth.test(g.label), `group ${g.id}: ${g.label}`).toBe(false);
    }
    for (const s of SCREENS) {
      for (const [field, value] of [
        ["label", s.label],
        ["title", s.title],
        ["lead", s.lead],
        ["does", s.does],
        ["desc", s.desc],
        ["notHere.text", s.notHere?.text],
        ["next.text", s.next?.text],
        ["notHere.linkLabel", s.notHere?.linkLabel],
        ["next.linkLabel", s.next?.linkLabel],
      ] as const) {
        if (value) expect(halfWidth.test(value), `${s.href} ${field}: ${value}`).toBe(false);
      }
    }
  });

  /**
   * 依頼者の指示 (2026-08-09): サイドバーには「絶対にこの情報が無いと分からない」ものだけを出す。
   * どこに出すかはグループの placement 1箇所で決まる。判断基準は docs/design-system.md §11-9。
   */
  it("全グループが置き場所(placement)を持つ", () => {
    for (const g of SCREEN_GROUPS) {
      expect(["sidebar", "account"], g.id).toContain(g.placement);
    }
  });

  it("運用・設定・仕様書の画面はサイドバーに常時出さない", () => {
    const accountIds = SCREEN_GROUPS.filter((g) => g.placement === "account").map((g) => g.id);
    expect(accountIds).toEqual(["spec", "account"]);
  });

  /**
   * 依頼者の指示 (2026-08-09): 「なぜこの画面だけ右側が空いているのか」が起きないよう、
   * 幅は画面ごとに決めず、この定義1箇所で決める。判断基準は docs/design-system.md §11-11。
   */
  it("幅の指定は wide か narrow のどちらかしか無い", () => {
    for (const s of SCREENS) {
      if (s.width !== undefined) {
        expect(["wide", "narrow"], s.href).toContain(s.width);
      }
    }
  });

  it("narrow にするのは読むだけの画面と1列のフォームだけ", () => {
    const narrow = SCREENS.filter((s) => s.width === "narrow").map((s) => s.href);
    expect(narrow.sort()).toEqual(
      ["/report", "/logic", "/profile", "/ai-settings", "/grid/report"].sort(),
    );
  });

  it("自分自身へは誘導しない(押しても何も起きないリンクを作らない)", () => {
    for (const s of SCREENS) {
      expect(s.notHere?.href).not.toBe(s.href);
      expect(s.next?.href).not.toBe(s.href);
    }
  });
});

describe("毎月の締めの工程順", () => {
  it("1から連番で欠けがない", () => {
    const orders = FLOW_SCREENS.map((s) => s.flowOrder);
    expect(orders).toEqual(FLOW_SCREENS.map((_, i) => i + 1));
  });

  it("取込 → 整形 → 手入力 → チェック → 収支表 の順に並ぶ", () => {
    expect(FLOW_SCREENS.map((s) => s.href)).toEqual([
      "/import",
      "/cleansing",
      "/manual-entry",
      "/anomaly",
      "/grid",
    ]);
  });

  it("flowPositionOf は前後の画面を返す", () => {
    const pos = flowPositionOf("/manual-entry");
    expect(pos?.index).toBe(3);
    expect(pos?.total).toBe(5);
    expect(pos?.prev?.href).toBe("/cleansing");
    expect(pos?.next?.href).toBe("/anomaly");
  });

  it("最初と最後は片側だけがnull", () => {
    expect(flowPositionOf("/import")?.prev).toBeNull();
    expect(flowPositionOf("/grid")?.next).toBeNull();
  });

  it("工程外の画面はnull", () => {
    expect(flowPositionOf("/dashboard")).toBeNull();
  });
});

describe("似た画面の見分け(依頼者から「どれを見ればよいか曖昧」と指摘された箇所)", () => {
  it("月次収支表は「1か月ぶん・車両ごと」と名乗る", () => {
    const s = getScreen("/grid");
    expect(s?.title).toContain("1か月");
    expect(s?.title).toContain("車両");
  });

  it("年間集計は「1年ぶん・月ごと」と名乗る", () => {
    const s = getScreen("/annual");
    expect(s?.title).toContain("1年");
    expect(s?.title).toContain("月");
  });

  it("チェックと要確認の一覧は互いを指し示す(同じ内容の別表示だと分かるように)", () => {
    expect(getScreen("/anomaly")?.notHere?.href).toBe("/todo");
    expect(getScreen("/todo")?.notHere?.href).toBe("/anomaly");
  });
});

describe("findScreen", () => {
  it("配下の深いパスも前方一致で拾う", () => {
    expect(findScreen("/vehicle/1234")?.href).toBe("/vehicle");
  });

  it("ルートは完全一致のときだけホーム", () => {
    expect(findScreen("/")?.href).toBe("/");
    expect(findScreen("/no-such-page")).toBeNull();
  });
});
