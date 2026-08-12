import { test, expect } from "@playwright/test";
import { openChartHarness, renderTrendBars } from "./helpers/chartHarness";
import { CHART_CASES } from "./fixtures/chartCases";
import { collectTextRects, findOverlaps, formatOverlaps } from "./helpers/textOverlap";

/**
 * グラフの中の文字が重ならないことを、期間・符号・桁の組み合わせで総当たりする。
 *
 * 依頼者から届いた最初の指摘は「7月の赤字の金額と、月の名前が重なって読めない」だった。
 * これは通常のDOMの外 (SVGの描画座標) で起きるため、画面を開いて見るだけの検査では
 * 拾えない。しかも本番の画面で見えるのは「そのとき取り込まれている数字」だけなので、
 * 赤字の月が無ければ永久に再現しない。
 *
 * そこで本番のグラフ部品そのものを白紙のページに描き、壊れやすい数字の組み合わせ
 * (tests/e2e/fixtures/chartCases.ts) を順に流し込んで、描かれた文字同士の重なりを見る。
 * サーバーもログインも要らないので数秒で終わる。
 */

/**
 * グラフが置かれる幅。
 * 広い画面のカード幅と、タブレットで2段組みが1列に折り返したときの幅。
 * (SVGは幅に合わせて丸ごと拡大縮小するので、文字同士の重なり方は幅では変わらない。
 *  それでも2通り見るのは、丸めの誤差で崩れないことまで含めて確かめるため)
 */
const CHART_WIDTHS = [920, 360] as const;

test.describe("グラフの中で文字が重ならない", () => {
  for (const width of CHART_WIDTHS) {
    test(`グラフの幅 ${width}px: 期間・符号・桁のどの組み合わせでも重ならない`, { tag: "@overlap" }, async ({
      page,
    }, testInfo) => {
      test.setTimeout(180_000);
      await page.setViewportSize({ width: width + 40, height: 900 });
      await openChartHarness(page);
      await page.evaluate((w) => {
        const host = document.getElementById("chart-host");
        if (host) host.style.width = `${w}px`;
      }, width);

      const failures: string[] = [];
      for (const chartCase of CHART_CASES) {
        await renderTrendBars(page, chartCase.props);

        const { rects } = await collectTextRects(page);
        // 白紙に描いているので、文字が1つも無いなら描画に失敗している
        expect(rects.length, `${chartCase.name}: グラフに文字が1つも描かれていない`).toBeGreaterThan(0);

        const overlaps = findOverlaps(rects);
        if (overlaps.length > 0) {
          failures.push(formatOverlaps(`${chartCase.name}（グラフ幅 ${width}px）`, overlaps));
          await testInfo.attach(`${chartCase.name}-${width}px.png`, {
            body: await page.screenshot(),
            contentType: "image/png",
          });
        }
      }

      expect(failures.join("\n\n"), "グラフの中で文字が重なって読めません").toBe("");
    });
  }
});
