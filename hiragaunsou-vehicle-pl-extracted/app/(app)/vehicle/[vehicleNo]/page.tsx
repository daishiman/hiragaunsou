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
import {
  GetVehicleHistoryUseCase,
  type VehicleHistoryMonth,
} from "../../../../src/usecase/steps/getVehicleHistory";
import { resolveWorkingYearMonth } from "../../../_lib/workingYearMonth";
import { dateTimeLabel, kmPriceLabel, num, yen, yearMonthLabel } from "../../../_lib/format";
import { findScreen } from "../../../_lib/screens";
import { factorCategoryLabel } from "../../../_lib/factorLabels";
import { ScreenHeader } from "../../../_components/ScreenHeader";
import { EmptyState } from "../../../_components/EmptyState";
import { BarRow } from "../../../_components/BarRow";
import { StatTile } from "../../../_components/StatTile";
import { DefinitionList } from "../../../_components/DefinitionList";
import { DataTable, type DataTableColumn } from "../../../_components/DataTable";
import { Disclosure } from "../../../_components/Disclosure";
import { SectionHeading } from "../../../_components/SectionHeading";
import { StickyFilterBar } from "../../../_components/StickyFilterBar";
import { D1VehiclePlOverrideRepository } from "../../../../src/infrastructure/db/D1VehiclePlOverrideRepository";
import type { OverridableField } from "../../../../src/domain/rules/vehiclePlOverride";
import { VehiclePlOverrideEditor } from "./VehiclePlOverrideEditor";

/**
 * 車両1台の明細。
 *
 * ■ 表かカードかの判定 (docs/product/T7-ui-conventions.md §4-1)
 * この画面で人がやりたいのは「1台を読んで、この車をどうするか判断すること」であって、
 * 何台かを列で見比べることではない。対象は最初から1台に決まっている。
 * よって車両そのものの情報は定義リスト、当月の結果は要約カードで出す。
 *
 * 12ヶ月の推移だけは「月をまたいで見比べる」ので表が要るが、同じ数字を
 * 棒グラフでも出しているため、表は折りたたみの中に入れる (T7 §4-2:
 * 同じデータをグラフと表で二度並べない。比較は棒、正確な値は表)。
 * かつてはこの2つが上下に並んでいて、同じ12行が二度出ていた。
 */

/**
 * 12ヶ月の推移表の列。
 * 単位はすべて列見出しに出し、セルには入れない (T7 §4-4)。
 * 狭い画面では、赤字かどうかの判断に直接は要らない列 (走行距離・修理費・1kmあたり売上) を落とす。
 */
const historyColumns: readonly DataTableColumn<VehicleHistoryMonth>[] = [
  {
    key: "month",
    header: "月",
    cell: (h) => (
      <span className="font-medium">
        {h.label}
        {h.isMissing ? <span className="ml-1 text-[11px] text-ink-muted">未取込</span> : null}
      </span>
    ),
  },
  { key: "sales", header: "売上", unit: "円", align: "right", cell: (h) => (h.isMissing ? "—" : yen(h.sales)) },
  { key: "expense", header: "経費計", unit: "円", align: "right", cell: (h) => (h.isMissing ? "—" : yen(h.expense)) },
  {
    key: "profit",
    header: "損益",
    unit: "円",
    align: "right",
    cell: (h) =>
      h.isMissing ? "—" : <span className={h.profit < 0 ? "font-bold text-danger" : "font-bold"}>{yen(h.profit)}</span>,
  },
  {
    key: "km",
    header: "走行距離",
    unit: "km",
    align: "right",
    priority: "low",
    cell: (h) => (h.isMissing ? "—" : num(h.km, 1)),
  },
  {
    key: "repair",
    header: "修理費",
    unit: "円",
    align: "right",
    priority: "low",
    cell: (h) => (h.isMissing ? "—" : yen(h.repair)),
  },
  {
    key: "kmPrice",
    header: "1kmあたり売上",
    align: "right",
    priority: "low",
    cell: (h) => kmPriceLabel(h.kmPrice),
  },
];
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
        lead={`${yearMonthLabel(yearMonth)}のこの1台について、いくら稼いでいくら掛かったかを見て、直すかどうかを決めます。`}
        action={
          <Link
            href={`/grid?ym=${yearMonth}`}
            className="btn btn-quiet pressable inline-block"
          >
            月次収支表へ戻る
          </Link>
        }
      />

      {/*
        下へスクロールすると「どの車の、どの月の数字か」が画面から消えていた。
        数字だけが見えていて前提が見えない状態は読み違いのもとなので、
        車番と対象年月は貼り付けておく (T7 §2-3)。
      */}
      <StickyFilterBar summary={current ? `損益 ${yen(current.profit)}円` : undefined}>
        <span className="text-sm font-bold text-ink">車番 {vehicleNoLabel}</span>
        <span className="text-xs text-ink-muted">{yearMonthLabel(yearMonth)}</span>
      </StickyFilterBar>

      {!data.found ? (
        <EmptyState
          title={`${yearMonthLabel(yearMonth)}に車番 ${vehicleNo} のデータはありません`}
          description={
            savedOverride?.excluded
              ? "この車両は今月の収支表から外す設定になっています。下の欄で取り消せます。"
              : "対象年月を変えるか、月次データを取り込んでください。"
          }
        />
      ) : (
        <>
          {/*
            この車がどんな車で誰が乗っているかは「読む」情報で、見比べる相手がいない。
            以前は見出しの下に「大型 / 本社 / 運転者 ○○ — 2026年8月」と1行に詰めていたが、
            項目名が無いので何と何が並んでいるのかが読み取れなかった (T7 §4-1)。
          */}
          <SectionHeading divider={false} note="この1台の登録内容です。違っていれば車両マスタで直します。">
            この車について
          </SectionHeading>
          <div className="card mt-3 p-5">
            <DefinitionList
              layout="split"
              items={[
                { term: "車種", value: current?.type ?? "—" },
                { term: "所属", value: current?.depot ?? "—" },
                { term: "運転者", value: current?.driver ?? "—" },
                { term: "初年度登録", value: current?.reg ?? "—" },
                ...(towedVehicleNos.length > 0
                  ? [
                      {
                        term: "合算しているトレーラ",
                        value: towedVehicleNos.join("・"),
                        note: "この画面の数字はトラクタ単独ではなく、上のトレーラを足した金額です。",
                      },
                    ]
                  : []),
              ]}
            />
          </div>

          <SectionHeading note={`${yearMonthLabel(yearMonth)}の結果です。`}>今月の損益</SectionHeading>
          <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="売上" value={yen(current?.sales)} unit="円" />
            <StatTile label="経費計" value={yen(current?.expense)} unit="円" />
            <StatTile
              label="損益"
              value={yen(current?.profit)}
              unit="円"
              negative={(current?.profit ?? 0) < 0}
              hero
            />
            <StatTile
              label="実力損益"
              value={yen(data.normalizedProfit)}
              unit="円"
              negative={(data.normalizedProfit ?? 0) < 0}
              sub={`修理費を12ヶ月平均（${yen(data.avgRepair)}円）に均した値`}
            />
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <section className="card p-5">
              <h2 className="text-sm font-bold text-ink">経費の内訳（{yearMonthLabel(yearMonth)}）</h2>
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

            <section className="card p-5">
              <h2 className="text-sm font-bold text-ink">損益の12ヶ月推移</h2>
              <p className="mt-1 text-xs text-ink-muted">
                棒の長さは各月の損益の大きさ（いちばん大きい月を100%とした比べ方）。
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

              {/*
                同じ12ヶ月を棒と表で二度並べない (T7 §4-2)。
                ざっと比べるのは棒で足りるので、正確な数字が要るときだけ開く。
              */}
              <Disclosure summary="月ごとの正確な数字を見る">
                <DataTable
                  caption={`車番 ${vehicleNoLabel} の直近12ヶ月の損益`}
                  columns={historyColumns}
                  rows={data.history}
                  rowKey={(h) => h.yearMonth}
                  rowClassName={(h) => (h.yearMonth === yearMonth ? "bg-brand-soft/50" : undefined)}
                  empty={
                    <p className="text-xs text-ink-muted">
                      過去12ヶ月ぶんの取込がまだありません。月次データ取込から取り込んでください。
                    </p>
                  }
                />
              </Disclosure>
            </section>
          </div>

          {isDeficit && (
            <section className="mt-5 card p-5">
              <h2 className="text-sm font-bold text-ink">AI要因分析（{yearMonthLabel(yearMonth)}）</h2>
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
                          {factorCategoryLabel(f.category)}が
                          {f.direction === "high" ? "高い" : "低い"}
                        </span>
                        <span className="num ml-2 text-ink-muted">目安 {yen(f.amountYen)}円</span>
                        <p className="mt-1 text-ink-muted">{f.explanation}</p>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3 text-[11px] text-ink-muted">
                    {dateTimeLabel(analysis.updatedAt)} 時点のAI分析結果（{analysis.model}）
                  </p>
                </>
              ) : (
                <p className="mt-2 text-xs text-ink-muted">
                  この車のこの月は、まだAI分析をしていません。
                  <Link href={`/deficit?ym=${yearMonth}`} className="ml-1 text-brand-deep hover:underline">
                    {findScreen("/deficit")?.label ?? "赤字の分析"}
                  </Link>
                  の「AI分析する」ボタンから実行できます。
                </p>
              )}
            </section>
          )}

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
