"use client";

import { useState } from "react";
import {
  RATE_MASTER_CATALOG,
  validateRateValue,
  type RateMasterKeyDef,
  type RateValueKind,
} from "../../../src/domain/rules/rateMasterCatalog";
import type { RateMasterEntry } from "../../../src/infrastructure/db/D1MasterRepository";
import { Disclosure } from "../../_components/Disclosure";
import { NumberEntryField } from "../../_components/NumberEntryField";
import { parseAmountInput } from "../../_lib/numberEntry";
import { StagePanel } from "../../_components/StagePanel";

const KIND_UNIT: Record<RateValueKind, string> = {
  rate: "%",
  yen: "円",
  yen_per_liter: "円/ℓ",
  yen_per_km: "円/km",
};

/**
 * 月別値が標準の項目は、月次の締め作業で確認・変更する可能性が高い。
 * 全期間共通が標準の項目は、年度・規程・判定基準を見直すときだけ触る。
 * 新しい率を追加したときも catalog の scope だけで正しい場所へ出るようにする。
 */
const FREQUENTLY_CHANGED = RATE_MASTER_CATALOG.filter((def) => def.scope === "monthly");
const RARELY_CHANGED = RATE_MASTER_CATALOG.filter((def) => def.scope === "common");

/**
 * 画面に出す値 ⇄ 保存する値の変換。率だけ % で見せる。
 * 0.1748 を「0.1748」と入力させると、17.48 と打ち間違えた事故に気づけない
 * (17.48 も 0〜1 の外なのでAPI側でも弾くが、そもそも % で入力させる方が自然)。
 */
function toDisplay(kind: RateValueKind, value: number): string {
  return kind === "rate" ? String(Number((value * 100).toFixed(4))) : String(value);
}

function fromDisplay(kind: RateValueKind, text: string): number {
  // 読み取り規則は全画面共通 (全角数字・カンマも受ける)。読めなければ NaN のまま検証で弾く。
  const n = parseAmountInput(text);
  if (n === null) return Number.NaN;
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

  function renderTable(definitions: readonly RateMasterKeyDef[], ariaLabel: string) {
    return (
      <div className="overflow-x-auto rounded-xl border border-line bg-white">
        <table aria-label={ariaLabel} className="w-full min-w-max border-collapse text-xs">
          <thead>
            <tr className="border-b border-line bg-subtle text-ink-muted">
              <th className="px-3 py-2 text-left font-medium">項目</th>
              <th className="px-3 py-2 text-right font-medium">{yearMonth}の適用値</th>
              <th className="px-3 py-2 text-left font-medium">全期間共通</th>
              <th className="px-3 py-2 text-left font-medium">{yearMonth}のみ</th>
            </tr>
          </thead>
          <tbody>
            {definitions.map((def) => {
              const common = findEntry(entries, def.key, "common", yearMonth);
              const monthly = findEntry(entries, def.key, "monthly", yearMonth);
              const applied = monthly?.value ?? common?.value ?? resolved[camelKey(def.key)];
              return (
                <tr key={def.key} className="border-b border-line align-top last:border-0">
                  {/*
                    項目の説明とキー名は、率を1つ直すたびに読むものではない。
                    表に常時並べず、下の説明用折りたたみに全文を残す。
                  */}
                  <td className="px-3 py-2">
                    <p className="font-semibold text-ink">{def.label}</p>
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
    );
  }

  return (
    <div className="space-y-4">
      {saveState.status === "done" && (
        <p className="rounded-lg border border-line bg-subtle px-4 py-2 text-xs text-ink">
          {saveState.message}
        </p>
      )}

      <section aria-labelledby="frequently-changed-rates" className="space-y-2">
        <div>
          <h2 id="frequently-changed-rates" className="text-sm font-bold text-ink">
            よく変える項目
          </h2>
          <p className="mt-0.5 text-xs text-ink-muted">
            月ごとの単価・受取額です。締め作業のときに確認します。
          </p>
        </div>
        {renderTable(FREQUENTLY_CHANGED, "よく変える項目")}
      </section>

      <StagePanel
        title="めったに変えない項目"
        summary={`${RARELY_CHANGED.length}項目`}
        openLabel="めったに変えない項目を開く"
        closeLabel="めったに変えない項目を閉じる"
      >
        <p className="mb-3 text-xs text-ink-muted">
          年度・規程・赤字判定の基準を見直すときだけ変更します。
        </p>
        {renderTable(RARELY_CHANGED, "めったに変えない項目")}
      </StagePanel>

      <Disclosure summary="各項目の意味と、月別値・共通値の使い分けを見る">
        <p>
          月別値があれば全期間共通値より優先されます。「未設定(既定値)」はコード側の保険値で動いている状態で、
          既定値を変えると黙って挙動が変わります。運用で使う値は明示的に設定してください。
        </p>
        <dl className="mt-3 space-y-2">
          {RATE_MASTER_CATALOG.map((def) => (
            <div key={def.key}>
              <dt className="font-semibold text-ink">{def.label}</dt>
              <dd className="mt-0.5">
                {def.description}
                <span className="ml-1.5 font-mono text-[10px]">{def.key}</span>
              </dd>
            </div>
          ))}
        </dl>
      </Disclosure>
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
        {/*
          他の画面と同じ入力欄を使う。編集を始めた時点でいまの値が入っているので
          自動値の印は要らないが、読み取り規則 (全角数字・カンマ) とEnterでの移動は揃う。
        */}
        <NumberEntryField
          value={draft}
          onChange={onDraftChange}
          ariaLabel={`${def.label}の${scope === "common" ? "全期間共通値" : "月別値"}(${KIND_UNIT[def.kind]})`}
          widthClass="w-24"
          showEcho={false}
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
