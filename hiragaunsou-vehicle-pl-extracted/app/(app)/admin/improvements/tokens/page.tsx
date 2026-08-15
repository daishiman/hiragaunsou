import Link from "next/link";
import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../../../src/infrastructure/auth/accessControl";
import { createDb } from "../../../../../src/infrastructure/db/client";
import { D1InstructionTokenRepository } from "../../../../../src/infrastructure/db/D1InstructionTokenRepository";
import { AccessDenied } from "../../../../_components/AccessDenied";
import { PageHead } from "../../../../_components/PageHead";
import { dateTimeLabel } from "../../../../_lib/format";
import { InstructionTokenTable, type TokenRow } from "./InstructionTokenTable";

/**
 * /admin/improvements/tokens: Claude Code に渡した鍵の一覧 (システム管理者専用)。
 *
 * この画面ですること: 「いま、どの鍵が生きているか」を見て、要らない鍵を止める。
 * 鍵は放っておいても期限で死ぬが、渡した相手が変わったときや、貼り先を間違えたときは
 * 期限を待たずに止められないと困る。
 *
 * 鍵の平文はここには出ない (保存しているのは指紋だけ)。出せる作りにすると、
 * この画面を開ける人ではなく DB を読める人が鍵を手にできることになる。
 */
export default async function InstructionTokensPage() {
  const session = await getServerSession();
  if (!session) redirect("/sign-in");
  if (!checkAccess(session, "manage_improvements")) {
    return <AccessDenied screenName="Claude Code に渡した鍵" permission="manage_improvements" />;
  }

  const { env } = await getCloudflareContext({ async: true });
  const list = await new D1InstructionTokenRepository(createDb(env.DB)).list();
  const now = new Date().getTime();

  const rows: TokenRow[] = list.map((t) => ({
    id: t.id,
    name: t.name,
    scopeLabel: t.scopeIds.length === 0 ? "発行済みのすべて" : `${t.scopeIds.length}件`,
    createdLabel: `${t.createdByName}・${dateTimeLabel(t.createdAt.getTime())}`,
    expiresLabel: dateTimeLabel(t.expiresAt.getTime()),
    usageLabel:
      t.lastUsedAt === null
        ? "まだ使われていません"
        : `${t.useCount}回・最後は ${dateTimeLabel(t.lastUsedAt.getTime())}`,
    // 生きているかどうかは、失効と期限の両方で決める。片方だけを見ると
    // 「失効していないから使える」と読めてしまう鍵が一覧に並ぶ。
    state:
      t.revokedAt !== null ? "revoked" : t.expiresAt.getTime() <= now ? "expired" : "active",
    stateNote:
      t.revokedAt !== null
        ? `失効済み${t.revokedReason ? `（${t.revokedReason}）` : ""}`
        : t.expiresAt.getTime() <= now
          ? "期限切れ"
          : "使えます",
  }));

  const active = rows.filter((r) => r.state === "active").length;

  return (
    <div>
      <PageHead kind="tool" title="Claude Code に渡した鍵" />

      <div className="mt-1">
        <Link href="/admin/improvements" className="text-xs text-brand-deep underline">
          ← 改善要望の一覧へ戻る
        </Link>
      </div>

      <p className="mt-3 text-sm text-ink-muted">
        改善要望を Claude Code に渡すと、その件だけを読める鍵が1つできます。
        いま使える鍵は{active}件です。渡す相手が変わったときや、貼り先を間違えたときは
        期限を待たずにここで止めてください。止めた鍵では、その瞬間から1件も読めなくなります。
      </p>

      {rows.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-line bg-white px-6 py-12 text-center">
          <p className="text-sm font-semibold text-ink">まだ鍵はありません。</p>
          <p className="mt-1 text-sm text-ink-muted">
            改善要望の一覧で「選んだものを Claude Code に渡す」を押すと、ここに並びます。
          </p>
        </div>
      ) : (
        <InstructionTokenTable rows={rows} />
      )}
    </div>
  );
}
