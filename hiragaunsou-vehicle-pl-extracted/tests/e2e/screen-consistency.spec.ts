import { test, expect, type Page } from "@playwright/test";
import { createTestUser, deleteTestUserByEmail, clearRateLimits } from "./helpers/testUsers";
import { getSessionCookie, injectSessionCookie } from "./helpers/loginAs";

/**
 * 全画面が同じ作法になっていることを固定する (docs/product/T7-ui-conventions.md)。
 *
 * 依頼者から挙がった3つの症状を、画面ごとに再発させないための守り:
 *   ② 画面ごとに上下の作りが違う      → ヘッダーとフッターが全画面にあること
 *   ③ 見えていないと困る情報が消える  → 下までスクロールしてもヘッダーが貼り付いたままであること
 *   ⑤ 何でも表になっている(狭い画面) → 375px でページ全体が横に溢れないこと
 *
 * 貼り付きは祖先の overflow 設定でいとも簡単に壊れる (T7 §2-1)。壊れても見た目は
 * ほぼ変わらず、スクロールして初めて分かるため、目視ではなくここで固定する。
 */

const email = "consistency-admin@example.com";
const password = "ConsistencyPassw0rd!";

const SCREENS: readonly (readonly [string, string])[] = [
  ["ホーム", "/"],
  ["ダッシュボード", "/dashboard"],
  ["月次収支表", "/grid"],
  ["確認の記録", "/grid/report"],
  ["要因分析レポート", "/report"],
  ["年間集計・対前年", "/annual"],
  ["チェック", "/anomaly"],
  ["赤字の理由", "/deficit"],
  ["データ整形", "/cleansing"],
  ["月次データ取込", "/import"],
  ["手入力", "/manual-entry"],
  ["直した内容の反映", "/master-changes"],
  ["データ設計・自動化方針", "/logic"],
  ["ToDoボード", "/todo"],
  ["利用状況", "/usage"],
  ["マイページ", "/profile"],
  ["AI設定", "/ai-settings"],
  ["率マスタ設定", "/rate-settings"],
  ["車両1台の明細", "/vehicle/1"],
  ["運転者マスタ管理", "/admin/driver-master"],
  ["車両マスタ管理", "/admin/vehicle-master"],
  ["ユーザー管理", "/admin/users"],
  ["取込データ管理", "/admin/import-batches"],
];

/**
 * 下まで一気にスクロールし、実際に動いた量を返す。
 * 中身が1画面に収まる画面は0が返る。その場合は「貼り付いているか」を確かめようがないので、
 * 呼び出し側で判定を飛ばす(0のまま判定すると、常に成功する意味のないテストになる)。
 */
async function scrollToBottom(page: Page): Promise<number> {
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(200);
  return page.evaluate(() => window.scrollY);
}

test.describe.configure({ mode: "serial" });

test.describe("全画面で上下の作りと貼り付きがそろっている", () => {
  let cookie: Awaited<ReturnType<typeof getSessionCookie>>;

  test.beforeAll(async ({ baseURL }) => {
    await clearRateLimits();
    await deleteTestUserByEmail(email);
    await createTestUser({ email, password, name: "作法確認用管理者", role: "admin" });
    cookie = await getSessionCookie(baseURL!, email, password);
  });

  test.afterAll(async () => {
    await deleteTestUserByEmail(email);
  });

  test("パソコンの幅: ヘッダーが貼り付いたままで、フッターが全画面にある", async ({ page, context }) => {
    test.setTimeout(240_000);
    await injectSessionCookie(context, cookie);
    await page.setViewportSize({ width: 1280, height: 720 });
    const scrolledScreens: string[] = [];

    for (const [name, path] of SCREENS) {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(300);

      // ヘッダーとフッターは共通レイアウト (AppShell) が出すので、全画面に必ずある
      const header = page.locator("header").first();
      await expect(header, `${name}: 画面の上の帯が無い`).toBeVisible();
      await expect(page.locator("footer").first(), `${name}: 画面の下の帯が無い`).toBeVisible();

      const scrolled = await scrollToBottom(page);
      if (scrolled === 0) continue; // 1画面に収まる画面は貼り付きを確かめられない
      scrolledScreens.push(name);

      const box = await header.boundingBox();
      expect(box, `${name}: 下までスクロールしたら上の帯が消えた`).not.toBeNull();
      // 画面のいちばん上に貼り付いたままであること (1px はブラウザの端数)
      expect(Math.abs(box!.y), `${name}: 上の帯が一緒にスクロールして流れていった`).toBeLessThanOrEqual(1);

      /*
        絞り込みの帯がある画面は、それも貼り付いたまま。
        貼り付く位置は「上の帯のすぐ下」と「上の帯 + 工程の帯の下」の2通りあり (T7 §2-2)、
        さらに中身が短い画面は貼り付く位置まで届かないまま下端に着く。よって固定値で当てにいかず、
        CSSが宣言している貼り付き位置 (top) と、スクロール量から出る本来の位置を突き合わせる。
      */
      const filter = await page.evaluate(() => {
        const el = document.querySelector('[data-sticky="filter"]');
        if (!(el instanceof HTMLElement)) return null;
        return { y: el.getBoundingClientRect().y, top: parseFloat(getComputedStyle(el).top) };
      });
      if (filter) {
        // 宣言した位置より上へは絶対に行かない (行くなら貼り付きが効いていない)
        expect(filter.y, `${name}: 絞り込みの帯が貼り付く位置より上へ流れていった`).toBeGreaterThanOrEqual(
          filter.top - 1,
        );
        // かつ、画面の内側に居残っていること
        expect(filter.y, `${name}: 絞り込みの帯が画面の外へ出た`).toBeLessThan(720);
      }
    }

    // 1画面も実際にスクロールしていないなら、上の判定は全部素通りしている
    expect(scrolledScreens.length, "スクロールする画面が1つも無く、貼り付きを確かめられていない").toBeGreaterThan(3);
  });

  /*
    表の列見出しは、ここまで一度も貼り付いていなかった (T7 §2-1)。
    横スクロールのために付けた枠が縦スクロールも引き受けてしまい、見出しは
    「ページのスクロール」ではなく「その枠のスクロール」に反応するようになるため。
    枠に高さの上限を与えて初めて効くので、効いていることをここで固定する。
  */
  test("高さを決めた表は、中を下までスクロールしても列見出しが残る", async ({ page, context }) => {
    test.setTimeout(240_000);
    await injectSessionCookie(context, cookie);
    await page.setViewportSize({ width: 1280, height: 720 });

    let checked = 0;
    for (const [name, path] of SCREENS) {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(300);

      const results = await page.evaluate(() => {
        const out: { moved: number; scrolled: number; position: string; top: string; capped: boolean }[] = [];
        for (const thead of document.querySelectorAll('[data-sticky="thead"]')) {
          const box = thead.closest("div");
          if (!(box instanceof HTMLElement) || !(thead instanceof HTMLElement)) continue;
          const boxStyle = getComputedStyle(box);
          const headStyle = getComputedStyle(thead);
          const before = thead.getBoundingClientRect().y - box.getBoundingClientRect().y;
          box.scrollTop = box.scrollHeight;
          const after = thead.getBoundingClientRect().y - box.getBoundingClientRect().y;
          out.push({
            moved: Math.abs(after - before),
            scrolled: box.scrollTop,
            position: headStyle.position,
            top: headStyle.top,
            // 高さの上限が無いと枠は縦に動かず、貼り付きは永久に効かない (T7 §2-1)
            capped: boxStyle.maxHeight !== "none",
          });
        }
        return out;
      });

      for (const r of results) {
        checked += 1;
        // 中身が少なくて枠が縦に動かない状態でも、効くための条件が揃っているかは確かめられる
        expect(r.position, `${name}: 表の列見出しが貼り付く設定になっていない`).toBe("sticky");
        expect(parseFloat(r.top), `${name}: 表の列見出しの貼り付き位置が枠の上端でない`).toBe(0);
        expect(r.capped, `${name}: 表の枠に高さの上限が無く、列見出しが貼り付きようがない`).toBe(true);
        if (r.scrolled === 0) continue; // 中身が枠に収まっている表は、動かして確かめようがない
        expect(r.moved, `${name}: 表の中を下まで動かしたら列見出しが一緒に流れていった`).toBeLessThanOrEqual(2);
      }
    }

    expect(checked, "高さを決めた表が1つも見つからず、列見出しの作りを確かめられていない").toBeGreaterThan(0);
  });

  test("スマホの幅(375px): ページ全体が横にはみ出さない", async ({ page, context }) => {
    test.setTimeout(240_000);
    await injectSessionCookie(context, cookie);
    await page.setViewportSize({ width: 375, height: 720 });

    for (const [name, path] of SCREENS) {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(300);

      /*
        描き終わる前に測ると一瞬だけ広く出ることがある(表の列幅が決まる前など)。
        溢れていると出たときだけ待って測り直し、それでも溢れるなら本物として扱う。
      */
      let overflow = 0;
      for (let i = 0; i < 3; i += 1) {
        overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        if (overflow <= 1) break;
        await page.waitForTimeout(500);
      }
      // 表そのものは横に動かして見る作り。溢れてよいのは表の枠の中だけで、ページ全体は溢れない
      expect(overflow, `${name}: ページ全体が横にはみ出している (${overflow}px)`).toBeLessThanOrEqual(1);
    }
  });
});
