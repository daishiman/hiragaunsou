import Link from "next/link";
import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../src/infrastructure/auth/accessControl";
import { createDb } from "../../../src/infrastructure/db/client";
import { D1VehiclePlRepository } from "../../../src/infrastructure/db/D1VehiclePlRepository";
import { D1RateMasterRepository } from "../../../src/infrastructure/db/D1MasterRepository";
import {
  GetDeficitAnalysisUseCase,
  type DeficitGroupResult,
  type DeficitVehicle,
} from "../../../src/usecase/steps/getDeficitAnalysis";
import { currentYearMonth, selectableYearMonths } from "../../_lib/yearMonth";
import { kmPriceLabel, man, num, yen, yearMonthLabel } from "../../_lib/format";
import { YearMonthSelect } from "../../_components/YearMonthSelect";
import { PageHead } from "../../_components/PageHead";
import { EmptyState } from "../../_components/EmptyState";

/** 各分類で最初から見せる件数。残りは折りたたみ(段階的開示)。 */
const TOP_N = 5;

function extraValue(group: DeficitGroupResult, v: DeficitVehicle): string {
  if (group.category === "repair") return `${yen(v.repair)}円`;
  if (group.category === "price") return kmPriceLabel(v.kmPrice);
  return `${yen(v.fixed)}円`;
}

function VehicleRows({
  group,
  vehicles,
  yearMonth,
}: {
  group: DeficitGroupResult;
  vehicles: DeficitVehicle[];
  yearMonth: string;
}) {
  return (
    <>
      {vehicles.map((v) => (
        <tr key={v.vehicleNo} className="border-b border-line last:border-b-0 hover:bg-subtle">
          <td className="px-3 py-2">
            <Link
              href={`/vehicle/${encodeURIComponent(v.vehicleNo)}?ym=${yearMonth}`}
              className="num font-semibold text-brand-deep hover:underline"
            >
              {v.vehicleNo}
            </Link>
          </td>
          <td className="whitespace-nowrap px-3 py-2 text-ink-muted">{v.type}</td>
          <td className="whitespace-nowrap px-3 py-2 text-ink-muted">{v.depot}</td>
          <td className="whitespace-nowrap px-3 py-2 text-ink-muted">{v.driver ?? "—"}</td>
          <td className="num px-3 py-2 text-right">{yen(v.sales)}</td>
          <td className="num px-3 py-2 text-right font-bold text-danger">{yen(v.profit)}</td>
          <td className="num px-3 py-2 text-right">{extraValue(group, v)}</td>
        </tr>
      ))}
    </>
  );
}

function GroupTable({
  group,
  vehicles,
  yearMonth,
}: {
  group: DeficitGroupResult;
  vehicles: DeficitVehicle[];
  yearMonth: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-max border-collapse text-xs">
        <thead>
          <tr className="border-b border-line bg-subtle text-ink-muted">
            <th className="px-3 py-2 text-left font-medium">車番</th>
            <th className="px-3 py-2 text-left font-medium">車種</th>
            <th className="px-3 py-2 text-left font-medium">所属</th>
            <th className="px-3 py-2 text-left font-medium">運転者</th>
            <th className="px-3 py-2 text-right font-medium">売上(円)</th>
            <th className="px-3 py-2 text-right font-medium">損益(円)</th>
            <th className="px-3 py-2 text-right font-medium">{group.extraColumnLabel}</th>
          </tr>
        </thead>
        <tbody>
          <VehicleRows group={group} vehicles={vehicles} yearMonth={yearMonth} />
        </tbody>
      </table>
    </div>
  );
}

/**
 * S9 赤字の理由(3分類) (モック view-deficit.js に対応)。
 * 「赤字が何台」で止めず、突発修繕型 / 単価・効率型 / 遊休・低稼働型 に分けて打ち手に繋げる。
 */
export default async function DeficitPage({
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
  const useCase = new GetDeficitAnalysisUseCase(
    new D1VehiclePlRepository(db),
    new D1RateMasterRepository(db),
  );
  const data = await useCase.execute(yearMonth);

  return (
    <>
      <PageHead
        kind="analysis"
        title="赤字の理由(3分類)"
        lead={`赤字 ${data.deficitCount}台を原因の違いで3つに分けています`}
        action={
          <YearMonthSelect basePath="/deficit" value={yearMonth} options={selectableYearMonths(13)} />
        }
      />

      {data.isEmpty ? (
        <EmptyState
          title={`${yearMonthLabel(yearMonth)}のデータはまだありません`}
          description="月次データを取り込むと、赤字車両の分類が表示されます。"
        />
      ) : data.deficitCount === 0 ? (
        <div className="rounded-xl border border-line bg-white px-6 py-12 text-center">
          <p className="text-sm font-semibold text-ink">赤字の車両はありません</p>
          <p className="mt-1 text-sm text-ink-muted">
            {yearMonthLabel(yearMonth)}は全車両が黒字です。
          </p>
        </div>
      ) : (
        <>
          <div className="rounded-xl border border-line bg-white p-4">
            <p className="text-xs text-ink-muted">赤字による損失合計</p>
            <p className="num mt-1 text-3xl font-bold text-danger">{man(data.lossTotal)}</p>
            <p className="mt-1 text-[11px] text-ink-muted">
              判定閾値: 売上 {num(data.thresholds.idleSales)}円未満=遊休・低稼働型 / 修理費{" "}
              {num(data.thresholds.repairSpike)}円以上=突発修繕型 / 損益分岐{" "}
              {num(data.thresholds.breakEvenKmPrice)}円/km
            </p>
          </div>

          <div className="mt-5 space-y-5">
            {data.groups.map((group) => {
              const top = group.vehicles.slice(0, TOP_N);
              const rest = group.vehicles.slice(TOP_N);
              return (
                <section key={group.category} className="rounded-xl border border-line bg-white">
                  <div className="border-b border-line p-5">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h2 className="text-sm font-bold text-ink">
                        {group.title}
                        <span className="num ml-2 text-ink-muted">{group.vehicles.length}台</span>
                      </h2>
                      <p className="num text-sm font-bold text-danger">
                        {yen(group.lossTotal)}円
                      </p>
                    </div>
                    <p className="mt-1.5 text-xs text-ink-muted">{group.description}</p>
                    <p className="mt-2 rounded-md border border-caution-border bg-caution-soft px-3 py-2 text-xs leading-relaxed text-ink">
                      打ち手: {group.action}
                    </p>
                  </div>

                  {group.vehicles.length === 0 ? (
                    <p className="px-5 py-6 text-xs text-ink-muted">この分類に該当する車両はありません。</p>
                  ) : (
                    <>
                      <GroupTable group={group} vehicles={top} yearMonth={yearMonth} />
                      {rest.length > 0 && (
                        <details className="border-t border-line">
                          <summary className="cursor-pointer px-5 py-3 text-xs font-semibold text-brand-deep">
                            残り{rest.length}台を表示
                          </summary>
                          <GroupTable group={group} vehicles={rest} yearMonth={yearMonth} />
                        </details>
                      )}
                    </>
                  )}
                </section>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
