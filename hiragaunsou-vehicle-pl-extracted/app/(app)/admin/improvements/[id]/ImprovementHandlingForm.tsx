"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertPanel } from "../../../../_components/AlertPanel";
import {
  IMPROVEMENT_NOTE_MAX,
  IMPROVEMENT_STATUSES,
  improvementStatusLabel,
  type ImprovementStatus,
} from "../../../../../src/domain/rules/improvement";

/**
 * 対応状況の更新。
 *
 * 「対応済み」「見送り」で終わりにしない。取り違えて閉じたときに戻せないと、
 * 要望そのものが消えたのと同じになるので、どの状態へも動かせるままにする。
 * 断るのは API 側の1つのルールと同じで、
 *   - 見送りは理由が要る
 *   - 状態もメモも変わっていない保存はしない
 * の2つだけ。画面でも同じ文言を出し、押してから初めて断られることを減らす。
 */
export function ImprovementHandlingForm({
  id,
  currentStatus,
  currentNote,
}: {
  id: string;
  currentStatus: ImprovementStatus;
  currentNote: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<ImprovementStatus>(currentStatus);
  const [note, setNote] = useState(currentNote);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const trimmed = note.trim();
  const unchanged = status === currentStatus && trimmed === currentNote.trim();
  const needsReason = status === "dropped" && trimmed.length === 0;

  async function save() {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const res = await fetch(`/api/improvements/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status, note: trimmed }),
      });
      const json = (await res.json()) as { message?: string };
      if (!res.ok) {
        setError(json.message ?? "更新できませんでした。");
        return;
      }
      setDone(json.message ?? "対応状況を更新しました。");
      router.refresh();
    } catch {
      setError("通信できませんでした。入力内容はこの画面に残っています。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card px-4 py-4">
      <p className="text-xs font-semibold text-ink">対応状況を決める</p>

      <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="対応状況">
        {IMPROVEMENT_STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            className="feedback-chip"
            aria-pressed={status === s}
            onClick={() => setStatus(s)}
          >
            {improvementStatusLabel(s)}
          </button>
        ))}
      </div>

      <label className="mt-3 block text-xs font-semibold text-ink" htmlFor="improvement_note">
        対応メモ{status === "dropped" ? "（見送りの理由。必須）" : "（任意）"}
      </label>
      <textarea
        id="improvement_note"
        className="mt-1 min-h-[72px] w-full rounded-[var(--radius-control)] border border-line px-3 py-2 text-sm"
        maxLength={IMPROVEMENT_NOTE_MAX}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={
          status === "dropped"
            ? "例：同じ内容を別の画面で直したため、この画面では対応しません。"
            : "例：次の取込のタイミングで直します。"
        }
      />
      <p className="mt-1 text-xs text-ink-muted">
        空にすると対応メモを消せます（見送りのときを除く）。送った本人には見えません。
      </p>

      {needsReason && (
        <p className="mt-2 text-xs text-danger" role="alert">
          見送りにする理由を入力してください。
        </p>
      )}

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          className="btn btn-primary pressable"
          onClick={() => void save()}
          disabled={busy || unchanged || needsReason}
        >
          この内容で保存する
        </button>
        {unchanged && !busy && (
          <span className="text-xs text-ink-muted">変更する内容がありません。</span>
        )}
      </div>

      {error && (
        <div className="mt-3">
          <AlertPanel tone="danger" title={error} />
        </div>
      )}
      {done && (
        <div className="mt-3">
          <AlertPanel tone="success" title={done} />
        </div>
      )}
    </div>
  );
}
