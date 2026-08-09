import Link from "next/link";
import { formatVehicleNoLabel } from "../../../../src/domain/rules/towedVehicle";
import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../../src/infrastructure/auth/accessControl";
import { AccessDenied } from "../../../_components/AccessDenied";
import { createDb } from "../../../../src/infrastructure/db/client";
import { D1VehiclePlRepository } from "../../../../src/infrastructure/db/D1VehiclePlRepository";
import { D1DeficitFactorAnalysisRepository } from "../../../../src/infrastructure/db/D1DeficitFactorAnalysisRepository";
import type { DeficitFactorCategory } from "../../../../src/domain/repositories/DeficitFactorAnalysisRepository";
import { GetVehicleHistoryUseCase } from "../../../../src/usecase/steps/getVehicleHistory";
import { resolveWorkingYearMonth } from "../../../_lib/workingYearMonth";
import { kmPriceLabel, num, yen, yearMonthLabel } from "../../../_lib/format";
import { ScreenHeader } from "../../../_components/ScreenHeader";
import { EmptyState } from "../../../_components/EmptyState";
import { BarRow } from "../../../_components/BarRow";
import { D1VehiclePlOverrideRepository } from "../../../../src/infrastructure/db/D1VehiclePlOverrideRepository";
import type { OverridableField } from "../../../../src/domain/rules/vehiclePlOverride";
import { VehiclePlOverrideEditor } from "./VehiclePlOverrideEditor";

/** COST_BREAKDOWN_FIELDS(getVehicleHistory.ts)と対応する日本語ラベル + 売上分 */
const FACTOR_CATEGORY_LABELS: Record<DeficitFactorCategory, string> = {
  sales: "売上",
  tollNet: "運行費",
  fuelTotal: "燃料費",
  repairTotal: "修繕費",
  laborTotal: "人件費",
  insTotal: "保険料",
  taxTotal: "賦課税",
  transportTotal: "運送費",
  adminTotal: "一般管理費",
};

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
  // 権限が無い人を黙ってホームへ戻すと、押した本人にはリンクが壊れたようにしか見えない。
  if (!checkAccess(session, "view")) {
    return <AccessDenied screenName="車両1台の明細" permission="view" />;
  }

  const { vehicleNo: rawVehicleNo } = await params;
  const vehicleNo = decodeURIComponent(rawVehicleNo);
  const { ym } = await searchParams;

  const { env } = await getCloudflareContext({ async: true });
  const db = createDb(env.DB);
  // 対象月の既定は他画面と同じ「まだ締めていない、取込のある最も新しい月」に揃える。
  // 月次収支表から車番を押して開いた先だけ当月だと、同じ車の別の月を見ることになる。
  const yearMonth = ym || (await resolveWorkingYearMonth(db));
  const data = await new GetVehicleHistoryUseCase(new D1VehiclePlRepository(db)).execute(
    vehicleNo,
    yearMonth,
  );

  const current = data.current;
  const expenseMax = Math.max(...data.costBreakdown.map((c) => c.value), 1);
  const profitMax = Math.max(...data.history.map((h) => Math.abs(h.profit)), 1);
  const isDeficit = (current?.profit ?? 0) < 0;
  const analysis = isDeficit
    ? await new D1DeficitFactorAnalysisRepository(db).findOne(vehicleNo, yearMonth)
    : null;

  // 上書きは「収支表から外す」を含むため、行が消えている月でも読む
  // (読まないと、外した車両を元に戻す手段が画面から無くなる)。
  const overrides = await new D1VehiclePlOverrideRepository(db).findByYearMonth(yearMonth);
  const savedOverride = overrides.find((o) => o.vehicleNo === vehicleNo) ?? null;
  const canEdit = checkAccess(session, "input");

  // トレーラを吸収した行は、この画面の数字がトラクタ単独のものではなくなる。
  // 何が足されているのか分からないまま見せると、車両マスタの登録内容を疑えなくなる。
  const towedVehicleNos = current?.towedVehicleNos ?? [];
  const vehicleNoLabel = formatVehicleNoLabel(vehicleNo, towedVehicleNos);

  // driverCount は収支表の列に無い(賞与の計算にだけ使う)ため、ここでは出せない。
  const currentValues: Partial<Record<OverridableField, number | null>> = {
    trips: current?.trips ?? null,
    slips: current?.slips ?? null,
    hours: current?.hours ?? null,
    km: current?.km ?? null,
    fare: current?.fare ?? null,
    fee: current?.fee ?? null,
    salary: current?.salary ?? null,
    welfare: current?.welfare ?? null,
    driverCount: null,
    bonusMonthly: current?.bonus ?? null,
  };

  return (
    <>
      <ScreenHeader
        screen="/vehicle"
        title={`車番 ${vehicleNoLabel}`}
        lead={
          current
            ? `${current.type} / ${current.depot} / 運転者 ${current.driver ?? "—"} — ${yearMonthLabel(yearMonth)}${
                towedVehicleNos.length > 0
                  ? ` / トレーラ ${towedVehicleNos.join("・")} を合算しています`
                  : ""
              }`
            : `${yearMonthLabel(yearMonth)}のデータ`
        }
        action={
          <Link
            href={`/grid?ym=${yearMonth}`}
            className="btn btn-quiet pressable inline-block"
          >
            月次収支表へ戻る
          </Link>
        }
      />

      {!data.found ? (
        <EmptyState
          title={`${yearMonthLabel(yearMonth)}に車番 ${vehicleNo} のデータはありません`}
          description={
            savedOverride?.excluded
              ? "この車両は今月の収支表から外す設定になっています。下の欄で取り消せます。"
              : "対象月を変えるか、月次データを取り込んでください。"
          }
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

          {isDeficit && (
            <section className="mt-5 rounded-xl border border-line bg-white p-5">
              <h2 className="text-sm font-bold text-ink">AI要因分析({yearMonthLabel(yearMonth)})</h2>
              {analysis ? (
                <>
                  <p className="mt-2 text-sm text-ink">{analysis.summary}</p>
                  <ul className="mt-3 space-y-2">
                    {analysis.factors.map((f, i) => (
                      <li
                        key={`${f.category}-${i}`}
                        className="rounded-md border border-line bg-subtle px-3 py-2 text-xs leading-relaxed"
                      >
                        <span className="font-semibold text-ink">
                          {FACTOR_CATEGORY_LABELS[f.category] ?? f.category}が
                          {f.direction === "high" ? "高い" : "低い"}
                        </span>
                        <span className="num ml-2 text-ink-muted">目安 {yen(f.amountYen)}円</span>
                        <p className="mt-1 text-ink-muted">{f.explanation}</p>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3 text-[11px] text-ink-muted">
                    {new Date(analysis.updatedAt).toLocaleString("ja-JP")} 時点のAI分析結果(
                    {analysis.model})
                  </p>
                </>
              ) : (
                <p className="mt-2 text-xs text-ink-muted">
                  この月・車両はまだAI分析されていません。
                  <Link href={`/deficit?ym=${yearMonth}`} className="ml-1 text-brand-deep hover:underline">
                    赤字の理由(3分類)画面
                  </Link>
                  の「AI分析する」ボタンから実行できます。
                </p>
              )}
            </section>
          )}

          <section className="mt-5 overflow-x-auto rounded-xl border border-line bg-white">
            <table className="data-table w-full min-w-max border-collapse text-xs">
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

      {canEdit ? (
        <VehiclePlOverrideEditor
          yearMonth={yearMonth}
          vehicleNo={vehicleNo}
          currentValues={currentValues}
          saved={
            savedOverride
              ? {
                  excluded: savedOverride.excluded,
                  values: savedOverride.values,
                  reason: savedOverride.reason,
                  updatedAt: savedOverride.updatedAt.toISOString(),
                  updatedByName: savedOverride.updatedByName,
                }
              : null
          }
        />
      ) : null}
    </>
  );
}
