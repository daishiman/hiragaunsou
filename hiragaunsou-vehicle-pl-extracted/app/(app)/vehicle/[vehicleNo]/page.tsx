import Link from "next/link";
import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../../src/infrastructure/auth/accessControl";
import { createDb } from "../../../../src/infrastructure/db/client";
import { D1VehiclePlRepository } from "../../../../src/infrastructure/db/D1VehiclePlRepository";
import { GetVehicleHistoryUseCase } from "../../../../src/usecase/steps/getVehicleHistory";
import { currentYearMonth } from "../../../_lib/yearMonth";
import { kmPriceLabel, num, yen, yearMonthLabel } from "../../../_lib/format";
import { PageHead } from "../../../_components/PageHead";
import { EmptyState } from "../../../_components/EmptyState";
import { BarRow } from "../../../_components/BarRow";

/**
 * 車両ドリルダウン (モック view-grid.js の車両モーダルに対応)。
 * 単月の経費内訳・12ヶ月推移・実力損益を1画面にまとめる。
 * モックではモーダルだったが、URLで共有・戻る操作ができるページとして実装している。
 */
export default async function VehicleDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ vehicleNo: string }>;
  searchParams: Promise<{ ym?: string }>;
}) {
  const session = await getServerSession();
  if (!session) redirect("/sign-in");
  if (!checkAccess(session, "view")) redirect("/");

  const { vehicleNo: rawVehicleNo } = await params;
  const vehicleNo = decodeURIComponent(rawVehicleNo);
  const { ym } = await searchParams;
  const yearMonth = ym || currentYearMonth();

  const { env } = await getCloudflareContext({ async: true });
  const db = createDb(env.DB);
  const data = await new GetVehicleHistoryUseCase(new D1VehiclePlRepository(db)).execute(
    vehicleNo,
    yearMonth,
  );

  const current = data.current;
  const expenseMax = Math.max(...data.costBreakdown.map((c) => c.value), 1);
  const profitMax = Math.max(...data.history.map((h) => Math.abs(h.profit)), 1);

  return (
    <>
      <PageHead
        kind="data"
        title={`車番 ${vehicleNo}`}
        lead={
          current
            ? `${current.type} / ${current.depot} / 運転者 ${current.driver ?? "—"} — ${yearMonthLabel(yearMonth)}`
            : `${yearMonthLabel(yearMonth)}のデータ`
        }
        action={
          <Link
            href={`/grid?ym=${yearMonth}`}
            className="pressable inline-block rounded-md border border-line bg-white px-4 py-2 text-sm text-ink hover:bg-subtle"
          >
            月次収支表へ戻る
          </Link>
        }
      />

      {!data.found ? (
        <EmptyState
          title={`${yearMonthLabel(yearMonth)}に車番 ${vehicleNo} のデータはありません`}
          description="対象月を変えるか、月次データを取り込んでください。"
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="rounded-xl border border-line bg-white p-4">
              <p className="text-xs text-ink-muted">売上</p>
              <p className="num mt-1 text-xl font-bold text-ink">{yen(current?.sales)}</p>
            </div>
            <div className="rounded-xl border border-line bg-white p-4">
              <p className="text-xs text-ink-muted">経費計</p>
              <p className="num mt-1 text-xl font-bold text-ink">{yen(current?.expense)}</p>
            </div>
            <div className="rounded-xl border border-line bg-white p-4">
              <p className="text-xs text-ink-muted">損益</p>
              <p
                className={`num mt-1 text-xl font-bold ${(current?.profit ?? 0) < 0 ? "text-danger" : "text-accent"}`}
              >
                {yen(current?.profit)}
              </p>
            </div>
            <div className="rounded-xl border border-line bg-white p-4">
              <p className="text-xs text-ink-muted">実力損益</p>
              <p
                className={`num mt-1 text-xl font-bold ${(data.normalizedProfit ?? 0) < 0 ? "text-danger" : "text-ink"}`}
              >
                {yen(data.normalizedProfit)}
              </p>
              <p className="mt-1 text-[11px] text-ink-muted">
                修理費を12ヶ月平均({yen(data.avgRepair)}円)に均した値
              </p>
            </div>
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <section className="rounded-xl border border-line bg-white p-5">
              <h2 className="text-sm font-bold text-ink">経費の内訳({yearMonthLabel(yearMonth)})</h2>
              <div className="mt-3">
                {data.costBreakdown.map((c) => (
                  <BarRow
                    key={c.key}
                    label={c.label}
                    value={c.value}
                    max={expenseMax}
                    display={`${yen(c.value)}円`}
                    tone="quiet"
                  />
                ))}
              </div>
            </section>

            <section className="rounded-xl border border-line bg-white p-5">
              <h2 className="text-sm font-bold text-ink">損益の12ヶ月推移</h2>
              <p className="mt-1 text-xs text-ink-muted">
                棒の長さは各月の損益の絶対値(最大月を100%とした比較)。
              </p>
              <div className="mt-3">
                {data.history.map((h) => (
                  <BarRow
                    key={h.yearMonth}
                    label={h.label}
                    value={h.profit}
                    max={profitMax}
                    display={h.isMissing ? "未取込" : `${yen(h.profit)}円`}
                    tone={h.profit < 0 ? "danger" : "brand"}
                  />
                ))}
              </div>
            </section>
          </div>

          <section className="mt-5 overflow-x-auto rounded-xl border border-line bg-white">
            <table className="w-full min-w-max border-collapse text-xs">
              <thead>
                <tr className="border-b border-line bg-subtle text-ink-muted">
                  <th className="px-3 py-2 text-left font-medium">月</th>
                  <th className="px-3 py-2 text-right font-medium">売上(円)</th>
                  <th className="px-3 py-2 text-right font-medium">経費計(円)</th>
                  <th className="px-3 py-2 text-right font-medium">損益(円)</th>
                  <th className="px-3 py-2 text-right font-medium">走行(km)</th>
                  <th className="px-3 py-2 text-right font-medium">修理費(円)</th>
                  <th className="px-3 py-2 text-right font-medium">km単価</th>
                </tr>
              </thead>
              <tbody>
                {data.history.map((h) => (
                  <tr
                    key={h.yearMonth}
                    className={`border-b border-line last:border-b-0 ${h.yearMonth === yearMonth ? "bg-brand-soft/50" : ""}`}
                  >
                    <td className="px-3 py-2 font-medium">
                      {h.label}
                      {h.isMissing && <span className="ml-1 text-[11px] text-ink-muted">未取込</span>}
                    </td>
                    <td className="num px-3 py-2 text-right">{h.isMissing ? "—" : yen(h.sales)}</td>
                    <td className="num px-3 py-2 text-right">{h.isMissing ? "—" : yen(h.expense)}</td>
                    <td
                      className={`num px-3 py-2 text-right font-bold ${h.profit < 0 ? "text-danger" : "text-ink"}`}
                    >
                      {h.isMissing ? "—" : yen(h.profit)}
                    </td>
                    <td className="num px-3 py-2 text-right">{h.isMissing ? "—" : num(h.km, 1)}</td>
                    <td className="num px-3 py-2 text-right">{h.isMissing ? "—" : yen(h.repair)}</td>
                    <td className="num px-3 py-2 text-right">{kmPriceLabel(h.kmPrice)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </>
  );
}
