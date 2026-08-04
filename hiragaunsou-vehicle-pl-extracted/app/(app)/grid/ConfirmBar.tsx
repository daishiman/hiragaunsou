"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ConfirmationStatus } from "../../../src/usecase/steps/confirmMonthlyPl";

/**
 * 業務フロー STEP8「運送収支表への転記(完成)」の代替となる確定操作。
 *
 * 転記の代わりに「この月の収支表はこれで完成」と宣言する。取り消せる操作なので
 * 確認ダイアログは挟まず、押した結果と戻し方をその場に出す。
 */
export function ConfirmBar({
  status,
  yearMonth,
  canConfirm,
}: {
  status: ConfirmationStatus;
  yearMonth: string;
  canConfirm: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState(status);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle(confirmed: boolean) {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ yearMonth, confirmed }),
      });
      const json = (await res.json()) as ConfirmationStatus & { error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setState(json);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "確定できませんでした");
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      className={`mb-4 rounded-lg border px-4 py-3 ${
        state.isConfirmed ? "border-brand bg-brand-soft" : "border-line bg-white"
      }`}
    >
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm font-semibold text-ink">
          {state.isConfirmed
            ? "この月の収支表は確定済みです"
            : "この月の収支表はまだ確定していません"}
        </p>
        <p className="text-xs text-ink-muted">
          {state.isConfirmed
            ? "Excelへの転記は不要です。取込や手入力をやり直すと確定は自動で外れます。"
            : `車両 ${state.total}台分の収支ができています。内容を確認したら確定してください。`}
        </p>

        {canConfirm && (
          <div className="ml-auto">
            {state.isConfirmed ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => toggle(false)}
                className="pressable rounded-md border border-line bg-white px-4 py-1.5 text-sm text-ink hover:bg-subtle disabled:opacity-50"
              >
                {pending ? "処理中…" : "確定を取り消す"}
              </button>
            ) : (
              <button
                type="button"
                disabled={pending || !state.canConfirm}
                onClick={() => toggle(true)}
                className="pressable rounded-md bg-accent px-5 py-1.5 text-sm font-semibold text-white hover:bg-accent-deep disabled:opacity-50"
              >
                {pending ? "確定中…" : "この月を確定する"}
              </button>
            )}
          </div>
        )}
      </div>

      {!state.isConfirmed && state.openFlagCount > 0 && (
        <p className="mt-2 rounded-md border border-caution-border bg-caution-soft px-3 py-2 text-xs text-ink">
          未判定の異常値が {state.openFlagCount}件 残っています。確定はできますが、先に
          「収支表のチェック(STEP7)」で判定しておくことをおすすめします。
        </p>
      )}

      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  );
}
