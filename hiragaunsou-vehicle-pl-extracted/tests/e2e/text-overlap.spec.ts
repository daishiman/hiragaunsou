import { test, expect, type Page, type TestInfo } from "@playwright/test";
import { SCREENS as SCREEN_DEFS, type ScreenDef } from "../../app/_lib/screens";
import {
  createTestUser,
  deleteTestUserByEmail,
  clearRateLimits,
} from "./helpers/testUsers";
import { getSessionCookie, injectSessionCookie } from "./helpers/loginAs";
import {
  cleanupTextOverlapVehicle,
  seedTextOverlapVehicle,
  TEXT_OVERLAP_VEHICLE_NO,
  TEXT_OVERLAP_YEAR_MONTH,
} from "./helpers/textOverlapFixtures";
import {
  collectTextRects,
  findOverlaps,
  findStickyIntrusions,
  isAllowed,
  formatOverlaps,
  formatStickyIntrusions,
  type Overlap,
  type StickyIntrusion,
} from "./helpers/textOverlap";

/**
 * 認証後の画面カタログ全件で「文字が重なって読めない」箇所が無いことを、
 * 人が目視する前に見つける。
 *
 * これまで文字の重なりは、依頼者がスクリーンショットを送ってきて初めて発覚していた。
 * 直した箇所を固定する回帰テストだけでは、次に作る画面で同じことが起きる。
 * だから画面ごとにテストを書かず、**画面カタログ (app/_lib/screens.catalog.ts) を出典に
 * 総当たり**する。画面を1枚足せば、その画面は自動的にこの検査の対象になる。
 *
 * 判定の中身と誤検出の落とし方は tests/e2e/helpers/textOverlap.ts を参照。
 * グラフの中の文字 (SVG) は、実データに左右されない形で
 * tests/e2e/chart-text-overlap.spec.ts が期間・符号の組み合わせごとに検査する。
 */

const email = "overlap-admin@example.com";
const password = "OverlapPassw0rd!";

/** 動的routeだけ、実際に開けるパスへ変換する (screen-consistency.spec.ts と同じ方針)。 */
const E2E_PATHS: Readonly<Partial<Record<string, string>>> = {
  "/vehicle": `/vehicle/${TEXT_OVERLAP_VEHICLE_NO}?ym=${TEXT_OVERLAP_YEAR_MONTH}`,
};

const SCREENS: readonly { screen: ScreenDef; path: string }[] = SCREEN_DEFS.map(
  (screen) => ({
    screen,
    path: E2E_PATHS[screen.href] ?? screen.href,
  }),
);

/**
 * UI規約が基準にしている4幅。
 * 375 = スマートフォン、768 = タブレット、1280 / 1600 = 事務所のパソコン。
 */
const VIEWPORT_WIDTHS = [375, 768, 1280, 1600] as const;

/**
 * 折りたたまれている中身も開いてから測る。
 * 率マスタ設定の重なりは、説明の折りたたみを開いた状態でだけ起きていた。
 */
async function openEverything(page: Page): Promise<void> {
  // details/summary の折りたたみ (Disclosure)
  await page.evaluate(() => {
    for (const d of Array.from(document.querySelectorAll("details")))
      d.open = true;
  });
  await expect(
    page.locator("details:not([open])"),
    "開けなかったDisclosureがある",
  ).toHaveCount(0);

  /*
    StagePanelだけを対象にする。全aria-expandedを押すと、サイドバーやアカウントメニューまで
    開いて「本文を全部見る」という目的から外れる。section.card直下の見出し行にあるボタンが
    StagePanelの契約で、押した後は必ずaria-expanded=trueになったことまで確認する。
  */
  const stagePanelButtons = page.locator(
    "section.card > div:first-child button[aria-expanded]",
  );
  for (let opened = 0; ; opened += 1) {
    let closedIndex = -1;
    for (let index = 0; index < (await stagePanelButtons.count()); index += 1) {
      if ((await stagePanelButtons.nth(index).getAttribute("aria-expanded")) === "false") {
        closedIndex = index;
        break;
      }
    }
    if (closedIndex < 0) break;
    expect(opened, "StagePanelの展開が収束しない").toBeLessThan(50);
    // falseだけに絞ったlocatorは、click後に自分自身を見失う。
    // aria-expandedの有無で固定した一覧のindexから参照し、同じbuttonの変化を見る。
    const button = stagePanelButtons.nth(closedIndex);
    await button.click({ timeout: 2_000 });
    await expect(
      button,
      "StagePanelを押しても展開されなかった",
    ).toHaveAttribute("aria-expanded", "true");
  }
  await expect(
    page.locator('section.card > div:first-child button[aria-expanded="false"]'),
    "閉じたままのStagePanelがある",
  ).toHaveCount(0);

  // StagePanelの中にDisclosureが増える場合にも対応する。
  await page.evaluate(() => {
    for (const d of Array.from(document.querySelectorAll("details")))
      d.open = true;
  });
  await expect(
    page.locator("details:not([open])"),
    "開けなかったDisclosureがある",
  ).toHaveCount(0);
  await page.waitForTimeout(200);
}

/**
 * 1画面ぶんの「読めない箇所」を集める。2種類ある。
 *   overlaps  : 文字どうしが重なっている
 *   intrusions: 貼り付く帯 (下地が透けない板) の下に、帯の中身でない文字が入り込んでいる
 *
 * 上端と下端の2か所で測る。位置によって出方が変わる画面 (遅れて出る中身など) を拾うため。
 * 貼り付きは測る直前に解除して本来の位置に戻している (textOverlap.ts) ので、
 * 「スクロール中に帯が本文の上を通る」という仕様どおりの重なりは数えない。
 */
async function inspectScreen(page: Page): Promise<{
  overlaps: Overlap[];
  intrusions: StickyIntrusion[];
  minRectCount: number;
}> {
  const overlaps = new Map<string, Overlap>();
  const intrusions = new Map<string, StickyIntrusion>();
  let minRectCount = Number.POSITIVE_INFINITY;
  for (const position of ["top", "bottom"] as const) {
    await page.evaluate((p) => {
      window.scrollTo(0, p === "top" ? 0 : document.body.scrollHeight);
    }, position);
    await page.waitForTimeout(150);
    const { rects, stickyBoxes } = await collectTextRects(page);
    minRectCount = Math.min(minRectCount, rects.length);
    for (const overlap of findOverlaps(rects)) {
      overlaps.set(
        `${overlap.a.path}|${overlap.a.text}|${overlap.b.path}|${overlap.b.text}`,
        overlap,
      );
    }
    for (const item of findStickyIntrusions(rects, stickyBoxes)) {
      intrusions.set(
        `${item.box.path}|${item.text.path}|${item.text.text}`,
        item,
      );
    }
  }
  return {
    overlaps: [...overlaps.values()],
    intrusions: [...intrusions.values()],
    minRectCount,
  };
}

async function attachScreenshot(
  page: Page,
  info: TestInfo,
  name: string,
): Promise<void> {
  await info.attach(name, {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
}

test.describe.configure({ mode: "serial" });

test(
  "検査器の陽性対照: 意図的に重ねたDOM文字を必ず検出する",
  { tag: "@overlap" },
  async ({ page }) => {
    await page.setContent(`<!doctype html><html lang="ja"><body>
      <div style="position:absolute;left:20px;top:20px;font:20px sans-serif">重なりA</div>
      <div style="position:absolute;left:20px;top:20px;font:20px sans-serif">重なりB</div>
    </body></html>`);

    const { rects } = await collectTextRects(page);
    expect(
      rects.length,
      "陽性対照の文字矩形を収集できていない",
    ).toBeGreaterThanOrEqual(2);
    expect(
      findOverlaps(rects).length,
      "意図的なDOM文字の重なりを検出できていない",
    ).toBeGreaterThan(0);
  },
);

test(
  "検査器の陽性対照: 親の直接文字とabsolute子文字の重なりを検出する",
  { tag: "@overlap" },
  async ({ page }) => {
    await page.setContent(`<!doctype html><html lang="ja"><body>
      <div style="position:absolute;left:20px;top:20px;font:20px sans-serif">親文字<span style="position:absolute;left:0;top:0">子文字</span></div>
    </body></html>`);

    const { rects } = await collectTextRects(page);
    const parent = rects.find(({ text }) => text === "親文字");
    const child = rects.find(({ text }) => text === "子文字");
    expect(parent, "親の直接テキスト矩形を収集できていない").toBeDefined();
    expect(child, "absolute子テキスト矩形を収集できていない").toBeDefined();
    expect(child!.ancestors, "親子関係のfixtureになっていない").toContain(parent!.id);
    expect(
      findOverlaps([parent!, child!]).length,
      "親子関係を無条件除外して重なりを見逃している",
    ).toBeGreaterThan(0);
  },
);

test.describe("認証後の画面カタログで文字が重なっていない", () => {
  let cookie: Awaited<ReturnType<typeof getSessionCookie>>;

  test.beforeAll(async ({ baseURL }) => {
    await clearRateLimits();
    await deleteTestUserByEmail(email);
    await cleanupTextOverlapVehicle();
    await seedTextOverlapVehicle();
    await createTestUser({
      email,
      password,
      name: "重なり確認用管理者",
      role: "admin",
    });
    cookie = await getSessionCookie(baseURL!, email, password);
  });

  test.afterAll(async () => {
    await cleanupTextOverlapVehicle();
    await deleteTestUserByEmail(email);
  });

  test(
    "4つの基準幅: 全routeが正しく描画され、折りたたみを開いても文字が重ならない",
    { tag: "@overlap" },
    async ({ page, context }, testInfo) => {
      test.setTimeout(1_200_000);
      await injectSessionCookie(context, cookie);
      // routeごとに1回だけloadし、レスポンシブ配置は同じDOMのviewport切替で測る。
      await page.setViewportSize({
        width: VIEWPORT_WIDTHS.at(-1)!,
        height: 800,
      });

      const failures: string[] = [];
      for (const { screen, path } of SCREENS) {
        const response = await page.goto(path, {
          waitUntil: "domcontentloaded",
        });
        expect(
          response,
          `${screen.label}: navigation responseが無い`,
        ).not.toBeNull();
        expect(
          response!.ok(),
          `${screen.label}: HTTP ${response!.status()} で描画できていない`,
        ).toBe(true);

        const expectedUrl = new URL(path, "http://e2e.local");
        const actualUrl = new URL(page.url());
        expect(
          actualUrl.pathname,
          `${screen.label}: 別routeへredirectされた`,
        ).toBe(expectedUrl.pathname);
        expect(actualUrl.search, `${screen.label}: queryが失われた`).toBe(
          expectedUrl.search,
        );

        const h1 = page.getByRole("heading", { level: 1 }).first();
        if (screen.href === "/vehicle") {
          // 動的詳細だけはScreenDef.titleを車番で上書きするのが既存の画面契約。
          await expect(h1, `${screen.label}: 車両詳細のh1が違う`).toHaveText(
            `車番 ${TEXT_OVERLAP_VEHICLE_NO}`,
          );
        } else if (screen.href === "/grid/report") {
          // 印刷画面はScreenDef.titleの前に対象年月を付ける。
          await expect(
            h1,
            `${screen.label}: ScreenDef.titleを含むh1が無い`,
          ).toContainText(screen.title);
        } else {
          await expect(
            h1,
            `${screen.label}: ScreenDef.titleのh1が無い`,
          ).toHaveText(screen.title);
        }

        await page.waitForTimeout(300);
        await openEverything(page);

        for (const width of VIEWPORT_WIDTHS) {
          await page.setViewportSize({ width, height: 800 });
          await page.waitForTimeout(150);

          const where = `${screen.label}（${width}px / ${path}）`;
          const found = await inspectScreen(page);
          expect(
            found.minRectCount,
            `${where}: 文字矩形が0件で、空描画を検査している`,
          ).toBeGreaterThan(0);

          const overlaps = found.overlaps.filter(
            (o) => !isAllowed(o, expectedUrl.pathname),
          );
          if (overlaps.length > 0)
            failures.push(formatOverlaps(where, overlaps));
          if (found.intrusions.length > 0)
            failures.push(formatStickyIntrusions(where, found.intrusions));
          if (overlaps.length > 0 || found.intrusions.length > 0) {
            await attachScreenshot(
              page,
              testInfo,
              `${screen.label}-${width}px.png`,
            );
          }
        }
      }

      expect(
        failures.join("\n\n"),
        "文字が重なって読めない箇所があります",
      ).toBe("");
    },
  );
});
