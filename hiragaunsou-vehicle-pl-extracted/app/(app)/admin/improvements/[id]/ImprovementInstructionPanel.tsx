"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertPanel } from "../../../../_components/AlertPanel";

/**
 * この1件を Claude Code に渡すためのパネル。
 *
 * 手順を「下書きを読む → 発行する → コピーする」の3つに固定する。
 * いきなり鍵が出る作りにしないのは、外へ出る中身を一度も読まずに渡せてしまうと、
 * 載ってはいけないものが載っていても気づけないため。
 *
 * 一覧の一括発行と同じ API (publishInstructions) を件数1で呼ぶ。
 * 画面ごとに処理を書き分けると、片方にだけ入った守りがもう片方から抜ける。
 */

interface Draft {
  id: string;
  title: string;
  markdown: string;
}

export function ImprovementInstructionPanel({
  id,
  stateLabel,
  note,
}: {
  id: string;
  stateLabel: string;
  note: string;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [plan, setPlan] = useState<string | null>(null);
  const [handoff, setHandoff] = useState<{ command: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function post(url: string, payload: unknown) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = (await res.json()) as Record<string, unknown>;
    return { ok: res.ok, json };
  }

  /** 下見。何が起きるかと、外へ出る全文を出すだけで、まだ何も保存しない。 */
  async function preview() {
    setBusy(true);
    setError(null);
    setDone(null);
    setHandoff(null);
    try {
      const { ok, json } = await post(`/api/improvements/${id}/instruction`, { dryRun: true });
      if (!ok) {
        setError(String(json.message ?? "確認できませんでした。"));
        return;
      }
      const items = (json.plan as { items?: { reason?: string }[] } | undefined)?.items ?? [];
      const drafts = (json.drafts ?? []) as Draft[];
      setPlan(items[0]?.reason ?? null);
      setDraft(drafts[0] ?? null);
    } catch {
      setError("通信できませんでした。時間をおいてお試しください。");
    } finally {
      setBusy(false);
    }
  }

  /** 発行して、その場でこの1件だけを開ける鍵を作る。 */
  async function publish() {
    setBusy(true);
    setError(null);
    try {
      const { ok, json } = await post(`/api/improvements/${id}/instruction`, {});
      if (!ok) {
        setError(String(json.message ?? "発行できませんでした。"));
        return;
      }
      const results = (json.results ?? []) as { ok: boolean; message: string }[];
      const result = results[0];
      if (!result?.ok) {
        setError(result?.message ?? "発行できませんでした。");
        return;
      }
      setDone(result.message);

      const token = await post("/api/improvements/tokens", {
        ids: [id],
        name: "1件を渡すための鍵",
      });
      if (!token.ok) {
        setError(
          String(token.json.message ?? "指示文は発行できましたが、渡すための鍵を作れませんでした。"),
        );
        return;
      }
      setHandoff({
        command: String(token.json.command ?? ""),
        expiresAt: String(token.json.expiresAt ?? ""),
      });
      setDraft(null);
      setPlan(null);
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

  return (
    <div className="card mt-3 px-4 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs font-semibold text-ink">Claude Code に渡す</p>
        <span className="text-xs text-ink-muted">
          いまの状態: {stateLabel}（{note}）
        </span>
        <button
          type="button"
          className="btn pressable ml-auto"
          onClick={() => void preview()}
          disabled={busy}
        >
          渡す文を確認する
        </button>
      </div>

      {plan && <p className="mt-2 text-xs text-ink">{plan}</p>}

      {draft && (
        <div className="mt-2">
          <p className="text-[11px] font-semibold text-ink">{draft.title}</p>
          {/* 外へ出る中身をそのまま読ませる。要約だけでは、載ってはいけないものに気づけない */}
          <pre className="mt-1 max-h-80 overflow-auto whitespace-pre-wrap rounded-[var(--radius-control)] border border-line bg-subtle p-2 text-[11px] text-ink-muted">
            {draft.markdown}
          </pre>
          <button
            type="button"
            className="btn btn-primary pressable mt-2"
            onClick={() => void publish()}
            disabled={busy}
          >
            {busy ? "処理中…" : "この内容で発行して、渡す文を出す"}
          </button>
        </div>
      )}

      {error && (
        <div className="mt-2">
          <AlertPanel tone="danger" title={error} />
        </div>
      )}
      {done && !error && (
        <div className="mt-2">
          <AlertPanel tone="success" title={done} />
        </div>
      )}

      {handoff && (
        <div className="mt-3 rounded-[var(--radius-control)] border border-line bg-subtle p-3">
          <p className="text-xs font-semibold text-ink">
            下の文をコピーして、Claude Code に貼ってください
          </p>
          <p className="mt-1 text-[11px] text-ink-muted">
            この文には鍵が入っています。この1件だけが読めます。
            {handoff.expiresAt &&
              `期限は ${new Date(handoff.expiresAt).toLocaleString("ja-JP")} です。`}
            この画面を離れるともう一度は出せません（そのときは、もう一度発行してください）。
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
