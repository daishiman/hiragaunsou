import Link from "next/link";
import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../src/infrastructure/auth/accessControl";
import { AccessDenied } from "../../_components/AccessDenied";
import { createDb } from "../../../src/infrastructure/db/client";
import { D1VehiclePlRepository } from "../../../src/infrastructure/db/D1VehiclePlRepository";
import { D1RateMasterRepository } from "../../../src/infrastructure/db/D1MasterRepository";
import { D1DeficitFactorAnalysisRepository } from "../../../src/infrastructure/db/D1DeficitFactorAnalysisRepository";
import type { DeficitFactorAnalysisRecord } from "../../../src/domain/repositories/DeficitFactorAnalysisRepository";
import {
  GetDeficitAnalysisUseCase,
  type DeficitGroupResult,
  type DeficitVehicle,
} from "../../../src/usecase/steps/getDeficitAnalysis";
import { selectableYearMonths } from "../../_lib/yearMonth";
import { resolveWorkingYearMonth } from "../../_lib/workingYearMonth";
import { man, num, yen, yearMonthLabel } from "../../_lib/format";
import { factorCategoryLabel } from "../../_lib/factorLabels";
import { YearMonthSelect } from "../../_components/YearMonthSelect";
import { ScreenHeader } from "../../_components/ScreenHeader";
import { EmptyState } from "../../_components/EmptyState";
import { StatTile } from "../../_components/StatTile";
import { StickyFilterBar } from "../../_components/StickyFilterBar";
import { AlertPanel } from "../../_components/AlertPanel";
import { Badge } from "../../_components/Badge";
import { DataTable, type DataTableColumn } from "../../_components/DataTable";
import { DeficitAnalysisButton } from "./DeficitAnalysisButton";

/** 各分類で最初から見せる件数。残りは折りたたみ(段階的開示)。 */
const TOP_N = 5;

/**
 * 分類ごとの追加列の見出しと単位。
 *
 * ユースケース側の extraColumnLabel は単位込みの1文字列 (「修理費(実費)」「km単価」) で、
 * 単位を列見出しに出しセルに入れない作法 (T7 §4-4) と、用語統一 (km単価 → 1kmあたり売上) に
 * 合わない。ユースケースの文字列はテストで固定されているため、画面側で言い換える。
 */
const EXTRA_COLUMN: Record<DeficitGroupResult["category"], { header: string; unit: string }> = {
  repair: { header: "修理費（実費）", unit: "円" },
  price: { header: "1kmあたり売上", unit: "円" },
  idle: { header: "固定費の流出", unit: "円" },
};

/** 追加列の値。単位は列見出しが持つので、ここでは付けない */
function extraValue(group: DeficitGroupResult, v: DeficitVehicle): string {
  if (group.category === "repair") return yen(v.repair);
  if (group.category === "price") return num(v.kmPrice, 1);
  return yen(v.fixed);
}

/**
 * AIが出した赤字の要因。
 * 分類は内部で sales / fuelTotal のような英語のキーで持っているので、
 * 画面に出すときは必ず factorLabels.ts で日本語に訳す (T7 §1-3)。
 */
function AnalysisBadge({ record }: { record: DeficitFactorAnalysisRecord | undefined }) {
  if (!record) {
    return <span className="text-ink-muted">未分析</span>;
  }
  const top = record.factors[0];
  return (
    <Badge tone="brand" className="max-w-[16rem] truncate">
      {top
        ? `${factorCategoryLabel(top.category)}が${top.direction === "high" ? "高い" : "低い"}`
        : record.summary}
    </Badge>
  );
}

/**
 * 分類ごとの車両一覧。
 *
 * 器の判定 (T7 §4-1): この画面でやりたいのは「車両を損失の大きい順に見比べること」なので表のまま。
 * 20行を超えうるので maxHeight を渡し、列見出しを固定する。
 */
function GroupTable({
  group,
  vehicles,
  yearMonth,
  analysisByVehicle,
}: {
  group: DeficitGroupResult;
  vehicles: DeficitVehicle[];
  yearMonth: string;
  analysisByVehicle: Record<string, DeficitFactorAnalysisRecord>;
}) {
  const extra = EXTRA_COLUMN[group.category];
  const columns: readonly DataTableColumn<DeficitVehicle>[] = [
    {
      key: "vehicleNo",
      header: "車番",
      cell: (v) => (
        <Link
          href={`/vehicle/${encodeURIComponent(v.vehicleNo)}?ym=${yearMonth}`}
          className="num font-semibold text-brand-deep hover:underline"
        >
          {v.vehicleNo}
        </Link>
      ),
    },
    {
      key: "type",
      header: "車種",
      priority: "low",
      cellClassName: "whitespace-nowrap text-ink-muted",
      cell: (v) => v.type,
    },
    {
      key: "depot",
      header: "所属",
      priority: "low",
      cellClassName: "whitespace-nowrap text-ink-muted",
      cell: (v) => v.depot,
    },
    {
      key: "driver",
      header: "運転者",
      priority: "low",
      cellClassName: "whitespace-nowrap text-ink-muted",
      cell: (v) => v.driver ?? "—",
    },
    { key: "sales", header: "売上", unit: "円", align: "right", cell: (v) => yen(v.sales) },
    {
      key: "profit",
      header: "損益",
      unit: "円",
      align: "right",
      cell: (v) => <span className="font-bold text-danger">{yen(v.profit)}</span>,
    },
    {
      key: "extra",
      header: extra?.header ?? group.extraColumnLabel,
      unit: extra?.unit,
      align: "right",
      cell: (v) => extraValue(group, v),
    },
    {
      key: "analysis",
      header: "AI要因分析",
      cell: (v) => <AnalysisBadge record={analysisByVehicle[v.vehicleNo]} />,
    },
  ];

  return (
    <DataTable
      caption={`${group.title}の車両一覧`}
      columns={columns}
      rows={vehicles}
      rowKey={(v) => v.vehicleNo}
      maxHeight="30rem"
      rowClassName={() => "hover:bg-subtle"}
      empty={
        <p className="px-5 py-6 text-xs text-ink-muted">この分類に該当する車両はありません。</p>
      }
    />
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
  // 権限が無い人を黙ってホームへ戻すと、押した本人にはリンクが壊れたようにしか見えない。
  if (!checkAccess(session, "view")) {
    return <AccessDenied screenName="赤字の理由" permission="view" />;
  }

  const { ym } = await searchParams;

  const { env } = await getCloudflareContext({ async: true });
  const db = createDb(env.DB);

  /*
    対象月の既定は「まだ締めていない、取込のある最も新しい月」に揃える(app/_lib/workingYearMonth.ts)。
    以前は画面ごとに当月・前月とバラバラで、取込画面で5月分を取り込んでから移ると
    別の月の空っぽの画面が出て「取り込んだのに反映されていない」ように見えていた。
  */
  const yearMonth = ym || (await resolveWorkingYearMonth(db));
  const useCase = new GetDeficitAnalysisUseCase(
    new D1VehiclePlRepository(db),
    new D1RateMasterRepository(db),
  );
  const data = await useCase.execute(yearMonth);

  const canAnalyze = checkAccess(session, "report_settings");
  const analysisResults = await new D1DeficitFactorAnalysisRepository(db).findByYearMonth(yearMonth);
  const analysisByVehicle = Object.fromEntries(analysisResults.map((r) => [r.vehicleNo, r]));

  return (
    <>
      <ScreenHeader
        screen="/deficit"
        lead={`赤字 ${data.deficitCount}台を、原因の違いで3つに分けています。`}
      />

      {/*
        対象年月と赤字の台数は、下に並ぶどの数字にも掛かる前提なので帯に貼る (T7 §2-3)。
        工程タブの無い画面なので below は既定の "header"。
      */}
      <StickyFilterBar
        summary={
          <>
            赤字 <span className="num">{data.deficitCount}</span>台
          </>
        }
      >
        <YearMonthSelect basePath="/deficit" value={yearMonth} options={selectableYearMonths(13)} />
        {canAnalyze && data.deficitCount > 0 && <DeficitAnalysisButton yearMonth={yearMonth} />}
      </StickyFilterBar>

      {data.isEmpty ? (
        <EmptyState
          title={`${yearMonthLabel(yearMonth)}のデータはまだありません`}
          description="月次データを取り込むと、赤字車両の分類が表示されます。"
        />
      ) : data.deficitCount === 0 ? (
        /* 0件でも「なぜ空か」と「次にどこを見るか」を必ず出す (T7 §4-4) */
        <EmptyState
          title="赤字の車両はありません"
          description={`${yearMonthLabel(yearMonth)}は全車両が黒字なので、分類する車両がありません。1台ごとの数字は月次収支表で確認できます。`}
          actionHref="/grid"
        />
      ) : (
        <>
          {/* 結論の数字は1つ。器は要約カードに揃える (T7 §4-1) */}
          <StatTile
            label="赤字による損失合計"
            value={man(data.lossTotal)}
            negative
            sub={`判定閾値: 売上 ${num(data.thresholds.idleSales)}円未満=遊休・低稼働型 / 修理費 ${num(
              data.thresholds.repairSpike,
            )}円以上=突発修繕型 / 損益分岐 ${num(data.thresholds.breakEvenKmPrice)}円/km`}
          />

          <div className="mt-5 space-y-5">
            {data.groups.map((group) => {
              const top = group.vehicles.slice(0, TOP_N);
              const rest = group.vehicles.slice(TOP_N);
              return (
                <section key={group.category} className="card">
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
                    <div className="mt-2">
                      <AlertPanel tone="caution" title="打ち手">
                        {group.action}
                      </AlertPanel>
                    </div>
                  </div>

                  {group.vehicles.length === 0 ? (
                    <p className="px-5 py-6 text-xs text-ink-muted">
                      この分類に該当する車両はありません。ほかの2分類か、月次収支表で1台ずつ確認してください。
                    </p>
                  ) : (
                    <>
                      <GroupTable
                        group={group}
                        vehicles={top}
                        yearMonth={yearMonth}
                        analysisByVehicle={analysisByVehicle}
                      />
                      {rest.length > 0 && (
                        <details className="border-t border-line">
                          <summary className="cursor-pointer px-5 py-3 text-xs font-semibold text-brand-deep">
                            残り{rest.length}台を見る
                          </summary>
                          <GroupTable
                            group={group}
                            vehicles={rest}
                            yearMonth={yearMonth}
                            analysisByVehicle={analysisByVehicle}
                          />
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
