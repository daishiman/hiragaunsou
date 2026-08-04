import Link from "next/link";
import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../src/infrastructure/auth/accessControl";
import { createDb } from "../../../src/infrastructure/db/client";
import { D1VehiclePlRepository } from "../../../src/infrastructure/db/D1VehiclePlRepository";
import { D1RateMasterRepository } from "../../../src/infrastructure/db/D1MasterRepository";
import { GetDashboardUseCase } from "../../../src/usecase/steps/getDashboard";
import { currentYearMonth, selectableYearMonths } from "../../_lib/yearMonth";
import { kmPriceLabel, man, num, pct, yen, yearMonthLabel } from "../../_lib/format";
import { YearMonthSelect } from "../../_components/YearMonthSelect";
import { PageHead } from "../../_components/PageHead";
import { EmptyState } from "../../_components/EmptyState";
import { BarRow } from "../../_components/BarRow";

/**
 * S7 経営ダッシュボード (モック view-dashboard.js に対応)。
 * KPI 4枚 →「利益の構造」→「km単価の分布」の順で、全社の損益がどこから来ているかを1画面で示す。
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ ym?: string }>;
}) {
  const session = await getServerSession();
  if (!session) redirect("/sign-in");
  if (!checkAccess(session, "view")) redirect("/");

  const { ym } = await searchParams;
  const yearMonth = ym || currentYearMonth();

  const { env } = await getCloudflareContext({ async: true });
  const db = createDb(env.DB);
  const useCase = new GetDashboardUseCase(
    new D1VehiclePlRepository(db),
    new D1RateMasterRepository(db),
  );
  const data = await useCase.execute(yearMonth);
  const t = data.totals;

  // 「利益の構造」の棒は3本とも同じ基準(最大の絶対値)で描く。基準が違う棒を並べない。
  const structureMax = Math.max(Math.abs(t.profitPos), Math.abs(t.profitNeg), Math.abs(t.profit), 1);
  const bucketMax = Math.max(...data.kmPriceBuckets.map((b) => b.count), 1);

  return (
    <>
      <PageHead
        kind="analysis"
        title="経営ダッシュボード"
        lead={`${yearMonthLabel(yearMonth)}の全社損益と、その損益がどの車両から出ているかを見ます。`}
        action={
          <YearMonthSelect basePath="/dashboard" value={yearMonth} options={selectableYearMonths(13)} />
        }
      />

      {data.isEmpty ? (
        <EmptyState
          title={`${yearMonthLabel(yearMonth)}のデータはまだありません`}
          description="月次データを取り込むと、ここに全社の損益が表示されます。"
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="rounded-xl border border-line bg-white p-4">
              <p className="text-xs text-ink-muted">売上</p>
              <p className="num mt-1 text-2xl font-bold text-ink">{man(t.sales)}</p>
              <p className="mt-1 text-[11px] text-ink-muted">{yen(t.sales)}円</p>
            </div>
            <div className="rounded-xl border border-line bg-white p-4">
              <p className="text-xs text-ink-muted">全社損益</p>
              <p
                className={`num mt-1 text-2xl font-bold ${t.profit < 0 ? "text-danger" : "text-accent"}`}
              >
                {man(t.profit)}
              </p>
              <p className="mt-1 text-[11px] text-ink-muted">利益率 {pct(data.margin)}</p>
            </div>
            <div className="rounded-xl border border-line bg-white p-4">
              <p className="text-xs text-ink-muted">赤字車両</p>
              <p className="num mt-1 text-2xl font-bold text-ink">
                {num(t.deficitCars)}
                <span className="ml-1 text-sm font-normal text-ink-muted">/ {num(t.cars)}台</span>
              </p>
              <Link href={`/deficit?ym=${yearMonth}`} className="mt-1 inline-block text-[11px] font-semibold text-brand-deep hover:underline">
                赤字の理由を見る →
              </Link>
            </div>
            <div className="rounded-xl border border-line bg-white p-4">
              <p className="text-xs text-ink-muted">1kmあたり原価 / 売上</p>
              <p className="num mt-1 text-2xl font-bold text-ink">
                {kmPriceLabel(data.costPerKm)}
                <span className="ml-1 text-sm font-normal text-ink-muted">
                  / {kmPriceLabel(data.salesPerKm)}
                </span>
              </p>
              <p className="mt-1 text-[11px] text-ink-muted">
                損益分岐の目安 {num(data.thresholds.breakEvenKmPrice)}円/km
              </p>
            </div>
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <section className="rounded-xl border border-line bg-white p-5">
              <h2 className="text-sm font-bold text-ink">利益の構造</h2>
              <p className="mt-1 text-xs text-ink-muted">
                黒字車が稼いだ利益を、赤字車の損失がどれだけ食っているか。
              </p>
              <div className="mt-3">
                <BarRow
                  label="黒字車の利益合計"
                  value={t.profitPos}
                  max={structureMax}
                  display={`${yen(t.profitPos)}円`}
                />
                <BarRow
                  label="赤字車の損失合計"
                  value={t.profitNeg}
                  max={structureMax}
                  display={`${yen(t.profitNeg)}円`}
                  tone="danger"
                />
                <BarRow
                  label="全社損益"
                  value={t.profit}
                  max={structureMax}
                  display={`${yen(t.profit)}円`}
                  tone={t.profit < 0 ? "danger" : "brand"}
                />
              </div>
            </section>

            <section className="rounded-xl border border-line bg-white p-5">
              <h2 className="text-sm font-bold text-ink">km単価の分布(稼働車)</h2>
              <p className="mt-1 text-xs text-ink-muted">
                横棒の長さは台数。{num(data.thresholds.breakEvenKmPrice)}円/km
                を下回る帯が赤字の主戦場です。
              </p>
              <div className="mt-3">
                {data.kmPriceBuckets.map((b) => (
                  <BarRow
                    key={b.label}
                    label={b.label}
                    value={b.count}
                    max={bucketMax}
                    display={`${num(b.count)}台`}
                    tone={b.belowBreakEven ? "danger" : "brand"}
                    sub={b.deficit > 0 ? `うち赤字 ${num(b.deficit)}台` : undefined}
                  />
                ))}
              </div>
            </section>
          </div>

          <section className="mt-5 rounded-xl border border-line bg-white p-5">
            <h2 className="text-sm font-bold text-ink">経費の内訳(全社)</h2>
            <div className="mt-3 grid gap-x-6 sm:grid-cols-2">
              {(
                [
                  ["運行費", t.tollNet],
                  ["燃料費", t.fuelTotal],
                  ["修繕費", t.repairTotal],
                  ["人件費", t.laborTotal],
                  ["保険料", t.insTotal],
                  ["賦課税", t.taxTotal],
                  ["運送費", t.transportTotal],
                  ["一般管理費", t.adminTotal],
                ] as const
              ).map(([label, value]) => (
                <BarRow
                  key={label}
                  label={label}
                  value={value}
                  max={Math.max(t.expense, 1)}
                  display={`${yen(value)}円`}
                  tone="quiet"
                />
              ))}
            </div>
            <p className="mt-3 border-t border-line pt-3 text-xs text-ink-muted">
              経費計 <span className="num font-bold text-ink">{yen(t.expense)}</span> 円 / 走行{" "}
              <span className="num font-bold text-ink">{num(t.km, 1)}</span> km
            </p>
          </section>
        </>
      )}
    </>
  );
}
