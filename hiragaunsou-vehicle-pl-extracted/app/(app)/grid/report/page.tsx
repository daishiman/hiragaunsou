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
import { PrintActions } from "./PrintActions";

/**
 * 収支表の確認結果を1枚にまとめた記録 (印刷・共有用)。
 *
 * 確認画面は「いま何を判断するか」の画面なので、終わった後の記録は残らない。
 * 月次の締めでは「何を直して、何をこのままでよいと決めたか」を上長・経理に渡す必要があるため、
 * 判断の結果だけを時系列でも表でもなく「種類ごと」に並べた紙をここで作る。
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

const SEVERITY_LABEL = { blocking: "要修正", warning: "要確認", info: "参考" } as const;

/** 判断の一覧。紙で読むので、色ではなく文字で種類が分かるようにする。 */
function JudgementTable({
  items,
  showJudge,
}: {
  items: ReviewReportJudgement[];
  showJudge: boolean;
}) {
  return (
    <table className="w-full border-collapse text-xs">
      <thead>
        <tr className="border-b border-line text-left text-ink-muted">
          <th className="py-1.5 pr-3 font-medium">車番</th>
          <th className="py-1.5 pr-3 font-medium">項目</th>
          <th className="py-1.5 pr-3 font-medium">種類</th>
          <th className="py-1.5 pr-3 font-medium">内容</th>
          {showJudge && <th className="py-1.5 pr-3 font-medium">判断した人</th>}
          {showJudge && <th className="py-1.5 font-medium">判断した日時</th>}
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={`${item.vehicleNo}::${item.field}::${item.code}`} className="border-b border-line align-top">
            <td className="num py-1.5 pr-3">{item.vehicleNoLabel}</td>
            <td className="py-1.5 pr-3">{fieldLabel(item.field)}</td>
            <td className="py-1.5 pr-3">{SEVERITY_LABEL[item.severity]}</td>
            <td className="py-1.5 pr-3">
              {item.title}
              {item.note && <span className="block text-ink-muted">メモ: {item.note}</span>}
            </td>
            {showJudge && <td className="py-1.5 pr-3">{item.judgedByName ?? "—"}</td>}
            {showJudge && <td className="num py-1.5">{stamp(item.judgedAt)}</td>}
          </tr>
        ))}
      </tbody>
    </table>
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

      <div className="print-block mb-6 grid grid-cols-2 gap-3 rounded-lg border border-line bg-white px-4 py-4 sm:grid-cols-5">
        {[
          { label: "対象車両", value: report.summary.vehicles, unit: "台" },
          { label: "指摘なし", value: report.summary.cleanVehicles, unit: "台" },
          { label: "数字を直した", value: report.summary.fixedVehicles, unit: "台" },
          { label: "問題なしと判断", value: report.summary.ok, unit: "件" },
          { label: "未確認・後回し", value: report.summary.open + report.summary.postponed, unit: "件" },
        ].map((tile) => (
          <div key={tile.label}>
            <p className="text-xs text-ink-muted">{tile.label}</p>
            <p className="num-display text-2xl text-ink">
              {num(tile.value)}
              <span className="ml-0.5 text-xs font-normal text-ink-muted">{tile.unit}</span>
            </p>
          </div>
        ))}
      </div>

      <Section
        title={`直した数字 (${report.fixes.length}台)`}
        lead="人が値を書き換えた車両です。直した理由もそのまま残しています。"
      >
        {report.fixes.length === 0 ? (
          <p className="text-xs text-ink-muted">この月は数字を直した車両はありません。</p>
        ) : (
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-line text-left text-ink-muted">
                <th className="py-1.5 pr-3 font-medium">車番</th>
                <th className="py-1.5 pr-3 font-medium">直した内容</th>
                <th className="py-1.5 pr-3 font-medium">理由</th>
                <th className="py-1.5 pr-3 font-medium">直した人</th>
                <th className="py-1.5 font-medium">日時</th>
              </tr>
            </thead>
            <tbody>
              {report.fixes.map((fix) => (
                <tr key={fix.vehicleNo} className="border-b border-line align-top">
                  <td className="num py-1.5 pr-3">{fix.vehicleNoLabel}</td>
                  <td className="py-1.5 pr-3">
                    {fix.excluded && <span className="block">この月の収支表から外す</span>}
                    {fix.entries.map((entry) => (
                      <span key={entry.field} className="block">
                        {OVERRIDABLE_FIELD_META[entry.field].label}: {num(entry.value)}
                        {OVERRIDABLE_FIELD_META[entry.field].unit}
                      </span>
                    ))}
                    {fix.pending && (
                      <span className="block text-ink-muted">
                        ※まだ収支表に反映していません
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 pr-3">{fix.reason || "—"}</td>
                  <td className="py-1.5 pr-3">{fix.updatedByName ?? "—"}</td>
                  <td className="num py-1.5">{stamp(fix.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section
        title={`このままでよいと判断した指摘 (${report.okItems.length}件)`}
        lead="見たうえで直さないと決めたものです。誰がいつ決めたかを残しています。"
      >
        {report.okItems.length === 0 ? (
          <p className="text-xs text-ink-muted">まだ1件も判断していません。</p>
        ) : (
          <JudgementTable items={report.okItems} showJudge />
        )}
      </Section>

      <Section
        title={`あとで見る (後回し) のまま残っている指摘 (${report.postponedItems.length}件)`}
        lead="判断を保留しているものです。締める前にここが0件になっているか確認してください。"
      >
        {report.postponedItems.length === 0 ? (
          <p className="text-xs text-ink-muted">後回しにしている指摘はありません。</p>
        ) : (
          <JudgementTable items={report.postponedItems} showJudge />
        )}
      </Section>

      <Section
        title={`まだ確認していない指摘 (${report.openItems.length}件)`}
        lead="誰もまだ見ていないものです。0件になっていれば、この月の確認は一通り終わっています。"
      >
        {report.openItems.length === 0 ? (
          <p className="text-xs text-ink-muted">未確認の指摘はありません。</p>
        ) : (
          <JudgementTable items={report.openItems} showJudge={false} />
        )}
      </Section>
    </div>
  );
}
