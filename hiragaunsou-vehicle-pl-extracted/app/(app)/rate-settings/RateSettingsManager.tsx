"use client";

import { useMemo, useState } from "react";
import {
  RATE_MASTER_CATALOG,
  type RateMasterKeyDef,
  type RateValueKind,
} from "../../../src/domain/rules/rateMasterCatalog";
import type { RateMasterEntry } from "../../../src/infrastructure/db/D1MasterRepository";
import { Disclosure } from "../../_components/Disclosure";
import { parseAmountInput } from "../../_lib/numberEntry";
import { StagePanel } from "../../_components/StagePanel";
import {
  EditableRowCells,
  EditFormActionBar,
  saveRateChanges,
  useEditableRecords,
  type EditableFieldDef,
} from "../../_components/editForm";

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
  resolved: initialResolved,
}: {
  yearMonth: string;
  initialEntries: RateMasterEntry[];
  /** その月に実際に適用される値。行が無いキーは既定値が入っている */
  resolved: Record<string, number>;
}) {
  const [entries, setEntries] = useState(initialEntries);
  const [resolved, setResolved] = useState(initialResolved);

  /**
   * 直せる項目の宣言。1行 = 1つの率で、直せる欄は「全期間共通」と「この月のみ」の2つ。
   * 入力欄・変更の色分け・未保存件数・まとめて保存・離れるときの確認は
   * 共通の土台 (app/_components/editForm) が受け持つ。
   */
  const rateFields = useMemo<EditableFieldDef<RateMasterKeyDef>[]>(
    () => [
      {
        field: "common",
        label: "全期間共通",
        // 同じ列に % と 円 と 円/ℓ が混ざるので、行ごとに種類を返す。
        // 金額だけ桁区切りで読み合わせ、率・単価は桁区切りをしない。
        kind: (def) => (def.kind === "yen" ? "yen" : "number"),
        unit: (def) => KIND_UNIT[def.kind],
        widthClass: "w-24",
        emptyText: "未設定",
        read: (def) => {
          const e = findEntry(entries, def.key, "common", yearMonth);
          return e ? toDisplay(def.kind, e.value) : null;
        },
      },
      {
        field: "monthly",
        label: `${yearMonth}のみ`,
        kind: (def) => (def.kind === "yen" ? "yen" : "number"),
        unit: (def) => KIND_UNIT[def.kind],
        widthClass: "w-24",
        emptyText: "未設定",
        read: (def) => {
          const e = findEntry(entries, def.key, "monthly", yearMonth);
          return e ? toDisplay(def.kind, e.value) : null;
        },
      },
    ],
    [entries, yearMonth],
  );

  async function reloadEntries() {
    const res = await fetch(`/api/rate-master?ym=${yearMonth}`);
    const data = (await res.json().catch(() => null)) as {
      entries?: RateMasterEntry[];
      resolved?: Record<string, number>;
    } | null;
    if (res.ok && data?.entries) {
      setEntries(data.entries);
      if (data.resolved) setResolved(data.resolved);
    }
  }

  const form = useEditableRecords<RateMasterKeyDef>({
    records: RATE_MASTER_CATALOG,
    rowKey: (def) => def.key,
    fields: rateFields,
    submit: async (changes) => {
      const result = await saveRateChanges(yearMonth, (def, display) =>
        fromDisplay(def.kind, display),
      )(changes);
      if (!result.error) await reloadEntries();
      return result;
    },
  });

  /** いま直している欄の名前。折りたたみの中を直しても気づけるように帯へ出す。 */
  const changedLabels = form.changes.map((c) => `${c.record.label}の${c.def.label}`);

  function renderTable(definitions: readonly RateMasterKeyDef[], ariaLabel: string) {
    return (
      <div className="overflow-x-auto card">
        <table
          aria-label={ariaLabel}
          className="data-table w-full min-w-max border-collapse text-xs"
        >
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
                    <p className="mt-0.5 text-[10px] text-ink-muted">{KIND_UNIT[def.kind]}で入力</p>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    <span className="font-mono text-sm font-bold text-ink">
                      {applied === undefined ? "—" : toDisplay(def.kind, applied)}
                    </span>
                    <span className="ml-0.5 text-[11px] text-ink-muted">{KIND_UNIT[def.kind]}</span>
                    <p className="mt-0.5 text-[10px] text-ink-muted">
                      {monthly ? "月別値" : common ? "全期間共通値" : "未設定(既定値)"}
                    </p>
                    {/*
                      どちらの欄を直しているのかを取り違えると、直したのに数字が動かない。
                      月別値がある行では「共通を直してもこの月は変わらない」ことをその場に書く。
                    */}
                    {monthly ? (
                      <p className="mt-0.5 text-[10px] leading-tight text-ink-muted">
                        全期間共通を直しても
                        <br />
                        この月は変わりません
                      </p>
                    ) : null}
                  </td>
                  <EditableRowCells
                    record={def}
                    rowKey={def.key}
                    fields={rateFields}
                    draft={form.draftOf(def.key)}
                    onChange={form.setField}
                    fieldErrorOf={form.fieldErrorOf}
                    rowLabel={def.label}
                    cellClassName="px-3 py-2"
                  />
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
      <p className="text-xs leading-relaxed text-ink-muted">
        直したい率を打ち替えて、画面の下の「保存する」を押してください。打ち替えた欄には「変更」の札と
        元の値が出ます。保存すると{yearMonth}の収支表も作り直します(締めた月はそのままです)。
      </p>

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

      {/* 保存の入口・未保存件数・離れるときの確認は共通の帯に任せる */}
      <EditFormActionBar
        form={form}
        saveLabel="率を保存して収支表を作り直す"
        notice={
          changedLabels.length > 0 ? (
            <p className="text-xs text-ink-muted">直している欄: {changedLabels.join("、")}</p>
          ) : null
        }
      />

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
