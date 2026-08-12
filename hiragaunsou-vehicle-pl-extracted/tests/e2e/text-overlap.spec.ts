import { test, expect, type Page, type TestInfo } from "@playwright/test";
import { SCREENS as SCREEN_DEFS } from "../../app/_lib/screens";
import { createTestUser, deleteTestUserByEmail, clearRateLimits } from "./helpers/testUsers";
import { getSessionCookie, injectSessionCookie } from "./helpers/loginAs";
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
 * 全画面で「文字が重なって読めない」箇所が無いことを、人が目視する前に見つける。
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
  "/vehicle": "/vehicle/1",
};

const SCREENS: readonly (readonly [string, string])[] = SCREEN_DEFS.map((screen) => [
  screen.label,
  E2E_PATHS[screen.href] ?? screen.href,
]);

/**
 * 検査する画面幅。
 * 1280 = 事務所のパソコン、768 = タブレット。狭い幅ほど文字は重なりやすい。
 */
const VIEWPORT_WIDTHS = [1280, 768] as const;

/**
 * 折りたたまれている中身も開いてから測る。
 * 率マスタ設定の重なりは、説明の折りたたみを開いた状態でだけ起きていた。
 */
async function openEverything(page: Page): Promise<void> {
  // details/summary の折りたたみ (Disclosure)
  await page.evaluate(() => {
    for (const d of Array.from(document.querySelectorAll("details"))) d.open = true;
  });
  // 押して中身を出す段階パネル (StagePanel)。開いた後に増えたパネルも拾えるよう繰り返す
  for (let round = 0; round < 3; round += 1) {
    const buttons = page.locator('button[aria-expanded="false"]');
    const count = await buttons.count();
    if (count === 0) break;
    for (let i = 0; i < count; i += 1) {
      const button = buttons.nth(i);
      // 開いた拍子に並びが変わることがあるので、押せないものは黙って飛ばす
      await button.click({ timeout: 2_000 }).catch(() => undefined);
    }
    await page.waitForTimeout(200);
  }
  await page.evaluate(() => {
    for (const d of Array.from(document.querySelectorAll("details"))) d.open = true;
  });
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
async function inspectScreen(page: Page): Promise<{ overlaps: Overlap[]; intrusions: StickyIntrusion[] }> {
  const overlaps = new Map<string, Overlap>();
  const intrusions = new Map<string, StickyIntrusion>();
  for (const position of ["top", "bottom"] as const) {
    await page.evaluate((p) => {
      window.scrollTo(0, p === "top" ? 0 : document.body.scrollHeight);
    }, position);
    await page.waitForTimeout(150);
    const { rects, stickyBoxes } = await collectTextRects(page);
    for (const overlap of findOverlaps(rects)) {
      overlaps.set(`${overlap.a.path}|${overlap.a.text}|${overlap.b.path}|${overlap.b.text}`, overlap);
    }
    for (const item of findStickyIntrusions(rects, stickyBoxes)) {
      intrusions.set(`${item.box.path}|${item.text.path}|${item.text.text}`, item);
    }
  }
  return { overlaps: [...overlaps.values()], intrusions: [...intrusions.values()] };
}

async function attachScreenshot(page: Page, info: TestInfo, name: string): Promise<void> {
  await info.attach(name, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
}

test.describe.configure({ mode: "serial" });

test.describe("全画面で文字が重なっていない", () => {
  let cookie: Awaited<ReturnType<typeof getSessionCookie>>;

  test.beforeAll(async ({ baseURL }) => {
    await clearRateLimits();
    await deleteTestUserByEmail(email);
    await createTestUser({ email, password, name: "重なり確認用管理者", role: "admin" });
    cookie = await getSessionCookie(baseURL!, email, password);
  });

  test.afterAll(async () => {
    await deleteTestUserByEmail(email);
  });

  for (const width of VIEWPORT_WIDTHS) {
    test(`画面幅 ${width}px: 折りたたみを開いた状態でも文字が重ならない`, { tag: "@overlap" }, async ({
      page,
      context,
    }, testInfo) => {
      test.setTimeout(600_000);
      await injectSessionCookie(context, cookie);
      await page.setViewportSize({ width, height: 800 });

      const failures: string[] = [];
      for (const [name, path] of SCREENS) {
        await page.goto(path, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(300);
        await openEverything(page);

        const where = `${name}（${width}px / ${path}）`;
        const found = await inspectScreen(page);
        const overlaps = found.overlaps.filter((o) => !isAllowed(o, path));
        if (overlaps.length > 0) failures.push(formatOverlaps(where, overlaps));
        if (found.intrusions.length > 0) failures.push(formatStickyIntrusions(where, found.intrusions));
        if (overlaps.length > 0 || found.intrusions.length > 0) {
          await attachScreenshot(page, testInfo, `${name}-${width}px.png`);
        }
      }

      expect(failures.join("\n\n"), "文字が重なって読めない箇所があります").toBe("");
    });
  }
});
