"use client";

import { useState, useTransition } from "react";
import type { ReviewFlagRecord } from "../../../src/usecase/steps/getTodoBoard";

const SEVERITY_LABEL: Record<string, string> = {
  critical: "重大",
  warning: "注意",
  info: "確認",
};

export function TodoBoard({ initialCards }: { initialCards: ReviewFlagRecord[] }) {
  const [cards, setCards] = useState(initialCards);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function resolve(id: string, action: "corrected" | "approved" | "dismissed") {
    setPendingId(id);
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/todo/${id}/resolve`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action }),
        });
        if (!res.ok) throw new Error("failed");
        setCards((prev) => prev.filter((c) => c.id !== id));
      } catch {
        setError("処理に失敗しました。時間をおいて再度お試しください。");
      } finally {
        setPendingId(null);
      }
    });
  }

  if (cards.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line px-6 py-12 text-center">
        <p className="text-sm font-semibold text-ink">今月の入力は完了しています</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <div className="rounded-md border border-caution-border bg-caution-soft px-4 py-3 text-xs">
          {error}
        </div>
      ) : null}
      {cards.map((card) => (
        <section key={card.id} className="rounded-xl border border-line bg-white p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <span className="inline-flex items-center whitespace-nowrap rounded-full border border-transparent bg-brand-soft px-2.5 py-0.5 text-xs font-medium text-brand-deep">
                {SEVERITY_LABEL[card.severity] ?? card.severity}
              </span>
              <p className="mt-2 text-sm text-ink">{card.message}</p>
              <p className="mt-1 text-xs text-ink-muted">
                {card.vehicleNo ? `車番 ${card.vehicleNo}` : "全社"}
                {card.field ? ` / ${card.field}` : ""}
              </p>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={pendingId === card.id}
              onClick={() => resolve(card.id, "corrected")}
              className="pressable rounded-md border border-brand px-4 py-2 text-sm font-semibold text-brand-deep hover:bg-brand-soft disabled:opacity-50"
            >
              修正する
            </button>
            <button
              type="button"
              disabled={pendingId === card.id}
              onClick={() => resolve(card.id, "approved")}
              className="pressable rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-deep disabled:opacity-50"
            >
              実績として承認する
            </button>
          </div>
        </section>
      ))}
    </div>
  );
}
