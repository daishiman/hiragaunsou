"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { CleansingQueueItem } from "../../../src/usecase/steps/getCleansingQueue";
import {
  DECISION_LABELS,
  FLAG_LABELS,
  type CleansingDecisionType,
  type CleansingFlagType,
} from "../../../src/domain/rules/cleansingRules";
import { yen } from "../../_lib/format";
import { withYm } from "../../_lib/withYm";
import { ListToolbar, type SortOption } from "../../_components/ListToolbar";
import { EmptyState } from "../../_components/EmptyState";

type SortKey = "default" | "loadDateDesc" | "vehicleNoAsc";

const SORT_OPTIONS: SortOption[] = [
  { value: "default", label: "未判断・金額が大きい順(既定)" },
  { value: "loadDateDesc", label: "積荷日が新しい順" },
  { value: "vehicleNoAsc", label: "車番順" },
];

/** 絞り込みチップに出す対象 (傭車は自動除外済みで一覧に出ないため対象外) */
const FILTERABLE_FLAG_TYPES: readonly CleansingFlagType[] = ["duplicate_suspect", "misc_entry"];

const DECISION_ORDER: readonly CleansingDecisionType[] = ["delete", "correct", "keep"];

const DECISION_HINT: Record<CleansingDecisionType, string> = {
  delete: "この伝票を収支計算から外します",
  correct: "正しい車番へ付け替えて残します",
  keep: "問題なしとしてこのまま残します",
};

const DECISION_STYLE: Record<CleansingDecisionType, string> = {
  delete: "border-danger text-danger",
  correct: "border-accent text-accent-deep",
  keep: "border-brand text-brand-deep",
};

interface LocalState {
  decision: CleansingDecisionType | null;
  correctedVehicleNo: string;
  note: string;
}

/**
 * 業務フロー STEP2「データ整形」の判断キュー。
 *
 * 属人的な判断そのものは無くせないので、人の負荷を「判断」だけに絞る:
 *   - 何千行の売上明細ではなく、フラグが立った行だけを出す
 *   - なぜフラグが立ったかを文章でその場に出す(別画面を見に行かせない)
 *   - 前月に同じ伝票へ下した判断を提案として出し、同意なら1クリックで済ませる
 *   - 判断はすぐ保存し、押し間違えたら別の判断を押すだけで上書きできる(確認ダイアログを出さない)
 */
export function CleansingQueue({
  yearMonth,
  initialItems,
  charteredExcluded,
  totalRows,
  notImported,
  canDecide,
}: {
  yearMonth: string;
  initialItems: CleansingQueueItem[];
  charteredExcluded: number;
  totalRows: number;
  notImported: boolean;
  canDecide: boolean;
}) {
  const [state, setState] = useState<Record<string, LocalState>>(() =>
    Object.fromEntries(
      initialItems.map((i) => [
        i.rowKey,
        {
          decision: i.decision,
          correctedVehicleNo: i.correctedVehicleNo ?? "",
          note: i.note ?? "",
        },
      ]),
    ),
  );
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDecided, setShowDecided] = useState(true);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("default");
  const [activeFlagFilters, setActiveFlagFilters] = useState<Set<CleansingFlagType>>(new Set());

  function toggleFlagFilter(key: string) {
    setActiveFlagFilters((prev) => {
      const next = new Set(prev);
      if (next.has(key as CleansingFlagType)) next.delete(key as CleansingFlagType);
      else next.add(key as CleansingFlagType);
      return next;
    });
  }

  const pendingCount = useMemo(
    () => initialItems.filter((i) => state[i.rowKey]?.decision == null).length,
    [initialItems, state],
  );

  const suggestable = useMemo(
    () => initialItems.filter((i) => i.suggestion && state[i.rowKey]?.decision == null),
    [initialItems, state],
  );

  async function save(items: { item: CleansingQueueItem; next: LocalState }[]) {
    const res = await fetch("/api/cleansing", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        yearMonth,
        decisions: items.map(({ item, next }) => ({
          rowKey: item.rowKey,
          vehicleNo: item.vehicleNo,
          driverName: item.driverName,
          flagTypes: item.flags.map((f) => f.type),
          decision: next.decision,
          correctedVehicleNo: next.correctedVehicleNo,
          note: next.note,
        })),
      }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? `保存できませんでした (HTTP ${res.status})`);
    }
  }

  async function decide(item: CleansingQueueItem, decision: CleansingDecisionType) {
    const prev = state[item.rowKey] ?? { decision: null, correctedVehicleNo: "", note: "" };
    const next: LocalState = { ...prev, decision };
    setState((s) => ({ ...s, [item.rowKey]: next }));
    setPending(item.rowKey);
    setError(null);
    try {
      await save([{ item, next }]);
    } catch (e) {
      setState((s) => ({ ...s, [item.rowKey]: prev }));
      setError(e instanceof Error ? e.message : "保存できませんでした");
    } finally {
      setPending(null);
    }
  }

  async function applyAllSuggestions() {
    if (suggestable.length === 0) return;
    const updates = suggestable.map((item) => {
      const prev = state[item.rowKey] ?? { decision: null, correctedVehicleNo: "", note: "" };
      return { item, next: { ...prev, decision: item.suggestion!.decision } };
    });
    setState((s) => {
      const copy = { ...s };
      for (const u of updates) copy[u.item.rowKey] = u.next;
      return copy;
    });
    setPending("__bulk__");
    setError(null);
    try {
      await save(updates);
    } catch (e) {
      setError(e instanceof Error ? e.message : "まとめて保存できませんでした");
    } finally {
      setPending(null);
    }
  }

  /** 車番の付け替え・メモは打ち終わってから保存する (入力のたびに投げない) */
  async function saveDetail(item: CleansingQueueItem) {
    const next = state[item.rowKey];
    if (!next?.decision) return;
    setPending(item.rowKey);
    setError(null);
    try {
      await save([{ item, next }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存できませんでした");
    } finally {
      setPending(null);
    }
  }

  /** 「同じ内容の伝票」グループに対して、1回の判断をまとめて適用する */
  async function decideGroup(items: CleansingQueueItem[], decision: CleansingDecisionType) {
    const groupKey = items.map((i) => i.rowKey).join(",");
    const updates = items.map((item) => {
      const prev = state[item.rowKey] ?? { decision: null, correctedVehicleNo: "", note: "" };
      return { item, next: { ...prev, decision } };
    });
    setState((s) => {
      const copy = { ...s };
      for (const u of updates) copy[u.item.rowKey] = u.next;
      return copy;
    });
    setPending(groupKey);
    setError(null);
    try {
      await save(updates);
    } catch (e) {
      setError(e instanceof Error ? e.message : "まとめて保存できませんでした");
    } finally {
      setPending(null);
    }
  }

  /** グループ内共通の「正しい車番」「メモ」を全行へ反映してから保存する */
  function updateGroupField(items: CleansingQueueItem[], field: "correctedVehicleNo" | "note", value: string) {
    setState((s) => {
      const copy = { ...s };
      for (const item of items) {
        const prev = copy[item.rowKey] ?? { decision: null, correctedVehicleNo: "", note: "" };
        copy[item.rowKey] = { ...prev, [field]: value };
      }
      return copy;
    });
  }

  async function saveGroupDetail(items: CleansingQueueItem[]) {
    const updates = items
      .filter((item) => state[item.rowKey]?.decision)
      .map((item) => ({ item, next: state[item.rowKey]! }));
    if (updates.length === 0) return;
    const groupKey = items.map((i) => i.rowKey).join(",");
    setPending(groupKey);
    setError(null);
    try {
      await save(updates);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存できませんでした");
    } finally {
      setPending(null);
    }
  }

  if (notImported) {
    return (
      <EmptyState
        title="売上モニタリストが未取込です"
        description="取り込むと、確認が必要な伝票をここに出します。"
        actionHref={`/import?ym=${yearMonth}`}
      />
    );
  }

  const searchQuery = search.trim();
  let visible = showDecided
    ? initialItems
    : initialItems.filter((i) => state[i.rowKey]?.decision == null);
  if (searchQuery) {
    visible = visible.filter(
      (i) =>
        i.vehicleNo.includes(searchQuery) ||
        i.driverName.includes(searchQuery) ||
        i.customerName.includes(searchQuery),
    );
  }
  if (activeFlagFilters.size > 0) {
    visible = visible.filter((i) => i.flags.some((f) => activeFlagFilters.has(f.type)));
  }
  if (sortKey === "loadDateDesc") {
    visible = [...visible].sort((a, b) => b.loadDate.localeCompare(a.loadDate));
  } else if (sortKey === "vehicleNoAsc") {
    visible = [...visible].sort((a, b) => a.vehicleNo.localeCompare(b.vehicleNo, "ja", { numeric: true }));
  }
  // sortKey === "default" のときは initialItems の並び(未判断優先・金額降順)をそのまま使う

  // clusterKey が同じ(=同じ内容とみなせる)行は2件以上まとまったときだけグループ化する。
  // 1件しかない clusterKey や空文字列("束ねない"の意味)は、今まで通り単独カードで出す。
  const clusters = new Map<string, CleansingQueueItem[]>();
  for (const item of visible) {
    if (!item.clusterKey) continue;
    const members = clusters.get(item.clusterKey) ?? [];
    members.push(item);
    clusters.set(item.clusterKey, members);
  }
  const renderedRowKeys = new Set<string>();
  const groups: ({ kind: "single"; item: CleansingQueueItem } | { kind: "cluster"; items: CleansingQueueItem[] })[] =
    [];
  for (const item of visible) {
    if (renderedRowKeys.has(item.rowKey)) continue;
    const members = item.clusterKey ? clusters.get(item.clusterKey) : undefined;
    if (members && members.length >= 2) {
      for (const m of members) renderedRowKeys.add(m.rowKey);
      groups.push({ kind: "cluster", items: members });
    } else {
      renderedRowKeys.add(item.rowKey);
      groups.push({ kind: "single", item });
    }
  }

  function renderItemCard(item: CleansingQueueItem, compact: boolean) {
    const local = state[item.rowKey] ?? { decision: null, correctedVehicleNo: "", note: "" };
    return (
      <div
        key={item.rowKey}
        className={`rounded-lg border bg-white p-4 ${compact ? "" : local.decision ? "border-line opacity-80" : "border-accent/40"}`}
      >
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="text-base font-bold text-ink">車番 {item.vehicleNo || "—"}</span>
          <span className="text-sm text-ink-muted">運転者 {item.driverName || "—"}</span>
          <span className="text-sm text-ink-muted">荷主 {item.customerName || "—"}</span>
          <span className="text-sm text-ink-muted">積荷日 {item.loadDate || "—"}</span>
          <span className="num ml-auto text-sm font-semibold text-ink">{yen(item.amount)} 円</span>
        </div>

        <ul className="mt-3 flex flex-col gap-1">
          {item.flags.map((flag) => (
            <li key={flag.type} className="text-sm text-ink">
              <span className="mr-2 inline-block rounded bg-accent/10 px-2 py-0.5 text-[11px] font-semibold text-accent-deep">
                {FLAG_LABELS[flag.type]}
              </span>
              {flag.reason}
            </li>
          ))}
        </ul>

        {item.suggestion && (
          <p className="mt-2 text-sm text-brand-deep">前月の判断: {item.suggestion.reason}</p>
        )}

        {canDecide ? (
          <>
            <div className="mt-3 flex flex-wrap gap-2">
              {DECISION_ORDER.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => decide(item, d)}
                  disabled={pending !== null}
                  aria-pressed={local.decision === d}
                  title={DECISION_HINT[d]}
                  className={`pressable rounded border px-3 py-1.5 text-sm font-semibold disabled:opacity-50 ${
                    local.decision === d ? `${DECISION_STYLE[d]} bg-subtle` : "border-line text-ink-muted"
                  }`}
                >
                  {DECISION_LABELS[d]}
                </button>
              ))}
              {local.decision && (
                <span className="self-center text-sm text-ink-muted">{DECISION_HINT[local.decision]}</span>
              )}
            </div>

            {local.decision === "correct" && (
              <div className="mt-3 flex flex-wrap items-end gap-3">
                <label className="flex flex-col text-sm text-ink-muted">
                  正しい車番
                  <input
                    type="text"
                    inputMode="numeric"
                    value={local.correctedVehicleNo}
                    onChange={(e) =>
                      setState((s) => ({
                        ...s,
                        [item.rowKey]: { ...local, correctedVehicleNo: e.target.value },
                      }))
                    }
                    onBlur={() => saveDetail(item)}
                    placeholder="例: 24"
                    className="num mt-1 w-32 rounded border border-line px-2 py-1 text-right text-ink"
                  />
                </label>
                <label className="flex min-w-60 flex-1 flex-col text-sm text-ink-muted">
                  メモ(任意)
                  <input
                    type="text"
                    value={local.note}
                    onChange={(e) =>
                      setState((s) => ({ ...s, [item.rowKey]: { ...local, note: e.target.value } }))
                    }
                    onBlur={() => saveDetail(item)}
                    placeholder="請求書発行担当に確認済み など"
                    className="mt-1 rounded border border-line px-2 py-1 text-ink"
                  />
                </label>
              </div>
            )}
          </>
        ) : (
          <p className="mt-3 text-sm text-ink-muted">
            判断の権限がありません。
            {local.decision ? `現在の判断: ${DECISION_LABELS[local.decision]}` : "未判断です。"}
          </p>
        )}
      </div>
    );
  }

  function renderClusterCard(items: CleansingQueueItem[]) {
    const groupKey = items.map((i) => i.rowKey).join(",");
    const first = items[0]!;
    const decisions = items.map((i) => state[i.rowKey]?.decision ?? null);
    const groupDecision = decisions.every((d) => d === decisions[0]) ? decisions[0] : null;
    const groupLocal = state[first.rowKey] ?? { decision: null, correctedVehicleNo: "", note: "" };
    const isGroupPending = pending === groupKey;

    return (
      <div
        key={groupKey}
        className={`rounded-lg border bg-white p-4 ${groupDecision ? "border-line opacity-80" : "border-accent/40"}`}
      >
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="text-base font-bold text-ink">車番 {first.vehicleNo || "—"}</span>
          <span className="text-sm text-ink-muted">運転者 {first.driverName || "—"}</span>
          <span className="text-sm text-ink-muted">荷主 {first.customerName || "—"}</span>
          <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-semibold text-accent-deep">
            同じ内容の伝票が{items.length}件
          </span>
          <span className="num ml-auto text-sm font-semibold text-ink">
            {yen(items.reduce((sum, i) => sum + i.amount, 0))} 円(合計)
          </span>
        </div>

        <ul className="mt-3 flex flex-col gap-1">
          {first.flags.map((flag) => (
            <li key={flag.type} className="text-sm text-ink">
              <span className="mr-2 inline-block rounded bg-accent/10 px-2 py-0.5 text-[11px] font-semibold text-accent-deep">
                {FLAG_LABELS[flag.type]}
              </span>
              {flag.reason}
            </li>
          ))}
        </ul>

        {canDecide ? (
          <>
            <div className="mt-3 flex flex-wrap gap-2">
              {DECISION_ORDER.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => decideGroup(items, d)}
                  disabled={pending !== null}
                  aria-pressed={groupDecision === d}
                  title={`${items.length}件すべてに適用: ${DECISION_HINT[d]}`}
                  className={`pressable rounded border px-3 py-1.5 text-sm font-semibold disabled:opacity-50 ${
                    groupDecision === d ? `${DECISION_STYLE[d]} bg-subtle` : "border-line text-ink-muted"
                  }`}
                >
                  {DECISION_LABELS[d]}({items.length}件)
                </button>
              ))}
              {isGroupPending && <span className="self-center text-sm text-ink-muted">保存しています…</span>}
            </div>

            {groupDecision === "correct" && (
              <div className="mt-3 flex flex-wrap items-end gap-3">
                <label className="flex flex-col text-sm text-ink-muted">
                  正しい車番(全{items.length}件に反映)
                  <input
                    type="text"
                    inputMode="numeric"
                    value={groupLocal.correctedVehicleNo}
                    onChange={(e) => updateGroupField(items, "correctedVehicleNo", e.target.value)}
                    onBlur={() => saveGroupDetail(items)}
                    placeholder="例: 24"
                    className="num mt-1 w-32 rounded border border-line px-2 py-1 text-right text-ink"
                  />
                </label>
                <label className="flex min-w-60 flex-1 flex-col text-sm text-ink-muted">
                  メモ(任意)
                  <input
                    type="text"
                    value={groupLocal.note}
                    onChange={(e) => updateGroupField(items, "note", e.target.value)}
                    onBlur={() => saveGroupDetail(items)}
                    placeholder="請求書発行担当に確認済み など"
                    className="mt-1 rounded border border-line px-2 py-1 text-ink"
                  />
                </label>
              </div>
            )}
          </>
        ) : (
          <p className="mt-3 text-sm text-ink-muted">判断の権限がありません。</p>
        )}

        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-semibold text-ink-muted">
            1件ずつ確認する(まとめた判断と違う対応が必要な伝票があれば、ここで個別に変更できます)
          </summary>
          <div className="mt-3 flex flex-col gap-3 border-t border-line pt-3">
            {items.map((item) => renderItemCard(item, true))}
          </div>
        </details>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/*
        この画面の主役は「あと何件判断すればいいか」の1数字。
        取込件数・傭車除外件数は判断に使わない背景情報なので、小さく脇に置く。
      */}
      <div className="rounded-lg border border-line bg-white p-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs text-ink-muted">未判断</p>
            <p
              className={`num text-4xl font-bold ${pendingCount > 0 ? "text-ink" : "text-ink-muted"}`}
            >
              {pendingCount}
              <span className="ml-0.5 text-base font-semibold text-ink-muted">
                / {initialItems.length}件
              </span>
            </p>
          </div>
          <p className="num text-xs text-ink-muted">
            取込 {totalRows}件 ・ 傭車除外 {charteredExcluded}件
          </p>
        </div>

        {pendingCount === 0 && (
          <p className="mt-3 flex flex-wrap items-center gap-3 rounded bg-brand-soft px-3 py-2 text-sm font-semibold text-brand-deep">
            <span>✓ すべて判断済み</span>
            <Link
              href={withYm("/manual-entry?step=2", yearMonth)}
              className="underline underline-offset-2"
            >
              次のステップへ進む
            </Link>
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-3">
          {canDecide && suggestable.length > 0 && (
            <button
              type="button"
              onClick={applyAllSuggestions}
              disabled={pending !== null}
              className="btn btn-secondary pressable"
            >
              前月と同じ判断をまとめて適用({suggestable.length}件)
            </button>
          )}
          <label className="flex items-center gap-2 text-sm text-ink-muted">
            <input
              type="checkbox"
              checked={showDecided}
              onChange={(e) => setShowDecided(e.target.checked)}
            />
            判断済みも表示する
          </label>
        </div>
      </div>

      <ListToolbar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="車番・運転者・荷主で検索"
        sortOptions={SORT_OPTIONS}
        sortValue={sortKey}
        onSortChange={(v) => setSortKey(v as SortKey)}
        filterChips={FILTERABLE_FLAG_TYPES.map((type) => ({
          key: type,
          label: FLAG_LABELS[type],
          active: activeFlagFilters.has(type),
        }))}
        onToggleFilter={toggleFlagFilter}
      />

      {error && (
        <p role="alert" className="rounded border border-danger bg-danger/5 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      {visible.length === 0 && (
        <p className="rounded-lg border border-line bg-white p-6 text-sm text-ink-muted">
          表示する伝票はありません。
        </p>
      )}

      {groups.map((g) => (g.kind === "cluster" ? renderClusterCard(g.items) : renderItemCard(g.item, false)))}
    </div>
  );
}
