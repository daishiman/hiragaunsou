"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertPanel } from "../../../../_components/AlertPanel";
import { GitHubTokenGuide } from "./GitHubTokenGuide";

/**
 * 改善要望を GitHub Issue にする操作。
 *
 * 出す前に必ず中身を読めるようにする。Issue には業務の言葉・画面のURL・
 * エラーの中身が載るので、「押したら何が外へ出るか」を見ないまま押させない。
 * だから既定の導線は「下書きを見る」→「この内容で起票する」の2段にする。
 *
 * 起票済みの要望では押せる場所を作らない。番号とURLだけを出す
 * (押せてしまう限り、いつか2本目が立つ)。
 */
export function ImprovementIssuePanel({
  id,
  issueNumber,
  issueUrl,
}: {
  id: string;
  issueNumber: number | null;
  issueUrl: string | null;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<string | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (issueNumber !== null) {
    return (
      <div className="card mt-3 px-4 py-4">
        <p className="text-xs font-semibold text-ink">GitHub Issue</p>
        <p className="mt-1 text-sm text-ink">
          この要望は{" "}
          {issueUrl ? (
            <a
              href={issueUrl}
              target="_blank"
              rel="noreferrer"
              className="font-semibold text-brand-deep underline"
            >
              Issue #{issueNumber}
            </a>
          ) : (
            <span className="font-semibold">Issue #{issueNumber}</span>
          )}{" "}
          として起票済みです。
        </p>
        <p className="mt-1 text-xs text-ink-muted">
          1つの要望に Issue は1つです。作り直したいときは、GitHub側で閉じてから相談してください。
        </p>
      </div>
    );
  }

  async function call(dryRun: boolean) {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const res = await fetch(`/api/improvements/${id}/issue`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dryRun }),
      });
      const json = (await res.json()) as {
        message?: string;
        body?: string;
        configured?: boolean;
        issueUrl?: string;
      };

      if (dryRun && res.ok) {
        setDraft(json.body ?? "");
        setConfigured(json.configured ?? false);
        return;
      }
      if (!res.ok) {
        // 起票先が未設定のときも本文は返ってくる。読めるものは読ませる。
        if (json.body) setDraft(json.body);
        setError(json.message ?? "起票できませんでした。");
        return;
      }
      setDone(json.message ?? "Issueを作成しました。");
      router.refresh();
    } catch {
      setError("通信できませんでした。時間をおいてお試しください。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card mt-3 px-4 py-4">
      <p className="text-xs font-semibold text-ink">GitHub Issue にする</p>
      <p className="mt-0.5 text-xs text-ink-muted">
        送信時の記録をまとめて、そのまま直しに取りかかれる形の Issue を作ります。
        押す前に、外へ出る中身を下書きで確認できます。
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn pressable"
          onClick={() => void call(true)}
          disabled={busy}
        >
          下書きを見る（起票しない）
        </button>
        <button
          type="button"
          className="btn btn-primary pressable"
          onClick={() => void call(false)}
          disabled={busy || draft === null}
        >
          {busy ? "処理中…" : "この内容で Issue にする"}
        </button>
        {draft === null && !busy && (
          <span className="text-xs text-ink-muted">
            先に下書きを確認してください。
          </span>
        )}
      </div>

      {configured === false && (
        <>
          <p className="mt-2 text-xs text-ink-muted">
            起票先（リポジトリとトークン）がまだ設定されていないため、いまは下書きの確認までできます。
          </p>
          <GitHubTokenGuide />
        </>
      )}

      {draft !== null && (
        <details className="mt-3 rounded-[var(--radius-control)] border border-line px-3 py-2" open>
          <summary className="cursor-pointer text-xs font-semibold text-ink">
            Issue に載る内容（このまま作られます）
          </summary>
          <pre className="mt-2 max-h-[420px] overflow-auto rounded-[var(--radius-control)] bg-subtle p-2 text-[11px] whitespace-pre-wrap">
            {draft}
          </pre>
        </details>
      )}

      {error && (
        <div className="mt-3">
          <AlertPanel tone="danger" title={error} />
          {/* 断られた理由が設定・権限・期限のときは、その場で直せるよう案内も出す。 */}
          {/(設定|トークン|権限)/.test(error) && configured !== false && <GitHubTokenGuide />}
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
