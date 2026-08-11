import type { ExcelReconcileVehicle, ExcelReconcileResult } from "../../../src/domain/rules/excelReconciliation";
import { num, yen } from "../../_lib/format";

/** 既定で開いたまま見せる車両数。残りは展開に畳む。 */
const TOP_VEHICLES = 5;

/**
 * 完成済みExcelとの車番別の差異一覧。
 *
 * 差はExcel上の手作業(列の入れ違い・二重入力・ブック間の不整合)で生じており、
 * システムはヘッダー定義どおりに計算する(Excelには合わせない)方針。
 * ただし画面では原因を断定せず、差がある事実だけを中立に提示して判断は人に委ねる。
 *
 * ■ 表か、カードか (T7 §4-1 の質問への回答)
 * ここで人がやりたいのは「Excelの値とシステムの値と差額を横に並べて見比べること」なので表にする。
 * 共通の DataTable ではなく素の table のままにしているのは、1台に複数項目がぶら下がる形を
 * 車番の rowSpan でまとめているため (DataTable は1行1レコードで rowSpan を表せない)。
 * 「残りN台」は行数が読めないので、T7 §2-1 に従い箱に高さの上限を与えて縦スクロールにし、
 * 列見出しを固定する (overflow-x だけの箱では sticky が効かないため、高さの上限が要る)。
 */
export function ExcelReconcileList({ result }: { result: ExcelReconcileResult }) {
  if (!result.hasExcel) return null;

  const top = result.vehicles.slice(0, TOP_VEHICLES);
  const rest = result.vehicles.slice(TOP_VEHICLES);

  return (
    <section className="mt-4 card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-bold text-ink">Excelとの差異</h2>
        <p className="num text-xs text-ink-muted">
          突合 {num(result.comparedCount)}台 / 差異 {num(result.vehicles.length)}台・
          {num(result.mismatchItemCount)}項目
        </p>
      </div>
      <p className="mt-1 text-xs text-ink-muted">
        表ごとの定義どおりに計算すると、以下の項目でExcelと値が異なります。
      </p>

      {result.vehicles.length === 0 ? (
        <p className="mt-3 text-sm text-ink">
          <span className="font-bold">全{num(result.comparedCount)}台が一致</span>
          <span className="ml-2 text-xs text-ink-muted">
            Excelと突き合わせた項目に差はありません。このまま下の「この月を確定する」へ進めます。
          </span>
        </p>
      ) : (
        <>
          <div className="mt-3 overflow-x-auto">
            <MismatchTable vehicles={top} />
          </div>
          {rest.length > 0 && (
            <details className="mt-2 rounded-lg border border-line">
              <summary className="cursor-pointer list-none px-4 py-3 text-sm font-bold text-ink hover:bg-subtle">
                残り<span className="num">{num(rest.length)}</span>台を見る
                <span className="ml-2 text-xs font-normal text-ink-muted">差額の小さい順に続きます</span>
              </summary>
              <div
                className="overflow-auto border-t border-line"
                style={{ maxHeight: "min(50vh, 24rem)" }}
              >
                <MismatchTable vehicles={rest} stickyHead />
              </div>
            </details>
          )}
        </>
      )}

      {(result.excelOnlyCount > 0 || result.systemOnlyCount > 0) && (
        <p className="num mt-2 text-xs text-ink-muted">
          Excelにのみある車両 {num(result.excelOnlyCount)}台 / システムにのみある車両{" "}
          {num(result.systemOnlyCount)}台（突合対象外）
        </p>
      )}
    </section>
  );
}

function MismatchTable({
  vehicles,
  stickyHead = false,
}: {
  vehicles: ExcelReconcileVehicle[];
  stickyHead?: boolean;
}) {
  const headCell = `px-3 py-2 font-medium${stickyHead ? " sticky top-0 z-10 bg-subtle" : ""}`;
  return (
    <table className="w-full min-w-max border-collapse text-xs">
      <caption className="sr-only">Excelとシステムで値が異なる車番別の金額（円）</caption>
      <thead>
        <tr className="border-b border-line bg-subtle text-ink-muted">
          <th className={`${headCell} text-left`}>車番</th>
          <th className={`${headCell} text-left`}>項目</th>
          <th className={`${headCell} text-right`}>Excel（円）</th>
          <th className={`${headCell} text-right`}>システム（円）</th>
          <th className={`${headCell} text-right`}>差（円）</th>
        </tr>
      </thead>
      <tbody>
        {vehicles.map((vehicle) =>
          vehicle.items.map((item, index) => (
            <tr key={`${vehicle.vehicleNo}-${item.field}`} className="border-b border-line last:border-b-0">
              {index === 0 && (
                <th
                  scope="rowgroup"
                  rowSpan={vehicle.items.length}
                  className="num border-r border-line px-3 py-2 text-left align-top font-bold text-ink"
                >
                  {vehicle.vehicleNo}
                </th>
              )}
              <td className="px-3 py-2">{item.label}</td>
              <td className="num px-3 py-2 text-right">{yen(item.excel)}</td>
              <td className="num px-3 py-2 text-right">{yen(item.system)}</td>
              <td className="num px-3 py-2 text-right font-bold">{yen(item.diff)}</td>
            </tr>
          )),
        )}
      </tbody>
    </table>
  );
}
