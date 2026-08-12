import { test, expect } from "@playwright/test";
import { openChartHarness, renderTrendBars } from "./helpers/chartHarness";
import { CHART_CASES } from "./fixtures/chartCases";
import { collectTextRects, findOverlaps, formatOverlaps } from "./helpers/textOverlap";

/**
 * グラフの中の文字が重ならないことを、期間・符号・桁の代表境界ケースで確かめる。
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
 * グラフは置かれた場所の幅を測って px で描くようになった (拡大縮小しない) ため、
 * 幅が変われば棒の数・間引き・値ラベルの出し方まで変わる。つまり幅ごとに別の検査になる。
 * 大きな画面 / 一般的なノートPC / タブレットで1列に折り返したときの3通りを見る。
 */
const CHART_WIDTHS = [1280, 920, 360] as const;

test.describe("グラフの中で文字が重ならない", () => {
  for (const width of CHART_WIDTHS) {
    test(
      `グラフの幅 ${width}px: 期間・符号・桁の代表境界ケースで重ならない`,
      { tag: "@overlap" },
      async ({ page }, testInfo) => {
        test.setTimeout(180_000);
        await page.setViewportSize({ width: width + 40, height: 900 });
        await openChartHarness(page);
        await page.evaluate((w) => {
          const host = document.getElementById("chart-host");
          if (host) host.style.width = `${w}px`;
        }, width);

        const failures: string[] = [];
        for (const chartCase of CHART_CASES) {
          const marker = `${width}:${chartCase.name}`;
          await renderTrendBars(page, chartCase.props, marker);

          const chart = page.getByRole("img", { name: `${chartCase.props.title}の月次推移` });
          await expect(chart, `${chartCase.name}: 今回のグラフが描かれていない`).toBeVisible();
          for (const label of chartCase.expectedLabels) {
            await expect(
              page.getByText(label, { exact: true }),
              `${chartCase.name}: 期待したラベル「${label}」が描かれていない`,
            ).toBeVisible();
          }

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
      },
    );
  }
});
