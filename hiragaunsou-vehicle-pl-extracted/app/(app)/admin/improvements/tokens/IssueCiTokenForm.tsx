"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertPanel } from "../../../../_components/AlertPanel";
import {
  TOKEN_ALL_SCOPE_REASON_MIN,
  TOKEN_MAX_DAYS,
} from "../../../../../src/domain/rules/instructionAccess";

/**
 * GitHub Actions に置く鍵を作る入口。
 *
 * 使い道は1つだけ。確認依頼 (PR) が閉じたときに、要望の状態を
 * 「レビュー待ち」「対応済み」へ進めることである。指示文は読めない。
 *
 * 読めない鍵をわざわざ別に作るのは、置き場所が違うから。この鍵は GitHub の
 * 保管庫に入れっぱなしになり、人の目に触れないまま期限まで動き続ける。
 * もし読める鍵をそこに置いてしまうと、保管庫が漏れた日に、
 * 要望の中身 (現場の人が書いた文章と画面の写し) まで一緒に出ていく。
 * だから「読める鍵は人が持つ」「置きっぱなしの鍵は読めない」で分けている。
 *
 * 作る頻度は年に数回なので、探して開いた人だけが使える形にしてある。
 */
export function IssueCiTokenForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [days, setDays] = useState(TOKEN_MAX_DAYS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 平文の鍵。GitHub の保管庫へ写してもらうため、ここでだけ出す。 */
  const [issued, setIssued] = useState<{ token: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const reasonTooShort = reason.trim().length < TOKEN_ALL_SCOPE_REASON_MIN;

  async function issue() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/improvements/tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ purpose: "ci", ids: [], reason, days }),
      });
      const json = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        setError(String(json.message ?? "鍵を作れませんでした。"));
        return;
      }
      setIssued({
        token: String(json.token ?? ""),
        expiresAt: String(json.expiresAt ?? ""),
      });
      setReason("");
      router.refresh();
    } catch {
      setError("通信できませんでした。時間をおいてお試しください。");
    } finally {
      setBusy(false);
    }
  }

  async function copyToken() {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.token);
      setCopied(true);
    } catch {
      setError("コピーできませんでした。下の文字を選んで写してください。");
    }
  }

  if (!open) {
    return (
      <div className="mt-2">
        <button type="button" className="btn pressable" onClick={() => setOpen(true)}>
          GitHub Actions 用の鍵を作る
        </button>
        <p className="mt-1 text-[11px] text-ink-muted">
          確認依頼が閉じたときに、要望の状態を自動で進めるための鍵です。年に数回しか使いません。
        </p>
      </div>
    );
  }

  return (
    <div className="mt-2 rounded-xl border border-line bg-subtle px-3 py-3">
      <p className="text-sm font-semibold text-ink">GitHub Actions 用の鍵を作る</p>
      {/* できることを、作る前に言い切る。「CI 用」の一言では範囲が伝わらない */}
      <p className="mt-1 text-xs text-ink-muted">
        この鍵にできるのは、要望の状態を進めることだけです。
        <strong className="text-ink">指示文は読めません。</strong>
        期限は最長{TOKEN_MAX_DAYS}日です。切れたらここで作り直し、GitHub 側にも入れ直してください。
      </p>

      <label className="mt-3 block text-xs font-semibold text-ink" htmlFor="ci-token-reason">
        何に使うか
      </label>
      <textarea
        id="ci-token-reason"
        className="mt-1 h-16 w-full rounded-[var(--radius-control)] border border-line bg-white p-2 text-xs text-ink"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="例: 確認依頼のマージで要望を対応済みにするため"
      />
      <p className="mt-1 text-[11px] text-ink-muted">
        置きっぱなしになる鍵なので、あとで「これは消してよいのか」が分かるように残します。
        {TOKEN_ALL_SCOPE_REASON_MIN}文字以上。
      </p>

      <label className="mt-3 block text-xs font-semibold text-ink" htmlFor="ci-token-days">
        期限（日）
      </label>
      <input
        id="ci-token-days"
        type="number"
        min={1}
        max={TOKEN_MAX_DAYS}
        className="mt-1 w-24 rounded-[var(--radius-control)] border border-line bg-white p-2 text-xs text-ink"
        value={days}
        onChange={(e) => setDays(Number(e.target.value))}
      />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn btn-primary pressable"
          disabled={busy || reasonTooShort}
          onClick={() => void issue()}
        >
          {busy ? "作っています…" : "この内容で作る"}
        </button>
        <button type="button" className="btn pressable" onClick={() => setOpen(false)}>
          やめる
        </button>
        {reasonTooShort && (
          <span className="text-[11px] text-ink-muted">何に使うかを書くと押せます。</span>
        )}
      </div>

      {error && (
        <div className="mt-2">
          <AlertPanel tone="danger" title={error} />
        </div>
      )}

      {issued && (
        <div className="mt-3 rounded-[var(--radius-control)] border border-line bg-white p-3">
          <p className="text-xs font-semibold text-ink">
            この文字を GitHub の保管庫に入れてください
          </p>
          <p className="mt-1 text-[11px] text-ink-muted">
            GitHub のリポジトリ → Settings → Secrets and variables → Actions で、
            <code className="mx-1">IMPROVEMENT_STATUS_TOKEN</code>
            という名前で保存します。
            {issued.expiresAt &&
              `期限は ${new Date(issued.expiresAt).toLocaleString("ja-JP")} です。`}
            この画面を離れるともう一度は出せません（そのときは、もう一度作ってください）。
          </p>
          <textarea
            readOnly
            className="mt-2 h-16 w-full rounded-[var(--radius-control)] border border-line bg-white p-2 font-mono text-[11px] text-ink"
            value={issued.token}
            onFocus={(e) => e.currentTarget.select()}
            aria-label="GitHub の保管庫に入れる鍵"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" className="btn btn-primary pressable" onClick={() => void copyToken()}>
              コピーする
            </button>
            {copied && <span className="text-xs text-ink-muted">コピーしました。</span>}
          </div>
        </div>
      )}
    </div>
  );
}
