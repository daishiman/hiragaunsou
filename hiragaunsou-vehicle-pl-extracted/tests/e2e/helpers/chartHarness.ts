import type { Page } from "@playwright/test";
import type { TrendBarsProps } from "../../../app/_components/charts/TrendBars";

/**
 * 本番のグラフ部品だけを白紙のページに描くための足場 (Node側)。
 *
 * playwright は .tsx を自分の JSX 変換で読むため、React の部品をそのまま
 * 呼び出せない (React要素ではなく playwright 独自の値になる)。そこで
 * tests/e2e/fixtures/chartHarness.tsx を vite で1つのJSにまとめ、
 * setContent で読み込ませる。まとめるのは1回だけで、以降は使い回す。
 */

let bundle: Promise<string> | null = null;

async function buildHarness(): Promise<string> {
  const { build } = await import("vite");
  const react = (await import("@vitejs/plugin-react")).default;
  const result = await build({
    configFile: false,
    logLevel: "error",
    // 開発用のReactは描画のたびに余計な検査が走るため、本番相当でまとめる
    mode: "production",
    /*
      React は process.env.NODE_ENV を直接読む。ブラウザには process が無いので、
      ここで文字列に置き換えておかないと読み込んだ瞬間に落ちる (グラフが1つも描かれない)。
    */
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [react()],
    build: {
      write: false,
      minify: false,
      lib: {
        entry: "tests/e2e/fixtures/chartHarness.tsx",
        formats: ["iife"],
        name: "ChartHarness",
        fileName: () => "chartHarness.js",
      },
    },
  });
  const output = Array.isArray(result) ? result[0] : result;
  if (!output || !("output" in output)) throw new Error("グラフ検査用の足場をまとめられませんでした");
  const chunk = output.output[0];
  if (chunk.type !== "chunk") throw new Error("グラフ検査用の足場にJSが含まれていません");
  return chunk.code;
}

/**
 * 白紙のページを開き、グラフを描ける状態にする。
 *
 * 文字の幅はフォントで変わるので、本番 (app/globals.css の body) と同じ指定を置く。
 * ここが違うと、本番では重なるものが検査では重ならない (逆もある)。
 */
export async function openChartHarness(page: Page): Promise<void> {
  bundle ??= buildHarness();
  await page.setContent(
    `<!doctype html><html lang="ja"><head><meta charset="utf-8"><style>
      :root { --line: #d8dee9; --ink: #1a2230; --ink-muted: #5b6676; --brand: #2f5d9e; --danger: #c0392b; }
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body {
        font-family: "Helvetica Neue", Arial, "Hiragino Kaku Gothic ProN", "Hiragino Sans",
          "Noto Sans JP", Meiryo, sans-serif;
        font-feature-settings: "palt";
        background: #fff;
      }
      /* 本番のカードの中と同じ幅の使い方 (svg は block max-w-full。幅は部品が px で決める) */
      #chart-host svg { display: block; max-width: 100%; }
      .m-0 { margin: 0; }
    </style></head><body><div id="chart-host"></div></body></html>`,
  );
  await page.addScriptTag({ content: await bundle });
}

/** 検査用の数字でグラフを描き、描き終わるまで待つ。 */
export async function renderTrendBars(
  page: Page,
  props: TrendBarsProps,
  caseMarker: string,
): Promise<void> {
  await page.evaluate(
    ({ chartProps, marker }) => {
      (
        window as unknown as {
          renderTrendBars: (props: unknown, caseMarker: string) => void;
        }
      ).renderTrendBars(chartProps, marker);
    },
    { chartProps: props as unknown as Record<string, unknown>, marker: caseMarker },
  );
  await page.waitForFunction(
    (marker) => document.getElementById("chart-host")?.dataset.renderedCase === marker,
    caseMarker,
  );
  /*
    グラフは置かれた場所の幅を測ってから px で描き直す (viewBox を引き伸ばさない)。
    測る前の仮の幅のまま測定すると、本番では起きない重なりを拾ってしまうので、
    実寸で描き直したことを確かめてから先へ進む。
  */
  await page.waitForFunction(() => {
    const host = document.getElementById("chart-host");
    const figure = host?.querySelector("figure");
    return figure instanceof HTMLElement && Number(figure.dataset.chartWidth) > 0;
  });
  // React の描画とブラウザの字組みが終わってから測る
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve(null))));
}
