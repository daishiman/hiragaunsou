"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertPanel } from "../../../_components/AlertPanel";
import { Badge } from "../../../_components/Badge";
import {
  ISSUE_BULK_MAX,
  LIFECYCLE_BULK_MAX,
  actionRequiresReason,
  lifecycleActionLabel,
  type LifecycleAction,
} from "../../../../src/domain/rules/improvementLifecycle";

/**
 * 改善要望の一覧 (表) と、選んだものへの一括操作。
 *
 * 表にしたのは「同じことを何件も続けてやる」画面だから。1件1枚のカードは
 * 読むのには向くが、10件を Issue に送る作業には向かない (実際に使った人から
 * 「1件ずつしか送れないのが使いにくい」と言われた)。
 *
 * どの操作も次の3段で進む。段を飛ばせる作りにしない。
 *   1. 選ぶ  … 何を対象にしたかが常に見えている
 *   2. 下見  … 「新しく作る N件 / 更新する M件 / 送らない K件」を先に出す
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
  issueNumber: number | null;
  issueUrl: string | null;
  /** 未起票 / 起票済み / 更新あり / 対象外 のどれか。 */
  issueState: "none" | "issued" | "outdated" | "excluded";
  issueStateNote: string;
}

interface RowResult {
  id: string;
  ok: boolean;
  message: string;
}

type Pending =
  | { kind: "issue"; summary: string; details: string[] }
  | { kind: "lifecycle"; action: LifecycleAction; summary: string; details: string[] }
  | { kind: "purge"; summary: string; details: string[]; count: number };

const LIFECYCLE_CHOICES: LifecycleAction[] = ["drop", "invalid", "duplicate", "archive", "restore"];

export function ImprovementBulkTable({ rows, canPurge }: { rows: BulkRow[]; canPurge: boolean }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [action, setAction] = useState<LifecycleAction>("archive");
  const [reason, setReason] = useState("");
  const [duplicateOfId, setDuplicateOfId] = useState("");
  const [reopenClosed, setReopenClosed] = useState(false);
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
      if (kind === "issue") {
        const { ok, json } = await post("/api/improvements/issues", { ids, dryRun: true, reopenClosed });
        if (!ok) {
          setError(String(json.message ?? "確認できませんでした。"));
          return;
        }
        const counts = (json.counts ?? {}) as Record<string, number | undefined>;
        const items = (json.items ?? []) as { id: string; kind: string; reason?: string }[];
        setPending({
          kind: "issue",
          summary: [
            `新しく Issue を作る: ${counts.create}件`,
            `すでにある Issue を更新する: ${counts.update}件`,
            `変わっていないため送らない: ${counts.skip}件`,
            `対象外のため送らない: ${counts.excluded}件`,
            ...((counts.missing ?? 0) > 0 ? [`見つからない: ${counts.missing}件`] : []),
          ].join(" / "),
          details: items.map((i) => {
            const row = rows.find((r) => r.id === i.id);
            return `${row?.screenLabel ?? i.id}: ${labelOfIssueKind(i.kind)}${i.reason ? `（${i.reason}）` : ""}`;
          }),
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
        pending.kind === "issue"
          ? (["/api/improvements/issues", { ids, reopenClosed }] as const)
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
      setPending(null);
      router.refresh();
    } catch {
      setError("通信できませんでした。時間をおいてお試しください。");
    } finally {
      setBusy(false);
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
              onClick={() => void preview("issue")}
              disabled={busy || ids.length === 0}
            >
              選んだものを Issue に送る
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
          一度に送れる Issue は{ISSUE_BULK_MAX}件、状態の変更は{LIFECYCLE_BULK_MAX}件までです。
          超えた分は黙って切り捨てず、選び直しをお願いします。
        </p>
      </div>

      {/* 下見の結果。ここで初めて「何が起きるか」が確定する */}
      {pending && (
        <div className="border-x border-line bg-subtle px-3 py-3">
          <p className="text-sm font-semibold text-ink">
            {pending.kind === "issue"
              ? "この内容で GitHub に送ります"
              : pending.kind === "purge"
                ? `${pending.count}件を完全に削除します。元に戻せません。`
                : `${lifecycleActionLabel(pending.action)}前の確認`}
          </p>
          <p className="mt-1 text-xs text-ink">{pending.summary}</p>
          {pending.kind === "purge" && (
            <p className="mt-1 text-xs text-danger">
              本文・画面の写し・診断情報をまとめて消します。すでに立っている GitHub Issue は消さず、
              「元データは削除済み」と書き残します。
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
          {pending.kind === "issue" && (
            <label className="mt-2 flex items-center gap-2 text-xs text-ink">
              <input
                type="checkbox"
                checked={reopenClosed}
                onChange={(e) => setReopenClosed(e.target.checked)}
              />
              閉じている Issue は開き直す（既定では開き直さず、本文の更新とコメントだけ）
            </label>
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
              <th scope="col" className="px-3 py-2">起票</th>
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
                    {r.issueNumber !== null && r.issueUrl ? (
                      <a
                        href={r.issueUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="font-semibold text-brand-deep underline"
                      >
                        #{r.issueNumber}
                      </a>
                    ) : (
                      <span className="text-ink-muted">未起票</span>
                    )}
                    <p className="text-[11px] text-ink-muted">{r.issueStateNote}</p>
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

function labelOfIssueKind(kind: string): string {
  if (kind === "create") return "新しく Issue を作ります";
  if (kind === "update") return "すでにある Issue を更新します";
  if (kind === "skip") return "変わっていないので送りません";
  return "対象外";
}
