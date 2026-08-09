import Link from "next/link";
import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../src/infrastructure/auth/accessControl";
import { AccessDenied } from "../../_components/AccessDenied";
import { createDb } from "../../../src/infrastructure/db/client";
import { D1UsageLogRepository } from "../../../src/infrastructure/db/D1UsageLogRepository";
import { summarizeUsage, DEFAULT_USAGE_PRICING, type UsagePricing } from "../../../src/usecase/steps/summarizeUsage";
import { ScreenHeader } from "../../_components/ScreenHeader";

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

  return (
    <div className="max-w-3xl">
      <ScreenHeader screen="/usage" />

      <div className="rounded-md border border-caution-border bg-caution-soft px-4 py-3 text-xs leading-relaxed">
        表示金額はトークン数からの概算です。請求の正はAnthropicのコンソールを確認してください。現在、費用集計の対象はAnthropic(Claude)経由の呼び出しのみです(他プロバイダは未対応のため集計されません)。
      </div>

      <section className="mt-6 rounded-xl border border-line bg-white p-5 text-center">
        <p className="text-xs text-ink-muted">今月の概算費用(Anthropic/Claudeのみ集計)</p>
        <p className="num mt-1 text-4xl font-bold text-accent">
          ¥{Math.round(summary.totalCostJpy).toLocaleString("ja-JP")}
        </p>
        <p className="num mt-1 text-xs text-ink-muted">
          (${summary.totalCostUsd.toFixed(2)} / 呼び出し {summary.callCount}件)
        </p>
      </section>

      <section className="mt-6 rounded-xl border border-line bg-white p-5">
        <h2 className="mb-3 text-sm font-bold text-ink">利用者別内訳</h2>
        {summary.byUser.length === 0 ? (
          <p className="text-sm text-ink-muted">今月の利用実績はまだありません。</p>
        ) : (
          <div className="flex flex-col">
            {summary.byUser.map((u) => (
              <div
                key={u.recordedBy ?? "unknown"}
                className="grid grid-cols-[1fr_auto] items-baseline gap-2 border-b border-line py-2 text-sm last:border-b-0"
              >
                <dt className="text-ink">{u.recordedBy ?? "(不明)"}</dt>
                <dd className="num text-ink">
                  ¥{Math.round(u.costJpy).toLocaleString("ja-JP")}({u.callCount}件)
                </dd>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="mt-6 rounded-xl border border-line bg-white p-5">
        <h2 className="mb-3 text-sm font-bold text-ink">最近のログ</h2>
        {summary.recent.length === 0 ? (
          <p className="text-sm text-ink-muted">ログはまだありません。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table min-w-full text-xs">
              <thead>
                <tr className="border-b border-line text-left text-ink-muted">
                  <th className="py-2 pr-3">日時</th>
                  <th className="py-2 pr-3">種別</th>
                  <th className="py-2 pr-3">モデル</th>
                  <th className="py-2 pr-3 text-right">入力token</th>
                  <th className="py-2 text-right">出力token</th>
                </tr>
              </thead>
              <tbody>
                {summary.recent.map((log) => (
                  <tr key={log.id} className="border-b border-line last:border-b-0">
                    <td className="whitespace-nowrap py-2 pr-3">
                      {new Date(log.createdAt).toLocaleString("ja-JP")}
                    </td>
                    <td className="py-2 pr-3">{log.kind}</td>
                    <td className="py-2 pr-3">{log.model}</td>
                    <td className="num py-2 pr-3 text-right">{log.inputTokens.toLocaleString("ja-JP")}</td>
                    <td className="num py-2 text-right">{log.outputTokens.toLocaleString("ja-JP")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {canManageApiKeys ? (
        <section className="mt-6 rounded-xl border border-line bg-white p-5">
          <h2 className="text-sm font-bold text-ink">APIキー・モデルの設定</h2>
          <p className="mt-1 text-xs text-ink-muted">
            AIプロバイダのAPIキー登録・モデル選択は「AI設定」ページで行えます(この画面は利用実績の閲覧に専念しています)。
          </p>
          <Link
            href="/ai-settings"
            className="btn btn-secondary btn-sm pressable mt-3 inline-block"
          >
            AI設定ページを開く
          </Link>
        </section>
      ) : null}
    </div>
  );
}
