"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertPanel } from "../../../../_components/AlertPanel";
import {
  TOKEN_ALL_SCOPE_DEFAULT_DAYS,
  TOKEN_ALL_SCOPE_MAX_DAYS,
  TOKEN_ALL_SCOPE_REASON_MIN,
} from "../../../../../src/domain/rules/instructionAccess";

/**
 * 「発行済みのすべてを読める鍵」を作る入口。
 *
 * 普段はこれを使わない。改善要望の一覧から渡せば、必ず渡した件だけの鍵になる。
 * ここが要るのは「渡した件が多すぎて鍵を何本も貼ることになる」ときや、
 * まとめて棚卸ししたいときで、頻度は低い。
 *
 * 頻度が低く、漏れたときの被害が一番大きい操作なので、次の形にしている。
 *   - 既定では閉じておく (探して開いた人だけが使う)
 *   - 何ができる鍵かを、押す前に言い切る
 *   - 理由を必ず書かせる (記録に残り、後から「なぜ全件か」を辿れる)
 *   - 期限は最長でも3日。既定は1日
 *
 * 手数を増やして止めるのではなく、残るものを増やして止める。
 */
export function IssueAllScopeTokenForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [days, setDays] = useState(TOKEN_ALL_SCOPE_DEFAULT_DAYS);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [handoff, setHandoff] = useState<{ command: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const reasonTooShort = reason.trim().length < TOKEN_ALL_SCOPE_REASON_MIN;

  async function issue() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/improvements/tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // ids を空で送ると「発行済みのすべて」を読める鍵になる。
        // 何を作るかを画面の状態から組み立てず、ここで言い切っておく。
        body: JSON.stringify({ ids: [], reason, days, name: "全件を読める鍵" }),
      });
      const json = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        setError(String(json.message ?? "鍵を作れませんでした。"));
        return;
      }
      setHandoff({
        command: String(json.command ?? ""),
        expiresAt: String(json.expiresAt ?? ""),
      });
      setConfirming(false);
      setReason("");
      router.refresh();
    } catch {
      setError("通信できませんでした。時間をおいてお試しください。");
    } finally {
      setBusy(false);
    }
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

  if (!open) {
    return (
      <div className="mt-4">
        <button type="button" className="btn pressable" onClick={() => setOpen(true)}>
          発行済みのすべてを読める鍵を作る
        </button>
        <p className="mt-1 text-[11px] text-ink-muted">
          ふだんは使いません。改善要望の一覧から渡すと、渡した件だけを読める鍵ができます。
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-xl border border-line bg-subtle px-3 py-3">
      <p className="text-sm font-semibold text-ink">発行済みのすべてを読める鍵を作る</p>
      {/* 何ができる鍵かを、作る前に言い切る。「全件」の一言では範囲が伝わらない */}
      <p className="mt-1 text-xs text-danger">
        この鍵を持つ人は、いま発行済みの指示文をすべて読めます。渡した件だけの鍵と違い、
        1本渡すと以後に発行した分まで読めます。期限は最長{TOKEN_ALL_SCOPE_MAX_DAYS}日で、
        既定は{TOKEN_ALL_SCOPE_DEFAULT_DAYS}日です。
      </p>

      <label className="mt-2 block text-xs text-ink-muted" htmlFor="all-scope-reason">
        何のために作るか（記録に残ります・{TOKEN_ALL_SCOPE_REASON_MIN}文字以上）
      </label>
      <input
        id="all-scope-reason"
        className="mt-1 w-full rounded-[var(--radius-control)] border border-line px-3 py-2 text-sm"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="例: 溜まった要望をまとめて棚卸しするため"
      />

      <label className="mt-2 block text-xs text-ink-muted" htmlFor="all-scope-days">
        期限
      </label>
      <select
        id="all-scope-days"
        className="mt-1 h-9 rounded-[var(--radius-control)] border border-line px-2 text-sm"
        value={days}
        onChange={(e) => setDays(Number(e.target.value))}
      >
        {Array.from({ length: TOKEN_ALL_SCOPE_MAX_DAYS }, (_, i) => i + 1).map((d) => (
          <option key={d} value={d}>
            {d}日
          </option>
        ))}
      </select>

      {confirming ? (
        <div className="mt-3">
          <p className="text-sm font-semibold text-ink">
            発行済みのすべてを読める鍵を、{days}日間だけ使える形で作ります。
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-danger pressable"
              onClick={() => void issue()}
              disabled={busy}
            >
              {busy ? "処理中…" : "この内容で鍵を作る"}
            </button>
            <button
              type="button"
              className="btn pressable"
              onClick={() => setConfirming(false)}
              disabled={busy}
            >
              やめる
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="btn pressable text-danger"
            onClick={() => setConfirming(true)}
            disabled={busy || reasonTooShort}
          >
            作る内容を確認する
          </button>
          <button type="button" className="btn pressable" onClick={() => setOpen(false)} disabled={busy}>
            閉じる
          </button>
          {reasonTooShort && (
            <span className="self-center text-[11px] text-ink-muted">
              先に理由を書いてください。
            </span>
          )}
        </div>
      )}

      {error && (
        <div className="mt-2">
          <AlertPanel tone="danger" title={error} />
        </div>
      )}

      {handoff && (
        <div className="mt-3 rounded-[var(--radius-control)] border border-line bg-white p-3">
          <p className="text-xs font-semibold text-ink">
            下の文をコピーして、Claude Code に貼ってください
          </p>
          <p className="mt-1 text-[11px] text-ink-muted">
            この文には、発行済みのすべてを読める鍵が入っています。
            {handoff.expiresAt &&
              `期限は ${new Date(handoff.expiresAt).toLocaleString("ja-JP")} です。`}
            この画面を離れるともう一度は出せません。渡し終わったら、下の一覧から止められます。
          </p>
          <textarea
            readOnly
            className="mt-2 h-28 w-full rounded-[var(--radius-control)] border border-line bg-white p-2 font-mono text-[11px] text-ink"
            value={handoff.command}
            onFocus={(e) => e.currentTarget.select()}
            aria-label="Claude Code に貼る文"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn btn-primary pressable"
              onClick={() => void copyCommand()}
            >
              コピーする
            </button>
            {copied && <span className="text-xs text-ink-muted">コピーしました。</span>}
          </div>
        </div>
      )}
    </div>
  );
}
