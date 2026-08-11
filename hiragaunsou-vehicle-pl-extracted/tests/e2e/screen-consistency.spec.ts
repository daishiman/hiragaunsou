import { test, expect, type Page } from "@playwright/test";
import { SCREENS as SCREEN_DEFS } from "../../app/_lib/screens";
import { createTestUser, deleteTestUserByEmail, clearRateLimits } from "./helpers/testUsers";
import { getSessionCookie, injectSessionCookie } from "./helpers/loginAs";

/**
 * 全画面が同じ作法になっていることを固定する (docs/product/T7-ui-conventions.md)。
 *
 * 依頼者から挙がった3つの症状を、画面ごとに再発させないための守り:
 *   ② 画面ごとに上下の作りが違う      → ヘッダーとフッターが全画面にあること
 *   ③ 見えていないと困る情報が消える  → 下までスクロールしてもヘッダーが貼り付いたままであること
 *   ⑤ 何でも表になっている(狭い画面) → 375 / 768 / 1280 / 1600px でページ全体が横に溢れないこと
 *
 * 貼り付きは祖先の overflow 設定でいとも簡単に壊れる (T7 §2-1)。壊れても見た目は
 * ほぼ変わらず、スクロールして初めて分かるため、目視ではなくここで固定する。
 */

const email = "consistency-admin@example.com";
const password = "ConsistencyPassw0rd!";

/**
 * 画面名とrouteをE2Eへ転記しない。新しい画面をSCREENSへ足したら、この検収も同時に増える。
 * 動的routeだけ、実際に開けるfixture pathへ変換する。
 */
const E2E_PATHS: Readonly<Partial<Record<string, string>>> = {
  "/vehicle": "/vehicle/1",
};

const SCREENS: readonly (readonly [string, string])[] = SCREEN_DEFS.map((screen) => [
  screen.label,
  E2E_PATHS[screen.href] ?? screen.href,
]);

const VIEWPORT_WIDTHS = [375, 768, 1280, 1600] as const;

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
    test.setTimeout(720_000);
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

      // top値を個別に満たしていても、2本のsticky帯が同じ位置なら一方が隠れる。
      // 共通ヘッダー・工程帯・絞り込み帯の実矩形が互いに重ならないことまで確認する。
      const stickyRects = await page.evaluate(() => {
        const elements = [
          document.querySelector("header"),
          ...document.querySelectorAll('.screen-step-header, [data-sticky="filter"]'),
        ].filter((element): element is HTMLElement => element instanceof HTMLElement);

        return elements
          .map((element) => {
            const rect = element.getBoundingClientRect();
            return {
              name:
                element.getAttribute("data-sticky") ??
                (element.classList.contains("screen-step-header") ? "stepHeader" : "appHeader"),
              top: rect.top,
              bottom: rect.bottom,
              visible: rect.bottom > 0 && rect.top < window.innerHeight,
            };
          })
          .filter((rect) => rect.visible)
          .sort((a, b) => a.top - b.top);
      });
      for (let index = 1; index < stickyRects.length; index += 1) {
        const previous = stickyRects[index - 1]!;
        const current = stickyRects[index]!;
        expect(
          current.top,
          `${name}: ${previous.name} と ${current.name} が重なっている`,
        ).toBeGreaterThanOrEqual(previous.bottom - 1);
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
    test.setTimeout(720_000);
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

  test("4つの基準幅で、ページ全体が横にはみ出さない", async ({ page, context }) => {
    test.setTimeout(720_000);
    await injectSessionCookie(context, cookie);

    // 幅ごとに同じrouteを再読込すると 23 × 4 = 92回のサーバー描画になる。
    // レスポンシブ配置は同一DOMへのviewport変更で発火するため、画面ごとに
    // 1回だけ読み込み、その場で4幅を測る。
    await page.setViewportSize({ width: VIEWPORT_WIDTHS.at(-1)!, height: 720 });
    for (const [name, path] of SCREENS) {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(300);

      for (const width of VIEWPORT_WIDTHS) {
        await page.setViewportSize({ width, height: 720 });
        await page.waitForTimeout(100);

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
        expect(
          overflow,
          `${name}（${width}px）: ページ全体が横にはみ出している (${overflow}px)`,
        ).toBeLessThanOrEqual(1);
      }
    }
  });

  test("認証外の表示画面とリダイレクトaliasも共通フッターを保つ", async ({ page }) => {
    await page.goto("/sign-in", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "車両別収支表" })).toBeVisible();
    await expect(page.locator("footer")).toContainText("車両収支管理システム");

    await page.goto("/reset-password", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/sign-in$/);
    await expect(page.locator("footer")).toContainText("車両収支管理システム");

    await page.goto("/screen-consistency-not-found", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("このページは見つかりませんでした")).toBeVisible();
    await expect(page.locator("footer")).toContainText("車両収支管理システム");
  });
});
