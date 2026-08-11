import Link from "next/link";
import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../src/infrastructure/auth/accessControl";
import { AccessDenied } from "../../_components/AccessDenied";
import { createDb } from "../../../src/infrastructure/db/client";
import { D1UsageLogRepository } from "../../../src/infrastructure/db/D1UsageLogRepository";
import { summarizeUsage, DEFAULT_USAGE_PRICING, type UsagePricing } from "../../../src/usecase/steps/summarizeUsage";
import type { UsageLogRecord } from "../../../src/domain/repositories/UsageLogRepository";
import { ScreenHeader } from "../../_components/ScreenHeader";
import { AlertPanel } from "../../_components/AlertPanel";
import { SectionHeading } from "../../_components/SectionHeading";
import { StatTile } from "../../_components/StatTile";
import { DefinitionList, type DefinitionItem } from "../../_components/DefinitionList";
import { DataTable, type DataTableColumn } from "../../_components/DataTable";
import { Prose } from "../../_components/Card";
import { usageKindLabel } from "../../_lib/kindLabels";
import { num, yen } from "../../_lib/format";

function readPricing(env: { ANTHROPIC_PRICE_IN_USD_PER_M?: string; ANTHROPIC_PRICE_OUT_USD_PER_M?: string; USD_JPY_RATE?: string }): UsagePricing {
  const inPrice = Number(env.ANTHROPIC_PRICE_IN_USD_PER_M);
  const outPrice = Number(env.ANTHROPIC_PRICE_OUT_USD_PER_M);
  const jpy = Number(env.USD_JPY_RATE);
  return {
    inputUsdPerMillion: Number.isFinite(inPrice) && inPrice > 0 ? inPrice : DEFAULT_USAGE_PRICING.inputUsdPerMillion,
    outputUsdPerMillion: Number.isFinite(outPrice) && outPrice > 0 ? outPrice : DEFAULT_USAGE_PRICING.outputUsdPerMillion,
    usdJpyRate: Number.isFinite(jpy) && jpy > 0 ? jpy : DEFAULT_USAGE_PRICING.usdJpyRate,
  };
}

/** 最近のログの列。数値列は右揃え、単位は見出しに出す（セルには入れない）。 */
const RECENT_COLUMNS: readonly DataTableColumn<UsageLogRecord>[] = [
  {
    key: "createdAt",
    header: "日時",
    cell: (log) => new Date(log.createdAt).toLocaleString("ja-JP"),
    cellClassName: "whitespace-nowrap",
  },
  {
    key: "kind",
    header: "種別",
    // 内部キー（deficit_factor_analysis 等）は画面に出さず kindLabels.ts で訳す（T7 §1-3）。
    cell: (log) => usageKindLabel(log.kind),
  },
  {
    key: "model",
    header: "モデル",
    // モデル名は製品名なので英語のまま。狭い画面では落としてよい。
    priority: "low",
    cell: (log) => log.model,
  },
  { key: "inputTokens", header: "入力", unit: "token", align: "right", cell: (log) => num(log.inputTokens) },
  { key: "outputTokens", header: "出力", unit: "token", align: "right", cell: (log) => num(log.outputTokens) },
];

/** /usage 利用状況ページ。usageLogを集計し、今月の概算費用・利用者別内訳・最近のログを表示する。 */
export default async function UsagePage() {
  const session = await getServerSession();
  if (!session) redirect("/sign-in");
  // 権限が無い人を黙ってホームへ戻すと、押した本人にはリンクが壊れたようにしか見えない。
  if (!checkAccess(session, "view")) {
    return <AccessDenied screenName="利用状況" permission="view" />;
  }

  const { env } = await getCloudflareContext({ async: true });
  const db = createDb(env.DB);
  const repo = new D1UsageLogRepository(db);

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).getTime();
  const logs = await repo.findSince(monthStart);
  const pricing = readPricing(env);
  const summary = summarizeUsage(logs, pricing);

  // APIキー・モデル設定は/ai-settings画面の責務(1画面1責務)。ここでは
  // manage_api_keys権限を持つ人にだけ、設定画面への案内リンクを出す(UIそのものは移設しない)。
  const canManageApiKeys = checkAccess(session, "manage_api_keys");

  /*
    T7 §4-1 の質問への答え。
      利用者別内訳 — 1件（1名）を読んで「誰がどれだけ使ったか」を確かめる。列をまたいで
        見比べる場面ではないので表にせず定義リスト（項目名と値の組）にする。
        以前は <dt>/<dd> を <dl> の外に書いていて、読み上げに組だと伝わっていなかった。
      最近のログ — 日時・種別・token数を行同士で見比べる。ここは表（DataTable）。
  */
  const byUserItems: readonly DefinitionItem[] = summary.byUser.map((u) => ({
    term: u.recordedBy ?? "（不明）",
    value: <span className="num">¥{yen(u.costJpy)}</span>,
    note: `呼び出し ${num(u.callCount)}件`,
  }));

  return (
    <div>
      <ScreenHeader screen="/usage" />

      <AlertPanel tone="caution" title="表示している金額は概算です">
        金額はトークン数から計算した概算で、請求の正はAnthropicのコンソールです。
        いま費用を集計している対象はAnthropic（Claude）経由の呼び出しだけで、
        ほかのプロバイダは未対応のため集計されません。
      </AlertPanel>

      <div className="mt-6">
        <StatTile
          label="今月の概算費用（Anthropic／Claudeのみ集計）"
          value={`¥${yen(summary.totalCostJpy)}`}
          hero
          sub={`＄${summary.totalCostUsd.toFixed(2)} ／ 呼び出し ${num(summary.callCount)}件`}
        />
      </div>

      <SectionHeading note="今月ぶんを、使った人ごとにまとめています。">利用者別内訳</SectionHeading>
      <div className="card mt-3 p-5">
        {byUserItems.length === 0 ? (
          <Prose>
            今月はまだAIを1度も呼び出していないため、内訳がありません。
            赤字の要因分析を実行すると、ここに利用者ごとの費用が出ます。{" "}
            <Link href="/deficit" className="font-semibold text-brand-deep hover:underline">
              赤字分析へ進む →
            </Link>
          </Prose>
        ) : (
          <DefinitionList items={byUserItems} />
        )}
      </div>

      <SectionHeading note="新しい順に最大20件を出しています。">最近のログ</SectionHeading>
      <div className="card mt-3 p-5">
        <DataTable
          caption="今月のAI呼び出しログ（新しい順・最大20件）"
          columns={RECENT_COLUMNS}
          rows={summary.recent}
          rowKey={(log) => log.id}
          maxHeight="24rem"
          empty={
            <Prose>
              今月はまだAIを1度も呼び出していないため、ログがありません。
              赤字の要因分析を実行すると、ここに1件ずつ記録されます。{" "}
              <Link href="/deficit" className="font-semibold text-brand-deep hover:underline">
                赤字分析へ進む →
              </Link>
            </Prose>
          }
        />
      </div>

      {canManageApiKeys ? (
        <>
          <SectionHeading>APIキー・モデルの設定</SectionHeading>
          <div className="card mt-3 p-5">
            <Prose>
              AIプロバイダのAPIキー登録・モデル選択は「AI設定」で行います。
              この画面は利用実績を読むことに専念しています。
            </Prose>
            <Link href="/ai-settings" className="btn btn-secondary btn-sm pressable mt-3 inline-block">
              AI設定ページを開く
            </Link>
          </div>
        </>
      ) : null}
    </div>
  );
}
