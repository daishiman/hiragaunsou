"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * 対象月の未分析の赤字車両をまとめてAI分析するボタン。
 * レコード単位ではなく月単位バッチでAIを呼ぶ設計のため、押下1回で当月分がまとめて処理される。
 */
export function DeficitAnalysisButton({ yearMonth }: { yearMonth: string }) {
  const router = useRouter();
  const [state, setState] = useState<
    { status: "idle" } | { status: "loading" } | { status: "error"; message: string }
  >({ status: "idle" });

  async function handleClick() {
    setState({ status: "loading" });
    try {
      const res = await fetch("/api/deficit-analysis", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ yearMonth }),
      });
      const data = (await res.json().catch(() => null)) as
        | { error?: string; analyzedCount?: number }
        | null;
      if (!res.ok) {
        setState({ status: "error", message: data?.error ?? "AI分析に失敗しました" });
        return;
      }
      setState({ status: "idle" });
      router.refresh();
    } catch {
      setState({ status: "error", message: "通信エラーが発生しました" });
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={state.status === "loading"}
        className="btn btn-primary btn-sm pressable"
      >
        {state.status === "loading" ? "AI分析中…" : "AI分析する"}
      </button>
      {/* 失敗の理由は必ず文字で出す。押せなかった/効かなかった画面は問い合わせを生む */}
      {state.status === "error" && (
        <p className="max-w-xs text-right text-[11px] text-danger">{state.message}</p>
      )}
    </div>
  );
}
