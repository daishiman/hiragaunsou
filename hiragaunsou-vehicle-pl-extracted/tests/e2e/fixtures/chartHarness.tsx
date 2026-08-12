import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { TrendBars, type TrendBarsProps } from "../../../app/_components/charts/TrendBars";

/**
 * グラフだけを白紙のページに描くための入口 (ブラウザ側)。
 *
 * 本番の画面を開いてグラフを検査すると、そのとき取り込まれているデータ次第の検査になり、
 * 「赤字の月がある13ヶ月」のような、いちばん壊れやすい形を再現できない。
 * ここでは本番のグラフ部品をそのまま呼び、検査用の数字だけを差し替えて描く。
 * 部品は本番と同一なので、ここで重ならなければ本番でも重ならない。
 *
 * このファイルは tests/e2e/helpers/chartHarness.ts が vite で1つにまとめてから
 * page.setContent で読み込ませる (本番のビルドには一切入らない)。
 */
declare global {
  interface Window {
    renderTrendBars: (props: TrendBarsProps, caseMarker: string) => void;
  }
}

let root: Root | null = null;

window.renderTrendBars = (props, caseMarker) => {
  const host = document.getElementById("chart-host");
  if (!host) throw new Error("chart-host が無い");
  root ??= createRoot(host);
  // root.render は非同期なので、前ケースのDOMを測って緑になるのを防ぐ。
  flushSync(() => root!.render(<TrendBars {...props} />));
  host.dataset.renderedCase = caseMarker;
};
