import Link from "next/link";
import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../../src/infrastructure/auth/accessControl";
import { AccessDenied } from "../../../_components/AccessDenied";
import { createDb } from "../../../../src/infrastructure/db/client";
import { D1VehiclePlRepository } from "../../../../src/infrastructure/db/D1VehiclePlRepository";
import { D1ReviewFlagRepository } from "../../../../src/infrastructure/db/D1ReviewFlagRepository";
import { D1ImportBatchRepository } from "../../../../src/infrastructure/db/D1ImportBatchRepository";
import { D1VehiclePlOverrideRepository } from "../../../../src/infrastructure/db/D1VehiclePlOverrideRepository";
import { D1PlIssueAckRepository } from "../../../../src/infrastructure/db/D1PlIssueAckRepository";
import { GetMonthlyGridUseCase } from "../../../../src/usecase/steps/getMonthlyGrid";
import { GetExcelReconciliationUseCase } from "../../../../src/usecase/steps/getExcelReconciliation";
import { ConfirmMonthlyPlUseCase } from "../../../../src/usecase/steps/confirmMonthlyPl";
import {
  buildReviewReport,
  type ReviewReportJudgement,
} from "../../../../src/usecase/steps/getReviewReport";
import { OVERRIDABLE_FIELD_META } from "../../../../src/domain/rules/vehiclePlOverride";
import { resolveWorkingYearMonth } from "../../../_lib/workingYearMonth";
import { num, yearMonthLabel } from "../../../_lib/format";
import { FIELD_LABELS } from "../../../_lib/fieldLabels";
import { severityLabel } from "../../../_lib/severity";
import { DataTable, type DataTableColumn } from "../../../_components/DataTable";
import { StatTile } from "../../../_components/StatTile";
import { PrintActions } from "./PrintActions";

/**
 * 収支表の確認結果を1枚にまとめた記録 (印刷・共有用)。
 *
 * 確認画面は「いま何を判断するか」の画面なので、終わった後の記録は残らない。
 * 月次の締めでは「何を直して、何をこのままでよいと決めたか」を上長・経理に渡す必要があるため、
 * 判断の結果だけを時系列でも表でもなく「種類ごと」に並べた紙をここで作る。
 *
 * ■ 表か、カードか (T7 §4-1 の質問への回答)
 * ここで人がやりたいのは「何台ぶん・何件ぶんの判断があったかを行をまたいで見比べ、
 * 紙に残すこと」なので表にする。ただし紙で読むため高さの上限 (maxHeight) は付けない。
 * 上限を付けると印刷時に見えている分しか出ず、記録として欠ける。
 * 先頭の5つの数字は「見比べる」ではなく「1つの数字を読む」ものなので StatTile を使う。
 *
 * この画面だけ ScreenHeader を使わないのは意図的 (design-system §11-2 の例外)。
 * 印刷レイアウトなので、画面の役割ノートや業務フローの帯は紙に不要。
 */

function fieldLabel(field: string): string {
  return (FIELD_LABELS as Record<string, string>)[field] ?? field;
}

function stamp(ms: number | null): string {
  if (ms === null) return "—";
  return new Date(ms).toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * 判断の一覧。紙で読むので、色ではなく文字で種類が分かるようにする。
 * 種類の日本語は app/_lib/severity.ts の1か所だけで決める (T7 §1-3)。
 */
function JudgementTable({
  items,
  showJudge,
  caption,
  empty,
}: {
  items: ReviewReportJudgement[];
  showJudge: boolean;
  caption: string;
  empty: React.ReactNode;
}) {
  const columns: DataTableColumn<ReviewReportJudgement>[] = [
    {
      key: "vehicle",
      header: "車番",
      cell: (item) => <span className="num">{item.vehicleNoLabel}</span>,
    },
    { key: "field", header: "項目", cell: (item) => fieldLabel(item.field) },
    { key: "severity", header: "種類", cell: (item) => severityLabel(item.severity) },
    {
      key: "title",
      header: "内容",
      cellClassName: "wrap",
      cell: (item) => (
        <>
          {item.title}
          {item.note && <span className="block text-ink-muted">メモ: {item.note}</span>}
        </>
      ),
    },
  ];
  if (showJudge) {
    columns.push(
      { key: "judgedBy", header: "判定した人", cell: (item) => item.judgedByName ?? "—" },
      {
        key: "judgedAt",
        header: "判定した日時",
        cell: (item) => <span className="num">{stamp(item.judgedAt)}</span>,
      },
    );
  }

  return (
    <DataTable
      columns={columns}
      rows={items}
      rowKey={(item) => `${item.vehicleNo}::${item.field}::${item.code}`}
      caption={caption}
      empty={empty}
    />
  );
}

function Section({
  title,
  lead,
  children,
}: {
  title: string;
  lead: string;
  children: React.ReactNode;
}) {
  return (
    <section className="print-block mb-6 rounded-lg border border-line bg-white px-4 py-4">
      <h2 className="text-sm font-bold text-ink">{title}</h2>
      <p className="mt-0.5 mb-3 text-xs text-ink-muted">{lead}</p>
      {children}
    </section>
  );
}

export default async function ReviewReportPage({
  searchParams,
}: {
  searchParams: Promise<{ ym?: string }>;
}) {
  const session = await getServerSession();
  if (!session) redirect("/sign-in");
  // 権限が無い人を黙ってホームへ戻すと、押した本人にはリンクが壊れたようにしか見えない。
  if (!checkAccess(session, "view")) {
    return <AccessDenied screenName="月次収支表の印刷" permission="view" />;
  }

  const { ym } = await searchParams;

  const { env } = await getCloudflareContext({ async: true });
  const db = createDb(env.DB);
  // 対象月の既定は他画面と同じ「まだ締めていない、取込のある最も新しい月」に揃える。
  // 印刷だけ当月を見ていると、画面では出ている表が印刷では白紙になる。
  const yearMonth = ym || (await resolveWorkingYearMonth(db));
  const plRepo = new D1VehiclePlRepository(db);
  const flagRepo = new D1ReviewFlagRepository(db);
  const [confirmation, reconciliation] = await Promise.all([
    new ConfirmMonthlyPlUseCase(plRepo, flagRepo).status(yearMonth),
    new GetExcelReconciliationUseCase(plRepo, new D1ImportBatchRepository(db)).execute(yearMonth),
  ]);
  const grid = await new GetMonthlyGridUseCase(
    plRepo,
    flagRepo,
    new D1VehiclePlOverrideRepository(db),
    new D1PlIssueAckRepository(db),
  ).execute(yearMonth, reconciliation);

  const report = buildReviewReport(grid, {
    generatedByName: session.name,
    isConfirmed: confirmation.isConfirmed,
  });

  return (
    // 幅は app/_lib/screens.ts の /grid/report (width: narrow) が決める。ここでは指定しない。
    <div>
      <div className="mb-4 flex flex-wrap items-start gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-ink">
            {yearMonthLabel(yearMonth)} 収支表 確認の記録
          </h1>
          <p className="mt-0.5 text-xs text-ink-muted">
            {report.isConfirmed ? "この月は確定済みです。" : "この月はまだ確定していません。"}
            {stamp(report.generatedAt)} 時点 / 出力者: {report.generatedByName}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Link
            href={`/grid?ym=${encodeURIComponent(yearMonth)}`}
            className="btn btn-quiet pressable no-print"
          >
            収支表に戻る
          </Link>
          <PrintActions />
        </div>
      </div>

      <div className="print-block mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          { label: "対象車両", value: report.summary.vehicles, unit: "台" },
          { label: "指摘なし", value: report.summary.cleanVehicles, unit: "台" },
          { label: "数字を直した", value: report.summary.fixedVehicles, unit: "台" },
          { label: "このままでよいと判定", value: report.summary.ok, unit: "件" },
          {
            label: "未確認・あとで見る",
            value: report.summary.open + report.summary.postponed,
            unit: "件",
          },
        ].map((tile) => (
          <StatTile key={tile.label} label={tile.label} value={num(tile.value)} unit={tile.unit} />
        ))}
      </div>

      <Section
        title={`直した数字（${report.fixes.length}台）`}
        lead="人が値を書き換えた車両です。直した理由もそのまま残しています。"
      >
        <DataTable
          columns={[
            {
              key: "vehicle",
              header: "車番",
              cell: (fix) => <span className="num">{fix.vehicleNoLabel}</span>,
            },
            {
              key: "content",
              header: "直した内容",
              cellClassName: "wrap",
              cell: (fix) => (
                <>
                  {fix.excluded && <span className="block">この月の収支表から外す</span>}
                  {fix.entries.map((entry) => (
                    <span key={entry.field} className="block">
                      {OVERRIDABLE_FIELD_META[entry.field].label}: {num(entry.value)}
                      {OVERRIDABLE_FIELD_META[entry.field].unit}
                    </span>
                  ))}
                  {fix.pending && (
                    <span className="block text-ink-muted">
                      ※この直しはまだ収支表を作り直していません
                    </span>
                  )}
                </>
              ),
            },
            { key: "reason", header: "理由", cellClassName: "wrap", cell: (fix) => fix.reason || "—" },
            { key: "by", header: "直した人", cell: (fix) => fix.updatedByName ?? "—" },
            {
              key: "at",
              header: "日時",
              cell: (fix) => <span className="num">{stamp(fix.updatedAt)}</span>,
            },
          ]}
          rows={report.fixes}
          rowKey={(fix) => fix.vehicleNo}
          caption={`${yearMonthLabel(yearMonth)} に人が値を直した車両の一覧`}
          empty={
            <p className="text-xs text-ink-muted">
              この月は数字を直した車両はありません。直す必要が出たら「収支表のチェック」で直してください。
            </p>
          }
        />
      </Section>

      <Section
        title={`このままでよいと判定した指摘（${report.okItems.length}件）`}
        lead="見たうえで直さないと決めたものです。誰がいつ決めたかを残しています。"
      >
        <JudgementTable
          items={report.okItems}
          showJudge
          caption="このままでよいと判定した指摘の一覧"
          empty={
            <p className="text-xs text-ink-muted">
              まだ1件も判定していません。「収支表のチェック」で1件ずつ見て判定してください。
            </p>
          }
        />
      </Section>

      <Section
        title={`「あとで見る」のまま残っている指摘（${report.postponedItems.length}件）`}
        lead="判定をあとで見ることにしたものです。確定する前にここが0件になっているか確認してください。"
      >
        <JudgementTable
          items={report.postponedItems}
          showJudge
          caption="「あとで見る」のまま残っている指摘の一覧"
          empty={
            <p className="text-xs text-ink-muted">
              「あとで見る」にした指摘はありません。この月の保留はもう残っていません。
            </p>
          }
        />
      </Section>

      <Section
        title={`まだ確認していない指摘（${report.openItems.length}件）`}
        lead="誰もまだ見ていないものです。0件になっていれば、この月の確認は一通り終わっています。"
      >
        <JudgementTable
          items={report.openItems}
          showJudge={false}
          caption="まだ確認していない指摘の一覧"
          empty={
            <p className="text-xs text-ink-muted">
              未確認の指摘はありません。この月の確認は一通り終わっています。
            </p>
          }
        />
      </Section>
    </div>
  );
}
