"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertPanel } from "../../../../_components/AlertPanel";

/**
 * 1件の要望を廃棄する・廃棄から戻す・完全に削除する。
 *
 * 「削除」と書かれた既定のボタンは廃棄 (あとで戻せる) にしてある。
 * 押し間違いから戻せない操作を既定にすると、いつか必ず消したくないものが消える。
 *
 * 完全削除は名前も置き場所も分け、二段階で確認する。個人情報を消してほしいという
 * 求めに応えるための操作なので、本文だけでなく画面の写しと診断情報も一緒に消える。
 */
export function ImprovementLifecyclePanel({
  id,
  archived,
  canPurge,
}: {
  id: string;
  archived: boolean;
  canPurge: boolean;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [confirmPurge, setConfirmPurge] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function call(url: string, payload: unknown, onDone: () => void) {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as {
        message?: string;
        results?: { ok: boolean; message: string }[];
      };
      if (!res.ok) {
        setError(json.message ?? "実行できませんでした。");
        return;
      }
      const first = json.results?.[0];
      if (first && !first.ok) {
        setError(first.message);
        return;
      }
      setDone(first?.message ?? "実行しました。");
      onDone();
    } catch {
      setError("通信できませんでした。時間をおいてお試しください。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card mt-3 px-4 py-4">
      <p className="text-xs font-semibold text-ink">この要望をしまう・削除する</p>
      <p className="mt-0.5 text-xs text-ink-muted">
        {archived
          ? "この要望は廃棄済みで、既定の一覧には出ません。戻せばまた並びます。"
          : "廃棄すると既定の一覧から外れます。あとから「廃棄したものだけ」で探して戻せます。"}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {archived ? (
          <button
            type="button"
            className="btn btn-primary pressable"
            onClick={() =>
              void call(
                "/api/improvements/lifecycle",
                { action: "restore", ids: [id] },
                () => router.refresh(),
              )
            }
            disabled={busy}
          >
            廃棄から戻す
          </button>
        ) : (
          <button
            type="button"
            className="btn pressable"
            onClick={() =>
              void call(
                "/api/improvements/lifecycle",
                { action: "archive", ids: [id], reason },
                () => router.refresh(),
              )
            }
            disabled={busy}
          >
            廃棄する（あとで戻せます）
          </button>
        )}

        {canPurge && !confirmPurge && (
          <button
            type="button"
            className="btn pressable text-danger"
            onClick={() => setConfirmPurge(true)}
            disabled={busy}
          >
            完全に削除する（戻せません）
          </button>
        )}
      </div>

      {canPurge && confirmPurge && (
        <div className="mt-3 rounded-[var(--radius-control)] border border-danger px-3 py-3">
          <p className="text-sm font-semibold text-danger">この1件を完全に削除します。戻せません。</p>
          <ul className="mt-1 list-disc pl-5 text-xs text-ink">
            <li>本文・画面の写し・診断情報をまとめて消します。</li>
            <li>いつ・誰が・なぜ消したかの記録だけは残ります（記録は消えません）。</li>
            <li>
              すでに立っている GitHub Issue は消しません。「元データは削除済み」と書き残します。
            </li>
          </ul>
          <label className="mt-2 block text-xs font-semibold text-ink" htmlFor="purge_reason">
            削除する理由（必須）
          </label>
          <input
            id="purge_reason"
            className="mt-1 w-full rounded-[var(--radius-control)] border border-line px-3 py-2 text-sm"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="例: 本人から削除の依頼があったため"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-danger pressable"
              onClick={() =>
                void call(
                  "/api/improvements/purge",
                  { ids: [id], reason, confirmCount: 1 },
                  () => router.replace("/admin/improvements"),
                )
              }
              disabled={busy || reason.trim().length === 0}
            >
              {busy ? "処理中…" : "1件を完全に削除する"}
            </button>
            <button
              type="button"
              className="btn pressable"
              onClick={() => setConfirmPurge(false)}
              disabled={busy}
            >
              やめる
            </button>
          </div>
        </div>
      )}

      {!archived && !confirmPurge && (
        <>
          <label className="mt-3 block text-xs font-semibold text-ink" htmlFor="archive_reason">
            廃棄する理由（任意。あとから見た人のために書けます）
          </label>
          <input
            id="archive_reason"
            className="mt-1 w-full rounded-[var(--radius-control)] border border-line px-3 py-2 text-sm"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="例: 同じ内容が別の要望にまとまっているため"
          />
        </>
      )}

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
