"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertPanel } from "../../../_components/AlertPanel";
import { Badge } from "../../../_components/Badge";
import {
  PUBLISH_BULK_MAX,
  LIFECYCLE_BULK_MAX,
  actionRequiresReason,
  lifecycleActionLabel,
  type LifecycleAction,
} from "../../../../src/domain/rules/improvementLifecycle";
import {
  planSummaryText,
  type InstructionSyncPlan,
} from "../../../../src/domain/rules/improvementInstructionSync";

/**
 * 改善要望の一覧 (表) と、選んだものへの一括操作。
 *
 * 表にしたのは「同じことを何件も続けてやる」画面だから。1件1枚のカードは
 * 読むのには向くが、10件を Claude Code に渡す作業には向かない (実際に使った人から
 * 「1件ずつしか送れないのが使いにくい」と言われた)。
 *
 * どの操作も次の3段で進む。段を飛ばせる作りにしない。
 *   1. 選ぶ  … 何を対象にしたかが常に見えている
 *   2. 下見  … 「新しく発行 N件 / 内容を更新 M件 / 何もしない K件」を先に出す
 *   3. 実行  … 結果は行ごとに出す。失敗した行だけ選び直して再実行できる
 *
 * まとめて成功・まとめて失敗にしない。50件のうち1件が失敗しただけで
 * 49件がやり直しになると、実務では使えない。
 */

export interface BulkRow {
  id: string;
  status: string;
  statusLabel: string;
  statusTone: "danger" | "caution" | "brand" | "neutral";
  screenLabel: string;
  body: string;
  reporterName: string;
  createdAtLabel: string;
  hasShot: boolean;
  archived: boolean;
  /** 未発行 / 発行済み / 更新あり / 取込済み / 対応完了 / 対象外 のどれか。 */
  instructionState: "none" | "published" | "outdated" | "fetched" | "done" | "excluded";
  instructionStateLabel: string;
  instructionNote: string;
}

interface RowResult {
  id: string;
  ok: boolean;
  message: string;
}

interface Draft {
  id: string;
  title: string;
  markdown: string;
}

type Pending =
  | { kind: "publish"; summary: string; details: string[]; drafts: Draft[] }
  | { kind: "lifecycle"; action: LifecycleAction; summary: string; details: string[] }
  | { kind: "purge"; summary: string; details: string[]; count: number };

const LIFECYCLE_CHOICES: LifecycleAction[] = ["drop", "invalid", "duplicate", "archive", "restore"];

export function ImprovementBulkTable({ rows, canPurge }: { rows: BulkRow[]; canPurge: boolean }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [action, setAction] = useState<LifecycleAction>("archive");
  const [reason, setReason] = useState("");
  const [duplicateOfId, setDuplicateOfId] = useState("");
  const [handoff, setHandoff] = useState<{ command: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [results, setResults] = useState<Map<string, RowResult>>(new Map());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const ids = useMemo(() => rows.filter((r) => selected.has(r.id)).map((r) => r.id), [rows, selected]);
  const allShown = rows.length > 0 && rows.every((r) => selected.has(r.id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allShown ? new Set() : new Set(rows.map((r) => r.id)));
  }

  function reset() {
    setPending(null);
    setError(null);
    setDone(null);
  }

  async function post(url: string, payload: unknown) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = (await res.json()) as Record<string, unknown>;
    return { ok: res.ok, json };
  }

  /** 下見。何が起きるかを出すだけで、まだ何も変えない。 */
  async function preview(kind: Pending["kind"]) {
    reset();
    setResults(new Map());
    if (ids.length === 0) {
      setError("先に対象を選んでください。");
      return;
    }
    setBusy(true);
    try {
      if (kind === "publish") {
        const { ok, json } = await post("/api/improvements/instructions", { ids, dryRun: true });
        if (!ok) {
          setError(String(json.message ?? "確認できませんでした。"));
          return;
        }
        const plan = json.plan as InstructionSyncPlan;
        const drafts = (json.drafts ?? []) as Draft[];
        setPending({
          kind: "publish",
          summary: planSummaryText(plan),
          details: plan.items.map((i) => {
            const row = rows.find((r) => r.id === i.id);
            return `${row?.screenLabel ?? i.id}: ${i.reason}`;
          }),
          drafts,
        });
        return;
      }

      const url = kind === "purge" ? "/api/improvements/purge" : "/api/improvements/lifecycle";
      const payload =
        kind === "purge"
          ? { ids, reason, dryRun: true }
          : { action, ids, reason, duplicateOfId: duplicateOfId || null, dryRun: true };
      const { ok, json } = await post(url, payload);
      if (!ok) {
        setError(String(json.message ?? "確認できませんでした。"));
        return;
      }
      const items = (json.items ?? []) as { id: string; kind: string; note: string }[];
      const details = items.map((i) => {
        const row = rows.find((r) => r.id === i.id);
        return `${row?.screenLabel ?? i.id}: ${i.note}`;
      });
      const summary = String(json.summary ?? "");
      setPending(
        kind === "purge"
          ? { kind: "purge", summary, details, count: ids.length }
          : { kind: "lifecycle", action, summary, details },
      );
    } catch {
      setError("通信できませんでした。時間をおいてお試しください。");
    } finally {
      setBusy(false);
    }
  }

  /** 実行。行ごとの結果を残し、成功した分は確定させる。 */
  async function run() {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      const [url, payload] =
        pending.kind === "publish"
          ? (["/api/improvements/instructions", { ids }] as const)
          : pending.kind === "purge"
            ? (["/api/improvements/purge", { ids, reason, confirmCount: pending.count }] as const)
            : ([
                "/api/improvements/lifecycle",
                { action, ids, reason, duplicateOfId: duplicateOfId || null },
              ] as const);
      const { ok, json } = await post(url, payload);
      if (!ok) {
        setError(String(json.message ?? "実行できませんでした。"));
        return;
      }
      const list = (json.results ?? []) as RowResult[];
      const map = new Map<string, RowResult>();
      for (const r of list) map.set(r.id, r);
      setResults(map);
      const failed = list.filter((r) => !r.ok);
      // 成功した行は選択から外す。残るのは「まだ終わっていない行」だけになり、
      // そのまま押し直せば再実行になる。
      setSelected(new Set(failed.map((r) => r.id)));
      setDone(
        failed.length === 0
          ? `${list.length}件を処理しました。`
          : `${list.length - failed.length}件を処理しました。${failed.length}件は失敗したので選んだまま残しています。`,
      );

      // 発行できた件だけを開ける鍵を、その場で作って貼れる形にする。
      // 「発行する」と「渡す」を別の画面に分けると、非エンジニアが渡し方を探すことになる。
      if (pending.kind === "publish") {
        const okIds = list.filter((r) => r.ok).map((r) => r.id);
        await handOff(okIds);
      }

      setPending(null);
      router.refresh();
    } catch {
      setError("通信できませんでした。時間をおいてお試しください。");
    } finally {
      setBusy(false);
    }
  }

  /**
   * 発行できた件を開ける鍵を作り、そのまま貼れる形にして画面へ出す。
   *
   * 鍵は「この回に渡した件だけ」を範囲に持つ。全件を開ける鍵を配ると、
   * 渡し終わったあとも他の要望が読める鍵が手元に残ることになる。
   */
  async function handOff(okIds: string[]) {
    setHandoff(null);
    setCopied(false);
    if (okIds.length === 0) return;
    const { ok, json } = await post("/api/improvements/tokens", {
      ids: okIds,
      name: `${okIds.length}件を渡すための鍵`,
    });
    if (!ok) {
      setError(
        String(json.message ?? "指示文は発行できましたが、渡すための鍵を作れませんでした。"),
      );
      return;
    }
    setHandoff({ command: String(json.command ?? ""), expiresAt: String(json.expiresAt ?? "") });
  }

  async function copyCommand() {
    if (!handoff) return;
    try {
      await navigator.clipboard.writeText(handoff.command);
      setCopied(true);
    } catch {
      setError("コピーできませんでした。下の文字を選んでコピーしてください。");
    }
  }

  const needsReason = actionRequiresReason(action);

  return (
    <div className="mt-5">
      {/* 選んだ数と操作。表の上に置いて、選びながら常に見えるようにする */}
      <div className="sticky top-0 z-10 rounded-t-xl border border-line bg-white px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-ink">
            {ids.length > 0 ? `${ids.length}件を選択中` : "行を選ぶと、まとめて操作できます"}
          </span>
          <button type="button" className="btn pressable" onClick={toggleAll} disabled={rows.length === 0}>
            {allShown ? "選択を解除" : "表示中をすべて選ぶ"}
          </button>

          <span className="ml-auto flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn btn-primary pressable"
              onClick={() => void preview("publish")}
              disabled={busy || ids.length === 0}
            >
              選んだものを Claude Code に渡す
            </button>
          </span>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label className="text-xs text-ink-muted" htmlFor="bulk-action">
            状態を変える
          </label>
          <select
            id="bulk-action"
            className="h-9 rounded-[var(--radius-control)] border border-line px-2 text-sm"
            value={action}
            onChange={(e) => setAction(e.target.value as LifecycleAction)}
          >
            {LIFECYCLE_CHOICES.map((a) => (
              <option key={a} value={a}>
                {lifecycleActionLabel(a)}
              </option>
            ))}
          </select>
          {action === "duplicate" && (
            <select
              className="h-9 max-w-[280px] rounded-[var(--radius-control)] border border-line px-2 text-sm"
              value={duplicateOfId}
              onChange={(e) => setDuplicateOfId(e.target.value)}
              aria-label="まとめ先の要望"
            >
              <option value="">まとめ先を選ぶ</option>
              {rows
                .filter((r) => !selected.has(r.id))
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.screenLabel}: {r.body.slice(0, 24)}
                  </option>
                ))}
            </select>
          )}
          <button
            type="button"
            className="btn pressable"
            onClick={() => void preview("lifecycle")}
            disabled={busy || ids.length === 0}
          >
            実行する内容を確認
          </button>
          {canPurge && (
            <button
              type="button"
              className="btn pressable text-danger"
              onClick={() => void preview("purge")}
              disabled={busy || ids.length === 0}
            >
              完全に削除する（戻せません）
            </button>
          )}
        </div>

        {(needsReason || pending?.kind === "purge") && (
          <div className="mt-2">
            <label className="text-xs text-ink-muted" htmlFor="bulk-reason">
              理由（あとから見た人が経緯をたどれるように書きます）
            </label>
            <input
              id="bulk-reason"
              className="mt-1 w-full rounded-[var(--radius-control)] border border-line px-3 py-2 text-sm"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="例: 既存の帳票で代替できるため"
            />
          </div>
        )}

        <p className="mt-2 text-[11px] text-ink-muted">
          一度に渡せる指示文は{PUBLISH_BULK_MAX}件、状態の変更は{LIFECYCLE_BULK_MAX}件までです。
          超えた分は黙って切り捨てず、選び直しをお願いします。
        </p>
      </div>

      {/* 下見の結果。ここで初めて「何が起きるか」が確定する */}
      {pending && (
        <div className="border-x border-line bg-subtle px-3 py-3">
          <p className="text-sm font-semibold text-ink">
            {pending.kind === "publish"
              ? "この内容で指示文を発行します"
              : pending.kind === "purge"
                ? `${pending.count}件を完全に削除します。元に戻せません。`
                : `${lifecycleActionLabel(pending.action)}前の確認`}
          </p>
          <p className="mt-1 text-xs text-ink">{pending.summary}</p>
          {pending.kind === "purge" && (
            <p className="mt-1 text-xs text-danger">
              本文・画面の写し・診断情報に加えて、発行済みの指示文と、その件を開ける鍵もまとめて消します。
              消した記録 (いつ・誰が) だけは残ります。
            </p>
          )}
          <details className="mt-2">
            <summary className="cursor-pointer text-xs font-semibold text-ink">
              対象を1件ずつ見る（{pending.details.length}件）
            </summary>
            <ul className="mt-1 space-y-0.5 text-[11px] text-ink-muted">
              {pending.details.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          </details>
          {pending.kind === "publish" && pending.drafts.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs font-semibold text-ink">
                Claude Code に渡す文をそのまま読む（{pending.drafts.length}件）
              </summary>
              {/* 押す前に、外へ出る中身をそのまま読めるようにする。
                  要約だけを見せると、載ってはいけないものが載っていても気づけない。 */}
              {pending.drafts.map((d) => (
                <div key={d.id} className="mt-2">
                  <p className="text-[11px] font-semibold text-ink">{d.title}</p>
                  <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded-[var(--radius-control)] border border-line bg-white p-2 text-[11px] text-ink-muted">
                    {d.markdown}
                  </pre>
                </div>
              ))}
            </details>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className={`btn pressable ${pending.kind === "purge" ? "btn-danger" : "btn-primary"}`}
              onClick={() => void run()}
              disabled={busy}
            >
              {busy
                ? "処理中…"
                : pending.kind === "purge"
                  ? `${pending.count}件を完全に削除する`
                  : "この内容で実行する"}
            </button>
            <button type="button" className="btn pressable" onClick={reset} disabled={busy}>
              やめる
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="border-x border-line px-3 py-2">
          <AlertPanel tone="danger" title={error} />
        </div>
      )}
      {done && (
        <div className="border-x border-line px-3 py-2">
          <AlertPanel tone={results.size > 0 && [...results.values()].some((r) => !r.ok) ? "caution" : "success"} title={done} />
        </div>
      )}

      {/* 渡し方。コピー1回・貼り付け1回で終わる形にする。
          鍵の平文はここでしか出ない (保存しているのは指紋だけ)。 */}
      {handoff && (
        <div className="border-x border-line bg-subtle px-3 py-3">
          <p className="text-sm font-semibold text-ink">下の文をコピーして、Claude Code に貼ってください</p>
          <p className="mt-1 text-xs text-ink-muted">
            この文には鍵が入っています。いま渡した件だけが読めます。
            {handoff.expiresAt && `期限は ${new Date(handoff.expiresAt).toLocaleString("ja-JP")} です。`}
            この画面を閉じるともう一度は出せません（そのときは、もう一度渡し直してください）。
          </p>
          <textarea
            readOnly
            className="mt-2 h-28 w-full rounded-[var(--radius-control)] border border-line bg-white p-2 font-mono text-[11px] text-ink"
            value={handoff.command}
            onFocus={(e) => e.currentTarget.select()}
            aria-label="Claude Code に貼る文"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" className="btn btn-primary pressable" onClick={() => void copyCommand()}>
              コピーする
            </button>
            {copied && <span className="text-xs text-ink-muted">コピーしました。</span>}
            <button type="button" className="btn pressable" onClick={() => setHandoff(null)}>
              閉じる
            </button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-b-xl border border-t-0 border-line bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-subtle text-left text-xs text-ink-muted">
            <tr>
              <th scope="col" className="w-10 px-3 py-2">
                <input
                  type="checkbox"
                  checked={allShown}
                  onChange={toggleAll}
                  aria-label="表示中をすべて選ぶ"
                />
              </th>
              <th scope="col" className="px-3 py-2">状態</th>
              <th scope="col" className="px-3 py-2">画面</th>
              <th scope="col" className="px-3 py-2">内容</th>
              <th scope="col" className="px-3 py-2">指示文</th>
              <th scope="col" className="px-3 py-2">届いた日時</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const result = results.get(r.id);
              return (
                <tr key={r.id} className="border-t border-line align-top">
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selected.has(r.id)}
                      onChange={() => toggle(r.id)}
                      aria-label={`${r.screenLabel}の要望を選ぶ`}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={r.statusTone}>{r.statusLabel}</Badge>
                    {r.archived && <span className="ml-1 text-[11px] text-ink-muted">廃棄</span>}
                  </td>
                  <td className="px-3 py-2 text-xs font-semibold text-ink">{r.screenLabel}</td>
                  <td className="px-3 py-2">
                    <Link href={`/admin/improvements/${r.id}`} className="line-clamp-2 text-ink underline">
                      {r.body}
                    </Link>
                    {r.hasShot && <span className="ml-1 text-[11px] text-ink-muted">画像あり</span>}
                    {result && (
                      <p className={`mt-1 text-[11px] ${result.ok ? "text-ink-muted" : "text-danger"}`}>
                        {result.ok ? "" : "失敗: "}
                        {result.message}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    <span
                      className={
                        r.instructionState === "none" || r.instructionState === "excluded"
                          ? "text-ink-muted"
                          : "font-semibold text-brand-deep"
                      }
                    >
                      {r.instructionStateLabel}
                    </span>
                    <p className="text-[11px] text-ink-muted">{r.instructionNote}</p>
                  </td>
                  <td className="px-3 py-2 text-xs text-ink-muted">
                    {r.reporterName || "利用者"}
                    <br />
                    {r.createdAtLabel}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
