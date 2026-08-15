"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertPanel } from "../../../../_components/AlertPanel";
import { Badge } from "../../../../_components/Badge";

/**
 * 鍵の一覧と「止める」操作。
 *
 * 止める操作は取り消せないので、押す前に何を止めるかを名前で見せてから確認する。
 * ただし完全削除ほど重くはない (止めても記録は残り、渡し直せる) ので、
 * 二段階の入力までは求めない。
 */

export interface TokenRow {
  id: string;
  name: string;
  scopeLabel: string;
  createdLabel: string;
  expiresLabel: string;
  usageLabel: string;
  state: "active" | "expired" | "revoked";
  stateNote: string;
}

export function InstructionTokenTable({ rows }: { rows: TokenRow[] }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<TokenRow | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function revoke() {
    if (!confirming) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/improvements/tokens/${confirming.id}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const json = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        setError(String(json.message ?? "止められませんでした。"));
        return;
      }
      setDone(String(json.message ?? "鍵を止めました。"));
      setConfirming(null);
      setReason("");
      router.refresh();
    } catch {
      setError("通信できませんでした。時間をおいてお試しください。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4">
      {error && <AlertPanel tone="danger" title={error} />}
      {done && !error && <AlertPanel tone="success" title={done} />}

      {confirming && (
        <div className="mt-2 rounded-xl border border-line bg-subtle px-3 py-3">
          <p className="text-sm font-semibold text-ink">
            「{confirming.name}」を止めます。この鍵では読めなくなります。
          </p>
          <label className="mt-2 block text-xs text-ink-muted" htmlFor="revoke-reason">
            理由（あとから見た人が経緯をたどれるように書きます）
          </label>
          <input
            id="revoke-reason"
            className="mt-1 w-full rounded-[var(--radius-control)] border border-line px-3 py-2 text-sm"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="例: 渡す相手が変わったため"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-danger pressable"
              onClick={() => void revoke()}
              disabled={busy}
            >
              {busy ? "処理中…" : "この鍵を止める"}
            </button>
            <button
              type="button"
              className="btn pressable"
              onClick={() => setConfirming(null)}
              disabled={busy}
            >
              やめる
            </button>
          </div>
        </div>
      )}

      <div className="mt-3 overflow-x-auto rounded-xl border border-line bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-subtle text-left text-xs text-ink-muted">
            <tr>
              <th scope="col" className="px-3 py-2">状態</th>
              <th scope="col" className="px-3 py-2">鍵</th>
              <th scope="col" className="px-3 py-2">読める範囲</th>
              <th scope="col" className="px-3 py-2">期限</th>
              <th scope="col" className="px-3 py-2">使われ方</th>
              <th scope="col" className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-line align-top">
                <td className="px-3 py-2">
                  <Badge tone={r.state === "active" ? "brand" : "neutral"}>
                    {r.state === "active" ? "使えます" : r.state === "expired" ? "期限切れ" : "止めました"}
                  </Badge>
                  <p className="mt-0.5 text-[11px] text-ink-muted">{r.stateNote}</p>
                </td>
                <td className="px-3 py-2 text-xs font-semibold text-ink">
                  {r.name}
                  {/* 鍵そのものは出さない。保存しているのは指紋だけで、平文は発行時の1回きり */}
                  <p className="mt-0.5 font-normal text-[11px] text-ink-muted">{r.createdLabel}</p>
                </td>
                <td className="px-3 py-2 text-xs text-ink-muted">{r.scopeLabel}</td>
                <td className="px-3 py-2 text-xs text-ink-muted">{r.expiresLabel}</td>
                <td className="px-3 py-2 text-xs text-ink-muted">{r.usageLabel}</td>
                <td className="px-3 py-2">
                  {r.state === "active" && (
                    <button
                      type="button"
                      className="btn pressable text-danger"
                      onClick={() => setConfirming(r)}
                    >
                      止める
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
