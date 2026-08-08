"use client";

import { useState } from "react";
import {
  RATE_MASTER_CATALOG,
  validateRateValue,
  type RateMasterKeyDef,
  type RateValueKind,
} from "../../../src/domain/rules/rateMasterCatalog";
import type { RateMasterEntry } from "../../../src/infrastructure/db/D1MasterRepository";

const KIND_UNIT: Record<RateValueKind, string> = {
  rate: "%",
  yen: "円",
  yen_per_liter: "円/ℓ",
  yen_per_km: "円/km",
};

/**
 * 画面に出す値 ⇄ 保存する値の変換。率だけ % で見せる。
 * 0.1748 を「0.1748」と入力させると、17.48 と打ち間違えた事故に気づけない
 * (17.48 も 0〜1 の外なのでAPI側でも弾くが、そもそも % で入力させる方が自然)。
 */
function toDisplay(kind: RateValueKind, value: number): string {
  return kind === "rate" ? String(Number((value * 100).toFixed(4))) : String(value);
}

function fromDisplay(kind: RateValueKind, text: string): number {
  const n = Number(text);
  if (!Number.isFinite(n)) return Number.NaN;
  return kind === "rate" ? n / 100 : n;
}

type Scope = "common" | "monthly";

type SaveState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "done"; message: string }
  | { status: "error"; message: string };

function findEntry(
  entries: RateMasterEntry[],
  key: string,
  scope: Scope,
  yearMonth: string,
): RateMasterEntry | undefined {
  return entries.find(
    (e) => e.key === key && (scope === "common" ? e.yearMonth === null : e.yearMonth === yearMonth),
  );
}

export function RateSettingsManager({
  yearMonth,
  initialEntries,
  resolved,
}: {
  yearMonth: string;
  initialEntries: RateMasterEntry[];
  /** その月に実際に適用される値。行が無いキーは既定値が入っている */
  resolved: Record<string, number>;
}) {
  const [entries, setEntries] = useState(initialEntries);
  const [editing, setEditing] = useState<{ key: string; scope: Scope } | null>(null);
  const [draft, setDraft] = useState("");
  const [saveState, setSaveState] = useState<SaveState>({ status: "idle" });

  function startEdit(def: RateMasterKeyDef, scope: Scope) {
    const entry = findEntry(entries, def.key, scope, yearMonth);
    const current = entry?.value ?? resolved[camelKey(def.key)] ?? 0;
    setEditing({ key: def.key, scope });
    setDraft(toDisplay(def.kind, current));
    setSaveState({ status: "idle" });
  }

  async function handleSave(def: RateMasterKeyDef, scope: Scope) {
    const value = fromDisplay(def.kind, draft.trim());
    const validation = validateRateValue(def, value);
    if (!validation.ok) {
      setSaveState({ status: "error", message: validation.error });
      return;
    }

    setSaveState({ status: "saving" });
    try {
      const res = await fetch("/api/rate-master", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          key: def.key,
          yearMonth: scope === "common" ? null : yearMonth,
          value,
          // 保存しただけで表を作り直さないと、画面の率と表の数字が食い違ったまま残る
          recalculateYearMonth: yearMonth,
        }),
      });
      const data = (await res.json().catch(() => null)) as {
        error?: string;
        recalculated?: { vehicleCount: number } | null;
      } | null;
      if (!res.ok) {
        setSaveState({ status: "error", message: data?.error ?? "保存に失敗しました" });
        return;
      }

      setEntries((prev) => [
        ...prev.filter(
          (e) => !(e.key === def.key && e.yearMonth === (scope === "common" ? null : yearMonth)),
        ),
        {
          key: def.key,
          yearMonth: scope === "common" ? null : yearMonth,
          value,
          updatedAt: Date.now(),
          updatedBy: null,
        },
      ]);
      setEditing(null);
      setSaveState({
        status: "done",
        message: data?.recalculated
          ? `保存しました。${yearMonth}の収支表 ${data.recalculated.vehicleCount}台を再計算しました`
          : "保存しました",
      });
    } catch {
      setSaveState({ status: "error", message: "通信エラーが発生しました" });
    }
  }

  return (
    <div className="space-y-4">
      {saveState.status === "done" && (
        <p className="rounded-lg border border-line bg-subtle px-4 py-2 text-xs text-ink">
          {saveState.message}
        </p>
      )}

      <div className="overflow-x-auto rounded-xl border border-line bg-white">
        <table className="w-full min-w-max border-collapse text-xs">
          <thead>
            <tr className="border-b border-line bg-subtle text-ink-muted">
              <th className="px-3 py-2 text-left font-medium">項目</th>
              <th className="px-3 py-2 text-right font-medium">{yearMonth}の適用値</th>
              <th className="px-3 py-2 text-left font-medium">全期間共通</th>
              <th className="px-3 py-2 text-left font-medium">{yearMonth}のみ</th>
            </tr>
          </thead>
          <tbody>
            {RATE_MASTER_CATALOG.map((def) => {
              const common = findEntry(entries, def.key, "common", yearMonth);
              const monthly = findEntry(entries, def.key, "monthly", yearMonth);
              const applied = monthly?.value ?? common?.value ?? resolved[camelKey(def.key)];
              return (
                <tr key={def.key} className="border-b border-line align-top last:border-0">
                  <td className="px-3 py-2">
                    <p className="font-semibold text-ink">{def.label}</p>
                    <p className="mt-0.5 text-[11px] text-ink-muted">{def.description}</p>
                    <p className="mt-0.5 font-mono text-[10px] text-ink-muted">{def.key}</p>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    <span className="font-mono text-sm font-bold text-ink">
                      {applied === undefined ? "—" : toDisplay(def.kind, applied)}
                    </span>
                    <span className="ml-0.5 text-[11px] text-ink-muted">{KIND_UNIT[def.kind]}</span>
                    <p className="mt-0.5 text-[10px] text-ink-muted">
                      {monthly ? "月別値" : common ? "全期間共通値" : "未設定(既定値)"}
                    </p>
                  </td>
                  {(["common", "monthly"] as const).map((scope) => (
                    <td key={scope} className="px-3 py-2">
                      <ScopeCell
                        def={def}
                        scope={scope}
                        entry={scope === "common" ? common : monthly}
                        isEditing={editing?.key === def.key && editing.scope === scope}
                        draft={draft}
                        saveState={saveState}
                        onDraftChange={setDraft}
                        onStart={() => startEdit(def, scope)}
                        onCancel={() => setEditing(null)}
                        onSave={() => handleSave(def, scope)}
                      />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-ink-muted">
        月別値があれば全期間共通値より優先されます。「未設定(既定値)」はコード側の保険値で動いている状態で、
        既定値を変えると黙って挙動が変わります。運用で使う値は明示的に設定してください。
      </p>
    </div>
  );
}

function ScopeCell({
  def,
  scope,
  entry,
  isEditing,
  draft,
  saveState,
  onDraftChange,
  onStart,
  onCancel,
  onSave,
}: {
  def: RateMasterKeyDef;
  scope: Scope;
  entry: RateMasterEntry | undefined;
  isEditing: boolean;
  draft: string;
  saveState: SaveState;
  onDraftChange: (v: string) => void;
  onStart: () => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  if (!isEditing) {
    return (
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-xs text-ink">
          {entry ? `${toDisplay(def.kind, entry.value)}${KIND_UNIT[def.kind]}` : "—"}
        </span>
        <button
          type="button"
          onClick={onStart}
          className="text-[11px] font-medium text-brand-deep underline underline-offset-2"
        >
          {entry ? "変更" : "設定"}
        </button>
        {def.scope === scope && !entry && (
          <span className="text-[10px] text-ink-muted">推奨</span>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1">
        <input
          type="number"
          step="any"
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          className="w-24 rounded border border-line px-2 py-1 text-right font-mono text-xs"
        />
        <span className="text-[11px] text-ink-muted">{KIND_UNIT[def.kind]}</span>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onSave}
          disabled={saveState.status === "saving"}
          className="rounded bg-brand-deep px-2 py-1 text-[11px] font-medium text-white disabled:opacity-50"
        >
          {saveState.status === "saving" ? "保存中…" : "保存して再計算"}
        </button>
        <button type="button" onClick={onCancel} className="text-[11px] text-ink-muted">
          取消
        </button>
      </div>
      {saveState.status === "error" && (
        <p className="text-[11px] text-danger">{saveState.message}</p>
      )}
    </div>
  );
}

/** rate_master のキー(snake_case) → 解決値オブジェクトのプロパティ名 */
function camelKey(key: string): string {
  const MAP: Record<string, string> = {
    admin_fee_rate: "adminFeeRate",
    toll_discount_rate: "tollDiscountRate",
    bonus_annual: "bonusAnnual",
    tank_price: "tankPricePerLiter",
    deficit_idle_sales: "idleSales",
    deficit_repair_spike: "repairSpike",
    break_even_km_price: "breakEvenKmPrice",
  };
  return MAP[key] ?? key;
}
