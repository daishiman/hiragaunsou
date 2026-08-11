"use client";

import { useState, useTransition } from "react";
import type { ReviewFlagRecord } from "../../../src/usecase/steps/getTodoBoard";
import type { ReviewSeverity } from "../../../src/domain/rules/vehiclePlReview";
import type { VehiclePlField } from "../../../src/domain/entities/VehiclePl";
import { EmptyState } from "../../_components/EmptyState";
import { AlertPanel } from "../../_components/AlertPanel";
import { Badge } from "../../_components/Badge";
import { StickyFilterBar } from "../../_components/StickyFilterBar";
import { SEVERITY_LABELS, SEVERITY_TONE } from "../../_lib/severity";
import { FIELD_LABELS } from "../../_lib/fieldLabels";

/*
  表かカードか (T7 §4-1)。
  利用者はここで「列をまたいで値を見比べる」のではなく、1件ずつ中身を読んで
  直すか・このままでよいかを決める。よってカードのまま置く (T7 §4-3 で
  「やること」はカードと決まっている)。
*/

/*
  重大さの呼び名は1箇所 (app/_lib/severity.ts) に置く。
  ただしこの画面のデータ (getTodoBoard) は critical / warning / info で、
  訳の表は blocking / warning / info の並びなので、ここで名前だけ合わせる。
  値の意味は変えない (critical = 直さないと先へ進めないもの)。
*/
const SEVERITY_KEY: Record<string, ReviewSeverity> = {
  critical: "blocking",
  warning: "warning",
  info: "info",
};

/** 英語の列キーを日本語の列名にする。表に無いキーはそのまま出す。 */
function fieldLabel(field: string): string {
  return FIELD_LABELS[field as VehiclePlField] ?? field;
}

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
      <EmptyState
        title="残っている確認はありません"
        description="この月で判定が必要な項目は、すべて片付いています。次は月次収支表で数字を確かめてください。"
        actionHref="/grid"
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* 下までスクロールしても「あと何件残っているか」が消えないように貼り付ける */}
      <StickyFilterBar summary={`残り ${cards.length}件`}>
        <p className="text-xs text-ink-muted">
          1件ずつ読んで、直すか・このままでよいかを決めます。
        </p>
      </StickyFilterBar>

      {error ? (
        <AlertPanel tone="danger" title="判定を保存できませんでした">
          {error}
        </AlertPanel>
      ) : null}

      {cards.map((card) => (
        <section key={card.id} className="card p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <Badge tone={SEVERITY_TONE[SEVERITY_KEY[card.severity] ?? "info"]}>
                {SEVERITY_LABELS[SEVERITY_KEY[card.severity] ?? "info"]}
              </Badge>
              <p className="mt-2 text-sm text-ink">{card.message}</p>
              <p className="mt-1 text-xs text-ink-muted">
                {card.vehicleNo ? `車番 ${card.vehicleNo}` : "全社"}
                {card.field ? ` / ${fieldLabel(card.field)}` : ""}
              </p>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={pendingId === card.id}
              onClick={() => resolve(card.id, "corrected")}
              className="btn btn-secondary pressable"
            >
              直す
            </button>
            <button
              type="button"
              disabled={pendingId === card.id}
              onClick={() => resolve(card.id, "approved")}
              className="btn btn-primary pressable"
            >
              このままでよい
            </button>
          </div>
        </section>
      ))}
    </div>
  );
}
