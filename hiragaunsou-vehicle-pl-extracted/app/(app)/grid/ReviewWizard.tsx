"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { VehiclePlField } from "../../../src/domain/entities/VehiclePl";
import type { GridRow } from "../../../src/usecase/steps/getMonthlyGrid";
import type { PlIssueAckStatus, ReviewedIssue } from "../../../src/domain/rules/plIssueAck";
import {
  EDIT_TARGET_FIELD,
  EMPTY_BENCHMARK,
  SEVERITY_MEANING,
  checkValue,
  digitFixCandidate,
  issueGuidance,
  type ValueBenchmark,
} from "../../../src/domain/rules/plIssueGuidance";
import {
  OVERRIDABLE_FIELD_META,
  isOverridableField,
  type OverridableField,
} from "../../../src/domain/rules/vehiclePlOverride";
import { SEVERITY_ORDER, type ReviewSeverity } from "../../../src/domain/rules/vehiclePlReview";
import { FIELD_LABELS, isNumericField } from "../../_lib/fieldLabels";
import { num, yearMonthLabel } from "../../_lib/format";
import { formatNumberInput, parseNumberInput, toInputText } from "../../_lib/numberInput";

const SEVERITY_LABEL: Record<ReviewSeverity, string> = {
  blocking: "要修正",
  warning: "要確認",
  info: "参考",
};

const SEVERITY_CHIP: Record<ReviewSeverity, string> = {
  blocking: "border-danger-border bg-danger-soft text-danger",
  warning: "border-caution-border bg-caution-soft text-ink",
  info: "border-brand-soft bg-brand-mist text-brand-deep",
};

/** 表に列がある項目のうち、この画面で直せるもの */
type EditableColumn = Extract<OverridableField, VehiclePlField>;

/** 単位。金額の列が大半なので、それ以外だけを列挙して既定を「円」にする。 */
const UNITS: Partial<Record<VehiclePlField, string>> = {
  trips: "回",
  slips: "件",
  hours: "時間",
  km: "km",
  fuelInQty: "L",
  fuelOutQty: "L",
  fuelQty: "L",
  nempi: "km/L",
  margin: "%",
};

/** 小数で扱う項目 (それ以外は整数で受ける) */
const DECIMAL_DIGITS: Partial<Record<VehiclePlField, number>> = {
  km: 1,
  hours: 1,
  nempi: 2,
};

function unitOf(field: string): string {
  // 直せる項目は保存側の定義と単位表記を必ず揃える (画面とAPIで呼び名が割れないように)。
  if (isOverridableField(field)) return OVERRIDABLE_FIELD_META[field].unit;
  const key = field as VehiclePlField;
  if (UNITS[key] !== undefined) return UNITS[key] as string;
  return isNumericField(key) ? "円" : "";
}

function labelOf(field: string): string {
  return FIELD_LABELS[field as VehiclePlField] ?? field;
}

function isEditableColumn(field: string): field is EditableColumn {
  return isOverridableField(field) && field in FIELD_LABELS;
}

export interface ReviewItem {
  row: GridRow;
  issue: ReviewedIssue;
}

/**
 * その指摘に対して、この確認作業で下した結論。
 * "later" (あとで見る) もサーバに保存されるので、画面を閉じても残る。
 */
type Verdict = "fixed" | "ok" | "later";

/** 入力途中の下書き (誤って閉じても消さないため localStorage に置く) */
interface Draft {
  value: string;
  reason: string;
}

/**
 * 確認の対象を「重い順・車番順」に並べる。並べ替えの選択肢は作らない(判断を増やさない)。
 *
 * @param options.onlyPostponed 「あとで見る」にした分だけを対象にする (後回しからの再開)
 */
export function buildReviewQueue(
  rows: readonly GridRow[],
  options: { onlyPostponed?: boolean } = {},
): ReviewItem[] {
  const items: ReviewItem[] = [];
  for (const row of rows) {
    for (const issue of row.issues) {
      if (issue.acknowledged) continue;
      if (options.onlyPostponed && !issue.postponed) continue;
      items.push({ row, issue });
    }
  }
  return items.sort((a, b) => {
    const bySeverity = SEVERITY_ORDER[a.issue.severity] - SEVERITY_ORDER[b.issue.severity];
    if (bySeverity !== 0) return bySeverity;
    return a.row.vehicleNo.localeCompare(b.row.vehicleNo, "ja");
  });
}

function draftStorageKey(yearMonth: string): string {
  return `hiragaunsou:grid-review:${yearMonth}:v1`;
}

function loadDrafts(yearMonth: string): Record<string, Draft> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(draftStorageKey(yearMonth));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return {};
    return parsed as Record<string, Draft>;
  } catch {
    return {};
  }
}

/**
 * 1件ずつの確認画面 (集中モード)。
 *
 * 表と同時に見せない理由は設計メモ T5 §5.1 のとおりで、106行×51列の表は
 * 仕様を知らない人にとって文脈ではなくノイズになる。必要な文脈
 * (同じ車種のふつうの値・先月の値・元になった数字) はこのカードに書き写している。
 * 画面には常に指摘が1件しか存在しないので、判断の数は構造的に1つに保たれる。
 */
export function ReviewWizard({
  yearMonth,
  items,
  canEdit,
  pendingCount,
  applying,
  vehicleCount,
  onSave,
  onAck,
  onBulkAck,
  onBulkUndo,
  onApply,
  onExit,
}: {
  yearMonth: string;
  items: readonly ReviewItem[];
  canEdit: boolean;
  pendingCount: number;
  applying: boolean;
  vehicleCount: number;
  onSave: (row: GridRow, field: EditableColumn, value: number, reason: string) => Promise<void>;
  /** status に null を渡すと判断の取り消し */
  onAck: (issue: ReviewedIssue, status: PlIssueAckStatus | null) => Promise<void>;
  onBulkAck: (issues: readonly ReviewedIssue[], reason: string) => Promise<number>;
  onBulkUndo: (issues: readonly ReviewedIssue[]) => Promise<number>;
  onApply: () => void;
  onExit: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [verdicts, setVerdicts] = useState<Record<string, Verdict>>({});
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** まとめてOKの確認画面に出している対象 (押した瞬間には実行しない) */
  const [bulkTarget, setBulkTarget] = useState<{ label: string; items: ReviewItem[] } | null>(null);
  /** 直前のまとめてOK (「元に戻す」に使う) */
  const [lastBulk, setLastBulk] = useState<{ label: string; items: ReviewItem[] } | null>(null);
  // この画面は「確認をはじめる」を押した後にしか現れないので、初期値で localStorage を読める
  // (サーバ側では描画されないため、読み込んだ値と描画結果が食い違うことがない)。
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => loadDrafts(yearMonth));
  const [restoredCount] = useState(() => Object.keys(loadDrafts(yearMonth)).length);
  const [restoreDismissed, setRestoreDismissed] = useState(false);
  // 下書きの復元は黙ってやらない (ux-design §4-1)。読み込んだことを画面に出し、破棄もできる。
  const restored = restoredCount > 0 && !restoreDismissed;

  const done = Object.values(verdicts).filter((v) => v !== "later").length;
  // 「あとで見る」は、この作業で押した分と、前回までに後回しにしてある分の両方を数える。
  // 押した分だけ数えると、後回しを1件も押さずに開き直したときに 0件 と出て見落としになる。
  const skipped = items.filter(
    (item) =>
      verdicts[item.issue.key] === "later" ||
      (verdicts[item.issue.key] === undefined && item.issue.postponed),
  );
  const remaining = items.filter((item) => verdicts[item.issue.key] === undefined);
  const finished = remaining.length === 0 || index >= items.length;
  const current = finished ? null : items[index];

  function saveDrafts(next: Record<string, Draft>) {
    setDrafts(next);
    try {
      window.localStorage.setItem(draftStorageKey(yearMonth), JSON.stringify(next));
    } catch {
      // 保存できない環境 (プライベートモード等) でも確認作業自体は続けられる。
    }
  }

  function clearDraft(key: string) {
    const next = { ...drafts };
    delete next[key];
    saveDrafts(next);
  }

  function discardAllDrafts() {
    saveDrafts({});
    setRestoreDismissed(true);
  }

  /** 次の未処理の指摘へ。最後まで行ったら終了画面になる。 */
  function goNext(from: number) {
    for (let i = from + 1; i < items.length; i += 1) {
      const item = items[i] as ReviewItem;
      if (verdicts[item.issue.key] === undefined) {
        setIndex(i);
        setEditing(false);
        setError(null);
        return;
      }
    }
    setIndex(items.length);
    setEditing(false);
    setError(null);
  }

  function goPrev() {
    for (let i = Math.min(index, items.length) - 1; i >= 0; i -= 1) {
      setIndex(i);
      setEditing(false);
      setError(null);
      return;
    }
  }

  function record(key: string, verdict: Verdict) {
    setVerdicts((prev) => ({ ...prev, [key]: verdict }));
  }

  async function acceptAsIs(item: ReviewItem) {
    setBusy(true);
    setError(null);
    try {
      await onAck(item.issue, "ok");
      record(item.issue.key, "ok");
      clearDraft(item.issue.key);
      goNext(index);
    } catch (e) {
      setError(e instanceof Error ? e.message : "確認済みにできませんでした");
    } finally {
      setBusy(false);
    }
  }

  /**
   * あとで見る (後回し)。
   *
   * 画面の中だけで覚えず、サーバに残す。対象年月を切り替えて戻ってきたときや、
   * 別の人が同じ月を開いたときにも「これは後回しにした」が見えている必要がある。
   */
  async function postpone(item: ReviewItem) {
    setBusy(true);
    setError(null);
    try {
      await onAck(item.issue, "later");
      record(item.issue.key, "later");
      goNext(index);
    } catch (e) {
      setError(e instanceof Error ? e.message : "あとで見るに登録できませんでした");
    } finally {
      setBusy(false);
    }
  }

  /**
   * 同じ種類の指摘をまとめて「問題なし」にする。
   *
   * 実行前に必ず対象と件数を見せ (bulkTarget)、実行後は「元に戻す」を出す (lastBulk)。
   * 押し間違いで大量にOKしてしまっても、1回の操作で戻せる状態を保つ。
   */
  async function runBulk(target: { label: string; items: ReviewItem[] }) {
    setBusy(true);
    setError(null);
    try {
      await onBulkAck(
        target.items.map((item) => item.issue),
        target.label,
      );
      setVerdicts((prev) => {
        const next = { ...prev };
        for (const item of target.items) next[item.issue.key] = "ok";
        return next;
      });
      setLastBulk(target);
      setBulkTarget(null);
      goNext(index - 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "まとめて確認済みにできませんでした");
    } finally {
      setBusy(false);
    }
  }

  /** 直前のまとめてOKを取り消す。 */
  async function undoBulk() {
    if (!lastBulk) return;
    setBusy(true);
    setError(null);
    try {
      await onBulkUndo(lastBulk.items.map((item) => item.issue));
      setVerdicts((prev) => {
        const next = { ...prev };
        for (const item of lastBulk.items) delete next[item.issue.key];
        return next;
      });
      setLastBulk(null);
      setIndex(items.indexOf(lastBulk.items[0] as ReviewItem));
    } catch (e) {
      setError(e instanceof Error ? e.message : "元に戻せませんでした");
    } finally {
      setBusy(false);
    }
  }

  async function saveValue(item: ReviewItem, field: EditableColumn, value: number, reason: string) {
    setBusy(true);
    setError(null);
    try {
      await onSave(item.row, field, value, reason);
      record(item.issue.key, "fixed");
      clearDraft(item.issue.key);
      goNext(index);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存できませんでした");
    } finally {
      setBusy(false);
    }
  }

  async function undoVerdict(item: ReviewItem) {
    const verdict = verdicts[item.issue.key];
    setBusy(true);
    setError(null);
    try {
      // 直した値の取り消しは表側の「元に戻す」に任せる。ここで消すのは判断の印だけ。
      if (verdict === "ok" || verdict === "later") await onAck(item.issue, null);
      setVerdicts((prev) => {
        const next = { ...prev };
        delete next[item.issue.key];
        return next;
      });
      setIndex(items.indexOf(item));
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "取り消せませんでした");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-line bg-white p-5" aria-label="指摘の確認">
      <ProgressHeader
        done={done}
        total={items.length}
        skipped={skipped.length}
        onExit={onExit}
      />

      {restored && Object.keys(drafts).length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-caution-border bg-caution-soft px-4 py-2 text-xs text-ink">
          <p>前回入力していた途中の値を復元しました。</p>
          <button
            type="button"
            onClick={discardAllDrafts}
            className="rounded border border-line bg-white px-3 py-0.5 font-semibold"
          >
            入力途中の値を捨てる
          </button>
        </div>
      ) : null}

      {error ? (
        <p className="mt-3 rounded-lg border border-danger-border bg-danger-soft px-4 py-2 text-xs text-danger">
          {error}
        </p>
      ) : null}

      {/* まとめてOKの直後だけ「元に戻す」を出す (自動処理には必ず戻し道を付ける)。 */}
      {lastBulk ? (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-brand-soft bg-brand-mist px-4 py-2 text-xs text-brand-deep">
          <p>
            {lastBulk.label} {lastBulk.items.length}件 をまとめて「問題なし」にしました。
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void undoBulk()}
            className="pressable rounded border border-brand bg-white px-3 py-0.5 font-semibold disabled:opacity-50"
          >
            元に戻す
          </button>
          <button
            type="button"
            onClick={() => setLastBulk(null)}
            className="rounded px-2 py-0.5 text-ink-muted hover:bg-white"
          >
            閉じる
          </button>
        </div>
      ) : null}

      {bulkTarget ? (
        <BulkConfirm
          label={bulkTarget.label}
          items={bulkTarget.items}
          busy={busy}
          onCancel={() => setBulkTarget(null)}
          onConfirm={() => void runBulk(bulkTarget)}
        />
      ) : current ? (
        <IssueCard
          key={current.issue.key}
          item={current}
          yearMonth={yearMonth}
          canEdit={canEdit}
          busy={busy}
          editing={editing}
          sameCodeCount={
            items.filter(
              (item) =>
                item.issue.code === current.issue.code &&
                verdicts[item.issue.key] === undefined,
            ).length
          }
          draft={drafts[current.issue.key] ?? null}
          onDraftChange={(draft) => saveDrafts({ ...drafts, [current.issue.key]: draft })}
          onStartEdit={() => setEditing(true)}
          onCancelEdit={() => setEditing(false)}
          onAcceptAsIs={() => void acceptAsIs(current)}
          onBulkOk={() =>
            setBulkTarget({
              label: `「${current.issue.title}」と同じ指摘`,
              items: items.filter(
                (item) =>
                  item.issue.code === current.issue.code &&
                  verdicts[item.issue.key] === undefined,
              ),
            })
          }
          onSkip={() => void postpone(current)}
          onSaveValue={(field, value, reason) => void saveValue(current, field, value, reason)}
          onPrev={index > 0 ? goPrev : null}
        />
      ) : (
        <FinishedPanel
          items={items}
          verdicts={verdicts}
          skipped={skipped}
          canEdit={canEdit}
          pendingCount={pendingCount}
          applying={applying}
          vehicleCount={vehicleCount}
          onApply={onApply}
          onExit={onExit}
          onReopen={(item) => {
            setIndex(items.indexOf(item));
            setEditing(false);
          }}
          onUndo={(item) => void undoVerdict(item)}
        />
      )}
    </section>
  );
}

/** 「あと何件か」を常に同じ場所に置く。目標勾配効果 (ux-design §12-B)。 */
function ProgressHeader({
  done,
  total,
  skipped,
  onExit,
}: {
  done: number;
  total: number;
  skipped: number;
  onExit: () => void;
}) {
  const ratio = total === 0 ? 1 : done / total;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <p className="num text-sm font-bold text-ink">
          {done} / {total}件 完了
        </p>
        {skipped > 0 ? (
          <p className="text-xs text-ink-muted">あとで見る {skipped}件</p>
        ) : null}
        <button
          type="button"
          onClick={onExit}
          className="ml-auto rounded border border-line px-3 py-1 text-xs font-semibold text-ink-muted hover:bg-subtle"
        >
          表に戻る
        </button>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-subtle">
        <div
          className="h-full rounded-full bg-brand transition-[width] duration-200"
          style={{ width: `${Math.round(ratio * 100)}%` }}
        />
      </div>
    </div>
  );
}

/**
 * 指摘1件のカード。
 *
 * 上から「どの車両の何の話か → いまいくつか → なぜ気になるか → 何をすればよいか」の順に置く。
 * 入力欄は「値を直す」を押すまで出さない。直すと決める前に空欄を見せると、
 * 何を入れるべきか分からないまま入力を迫られる形になるため。
 */
function IssueCard({
  item,
  yearMonth,
  canEdit,
  busy,
  editing,
  sameCodeCount,
  draft,
  onDraftChange,
  onStartEdit,
  onCancelEdit,
  onAcceptAsIs,
  onBulkOk,
  onSkip,
  onSaveValue,
  onPrev,
}: {
  item: ReviewItem;
  yearMonth: string;
  canEdit: boolean;
  busy: boolean;
  editing: boolean;
  /** この指摘と同じ種類で、まだ判断していない件数 (まとめてOKの対象数) */
  sameCodeCount: number;
  draft: Draft | null;
  onDraftChange: (draft: Draft) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onAcceptAsIs: () => void;
  onBulkOk: () => void;
  onSkip: () => void;
  onSaveValue: (field: EditableColumn, value: number, reason: string) => void;
  onPrev: (() => void) | null;
}) {
  const { row, issue } = item;
  /**
   * 先月の判断の案内を閉じたか。
   * 引き継ぎは判断を自動で付けるものではなく「先月はこうでした」を見せるだけなので、
   * 解除はこの案内を閉じるだけでよい (閉じれば、ふつうの1件として自分で判断する)。
   */
  const [carryOverReleased, setCarryOverReleased] = useState(false);
  const field = issue.field;
  const unit = unitOf(field);
  const benchmark: ValueBenchmark = row.benchmarks[field] ?? EMPTY_BENCHMARK;
  const digits = DECIMAL_DIGITS[field as VehiclePlField] ?? 0;

  // 指摘の項目そのものが直せないときは、直す入口になる項目 (運送収入→運賃) に振り替える。
  // 「取りうる対応」に書いた操作を、この画面のボタンとして必ず出せるようにするため。
  const alias = EDIT_TARGET_FIELD[issue.code];
  const editTarget: EditableColumn | null = isEditableColumn(field)
    ? field
    : alias !== undefined && isEditableColumn(alias)
      ? alias
      : null;
  const editable = canEdit && editTarget !== null;
  const targetDigits =
    editTarget === null ? digits : (DECIMAL_DIGITS[editTarget as VehiclePlField] ?? 0);
  const targetValue = editTarget === null ? null : row.values[editTarget as VehiclePlField];

  const guidance = useMemo(
    () => issueGuidance(issue, row.values, benchmark, labelOf(field), unit),
    [issue, row.values, benchmark, field, unit],
  );

  const currentValue = row.values[field as VehiclePlField];
  const currentNumber = typeof currentValue === "number" ? currentValue : null;

  return (
    <article className="mt-4">
      <header className="border-b border-line pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${SEVERITY_CHIP[issue.severity]}`}
          >
            {SEVERITY_LABEL[issue.severity]}
          </span>
          <span className="text-xs text-ink-muted">{SEVERITY_MEANING[issue.severity]}</span>
        </div>
        <h3 className="mt-2 text-lg font-bold text-ink">{issue.title}</h3>
        <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-muted">
          <Meta label="車番" value={row.vehicleNoLabel} />
          <Meta label="車種" value={String(row.values.type ?? "—")} />
          <Meta label="所属" value={String(row.values.depot ?? "—")} />
          <Meta label="運転者" value={String(row.values.driver ?? "—")} />
          <Meta label="対象年月" value={yearMonthLabel(yearMonth)} />
          <Meta label="項目" value={labelOf(field)} />
        </dl>

        {/* 毎月同じ指摘が出る車両のための案内。黙って隠さず、必ず文で見せる。
            値が大きく変わっている月には出さない (先月の判断がそのまま通るとは限らないため)。 */}
        {issue.carriedOver && !carryOverReleased ? (
          <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-brand-soft bg-brand-mist px-4 py-2 text-xs text-brand-deep">
            <p>
              先月もOKにした指摘です
              {issue.carriedOver.previousValue !== null
                ? `(先月の値 ${num(issue.carriedOver.previousValue, digits)} ${unit})`
                : ""}
              {issue.carriedOver.ackedByName
                ? ` / 判断した人: ${issue.carriedOver.ackedByName}`
                : ""}
            </p>
            {canEdit ? (
              <button
                type="button"
                onClick={onAcceptAsIs}
                disabled={busy}
                className="pressable rounded border border-brand bg-white px-3 py-0.5 font-semibold disabled:opacity-50"
              >
                先月と同じくOKにする
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setCarryOverReleased(true)}
              className="rounded px-2 py-0.5 text-ink-muted hover:bg-white"
            >
              引き継がない(自分で見る)
            </button>
          </div>
        ) : null}

        {issue.postponed ? (
          <p className="mt-3 rounded-lg border border-caution-border bg-caution-soft px-4 py-2 text-xs text-ink">
            これは前に「あとで見る」にした指摘です。
          </p>
        ) : null}
      </header>

      <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div>
          <p className="text-sm leading-relaxed text-ink">{guidance.summary}</p>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Reasons title="よくある原因" items={guidance.causes} />
            <Reasons title="取りうる対応" items={guidance.actions} />
          </div>

          {issue.comparisons.length > 0 ? (
            <div className="mt-4 rounded-lg border border-line bg-subtle px-4 py-3">
              <h4 className="text-xs font-bold text-ink">元になっている数字</h4>
              <dl className="mt-1.5 flex flex-wrap gap-x-6 gap-y-1">
                {issue.comparisons.map((comparison) => (
                  <div key={comparison.label} className="flex items-baseline gap-1.5">
                    <dt className="text-[11px] text-ink-muted">{comparison.label}</dt>
                    <dd className="num text-xs font-semibold text-ink">
                      {typeof comparison.value === "number"
                        ? num(comparison.value, Number.isInteger(comparison.value) ? 0 : 1)
                        : (comparison.value ?? "—")}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}
        </div>

        <aside className="rounded-lg border border-line px-4 py-3">
          <h4 className="text-xs font-bold text-ink">いまの値</h4>
          <p className="num-display mt-1 text-3xl text-accent">
            {currentNumber === null ? String(currentValue ?? "—") : num(currentNumber, digits)}
            <span className="ml-1 text-sm font-semibold text-ink-muted">{unit}</span>
          </p>
          <dl className="mt-3 space-y-1.5 border-t border-line pt-3 text-xs">
            {benchmark.typical !== null ? (
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-ink-muted">{benchmark.typicalLabel}</dt>
                <dd className="num font-semibold text-ink">
                  {num(benchmark.typical, digits)} {unit}
                </dd>
              </div>
            ) : null}
            {benchmark.previous !== null ? (
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-ink-muted">{benchmark.previousLabel}</dt>
                <dd className="num font-semibold text-ink">
                  {num(benchmark.previous, digits)} {unit}
                </dd>
              </div>
            ) : null}
            {benchmark.typical === null && benchmark.previous === null ? (
              <p className="text-ink-muted">比べられる値がありません(今月が初回の車両です)。</p>
            ) : null}
          </dl>
          <Link
            href={`/vehicle/${encodeURIComponent(row.vehicleNo)}?ym=${yearMonth}`}
            className="mt-3 inline-block text-xs font-semibold text-brand-deep hover:underline"
          >
            この車両の内訳を見る →
          </Link>
        </aside>
      </div>

      {editing && editable && editTarget !== null ? (
        <ValueEditor
          field={editTarget}
          unit={unitOf(editTarget)}
          digits={targetDigits}
          currentValue={typeof targetValue === "number" ? targetValue : null}
          benchmark={row.benchmarks[editTarget] ?? EMPTY_BENCHMARK}
          busy={busy}
          draft={draft}
          defaultReason={row.override?.reason ?? ""}
          onDraftChange={onDraftChange}
          onCancel={onCancelEdit}
          onSubmit={(value, reason) => onSaveValue(editTarget, value, reason)}
        />
      ) : (
        <footer className="mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-4">
          {editable && editTarget !== null ? (
            <button
              type="button"
              onClick={onStartEdit}
              disabled={busy}
              className="pressable rounded-md bg-accent px-5 py-2.5 text-sm font-semibold text-white hover:bg-accent-deep disabled:opacity-50"
            >
              {editTarget === field ? "値を直す" : `${labelOf(editTarget)}を直す`}
            </button>
          ) : null}

          {/* 取込・マスタ側で直す道は、この画面で直せる場合も残す(原因が別にあることは多い) */}
          {issue.fix ? (
            <Link
              href={issue.fix.href}
              className={
                editable
                  ? "pressable rounded-md border border-brand px-5 py-2.5 text-sm font-semibold text-brand-deep hover:bg-brand-soft"
                  : "pressable rounded-md bg-accent px-5 py-2.5 text-sm font-semibold text-white hover:bg-accent-deep"
              }
            >
              {issue.fix.label}
            </Link>
          ) : null}

          {canEdit ? (
            <button
              type="button"
              onClick={onAcceptAsIs}
              disabled={busy}
              className="pressable rounded-md border border-brand px-5 py-2.5 text-sm font-semibold text-brand-deep hover:bg-brand-soft disabled:opacity-50"
            >
              このままでOK(問題なし)
            </button>
          ) : null}

          {/* まとめてOKは「要修正」には出さない。要修正は1件ずつ見て直すためのもので、
              まとめて通せる形にしてしまうと、直すべきものが黙って通る。 */}
          {canEdit && issue.severity !== "blocking" && sameCodeCount >= 2 ? (
            <button
              type="button"
              onClick={onBulkOk}
              disabled={busy}
              className="pressable rounded-md border border-line px-4 py-2.5 text-sm font-semibold text-ink hover:bg-subtle disabled:opacity-50"
            >
              同じ指摘 {sameCodeCount}件 をまとめてOK
            </button>
          ) : null}

          <button
            type="button"
            onClick={onSkip}
            disabled={busy}
            className="rounded-md border border-line px-4 py-2.5 text-sm text-ink-muted hover:bg-subtle disabled:opacity-50"
          >
            あとで見る(スキップ)
          </button>

          {onPrev ? (
            <button
              type="button"
              onClick={onPrev}
              disabled={busy}
              className="ml-auto rounded px-3 py-2 text-xs font-semibold text-ink-muted hover:bg-subtle"
            >
              ← 前の指摘へ
            </button>
          ) : null}
        </footer>
      )}

      {!canEdit ? (
        <p className="mt-3 text-xs text-ink-muted">
          いまは見るだけの状態です。直したり確認済みにしたりはできません。
        </p>
      ) : null}
    </article>
  );
}

/**
 * まとめてOKの実行前の確認。
 *
 * まとめ操作でいちばん怖いのは「何件に効くのか分からないまま押してしまう」ことなので、
 * 件数と対象の車番を先に全部見せてから実行させる (ux-design §5 一括操作の4点セット)。
 * 実行ボタンは既定でフォーカスしない。Enter連打でそのまま通らないようにする。
 */
function BulkConfirm({
  label,
  items,
  busy,
  onCancel,
  onConfirm,
}: {
  label: string;
  items: readonly ReviewItem[];
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="mt-4 rounded-xl border border-caution-border bg-caution-soft p-5">
      <h3 className="text-lg font-bold text-ink">
        {label} <span className="num">{items.length}件</span> をまとめて「問題なし」にします。
      </h3>
      <p className="mt-1 text-sm text-ink">
        この{items.length}件は、内容を1件ずつ見ずに確認済みになります。対象は次の車両です。
      </p>

      <ul className="mt-3 max-h-56 space-y-1 overflow-y-auto rounded-lg border border-line bg-white px-4 py-3">
        {items.map((item) => (
          <li key={item.issue.key} className="flex flex-wrap gap-x-3 text-xs text-ink">
            <span className="num font-semibold">車番 {item.row.vehicleNoLabel}</span>
            <span className="text-ink-muted">{labelOf(item.issue.field)}</span>
            <span className="text-ink-muted">{item.issue.title}</span>
          </li>
        ))}
      </ul>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="pressable rounded-md border border-line bg-white px-5 py-2.5 text-sm font-semibold text-ink hover:bg-subtle disabled:opacity-50"
        >
          やめる(1件ずつ見る)
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className="pressable rounded-md border border-brand bg-white px-5 py-2.5 text-sm font-semibold text-brand-deep hover:bg-brand-soft disabled:opacity-50"
        >
          {busy ? "処理しています…" : `${items.length}件をまとめてOKにする`}
        </button>
        <p className="text-[11px] text-ink-muted">実行した後でも、まとめて元に戻せます。</p>
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt>{label}</dt>
      <dd className="font-semibold text-ink">{value}</dd>
    </div>
  );
}

function Reasons({ title, items }: { title: string; items: readonly string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h4 className="text-xs font-bold text-ink">{title}</h4>
      <ul className="mt-1.5 space-y-1">
        {items.map((text) => (
          <li key={text} className="flex gap-1.5 text-xs leading-relaxed text-ink-muted">
            <span aria-hidden="true">・</span>
            <span>{text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * 値を直す入力欄。
 *
 * 「入力できる」ことより「間違った値を入れずに済む」ことを優先する:
 *  - 打っている最中も3桁区切りにして桁を目で数えさせない
 *  - ふつうの範囲に入ったかどうかを、色ではなく文で返す
 *  - 桁を1つ間違えた疑いがあるときは、直した候補をボタンで出す (押すだけで直る)
 */
function ValueEditor({
  field,
  unit,
  digits,
  currentValue,
  benchmark,
  busy,
  draft,
  defaultReason,
  onDraftChange,
  onCancel,
  onSubmit,
}: {
  field: string;
  unit: string;
  digits: number;
  currentValue: number | null;
  benchmark: ValueBenchmark;
  busy: boolean;
  draft: Draft | null;
  defaultReason: string;
  onDraftChange: (draft: Draft) => void;
  onCancel: () => void;
  onSubmit: (value: number, reason: string) => void;
}) {
  const [text, setText] = useState(draft?.value ?? toInputText(currentValue, digits));
  const [reason, setReason] = useState(draft?.reason ?? defaultReason);
  const [touched, setTouched] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const valueRef = useRef<HTMLInputElement>(null);
  const reasonRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    valueRef.current?.focus();
    valueRef.current?.select();
  }, []);

  const parsed = parseNumberInput(text);
  const check = parsed === null ? null : checkValue(parsed, benchmark, unit);
  const candidate = parsed === null ? null : digitFixCandidate(parsed, benchmark);
  const example = benchmark.typical === null ? "" : toInputText(benchmark.typical, digits);

  /** 保存できない入力 (負・整数でない) だけを blur で判定する。入力中は赤くしない。 */
  function hardError(value: number | null): string | null {
    if (value === null) return "数字を入力してください";
    if (value < 0) return `${labelOf(field)}に、0より小さい値は入れられません`;
    if (digits === 0 && !Number.isInteger(value)) return `${labelOf(field)}は整数で入力してください`;
    return null;
  }

  function update(nextText: string, nextReason: string) {
    setText(nextText);
    setReason(nextReason);
    onDraftChange({ value: nextText, reason: nextReason });
  }

  function submit() {
    const invalid = hardError(parsed);
    if (invalid) {
      setTouched(true);
      setFormError(invalid);
      valueRef.current?.focus();
      return;
    }
    if (reason.trim() === "") {
      setFormError("直した理由を入力してください(翌月に同じ判断を引き継ぐために使います)");
      reasonRef.current?.focus();
      return;
    }
    setFormError(null);
    onSubmit(parsed as number, reason.trim());
  }

  return (
    <div
      className="mt-5 rounded-lg border border-brand bg-brand-mist p-4"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
    >
      {/* どの項目を直しているのかを必ず名指しする (指摘の項目と直す項目が違うことがある) */}
      <p className="mb-3 text-xs font-bold text-ink">{labelOf(field)}を直す</p>

      <div className="flex flex-wrap items-end gap-4">
        <div>
          <span className="block text-[11px] text-ink-muted">いまの値</span>
          <span className="num text-sm text-ink">
            {currentValue === null ? "—" : num(currentValue, digits)} {unit}
          </span>
        </div>

        <label className="text-xs text-ink">
          <span className="block font-semibold">直した後の値</span>
          <span className="mt-1 flex items-center gap-1">
            <input
              ref={valueRef}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              disabled={busy}
              value={text}
              placeholder={example === "" ? "" : `例: ${example}`}
              onChange={(e) => update(formatNumberInput(e.target.value), reason)}
              onBlur={() => {
                setTouched(true);
                setFormError(hardError(parseNumberInput(text)));
              }}
              onKeyDown={(e) => {
                // 変換確定のEnterで送信しない。Enterは次の欄へ移す (ux-design §4-2)。
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  reasonRef.current?.focus();
                }
              }}
              className="num w-44 rounded-md border border-line bg-white px-2 py-1.5 text-right text-sm"
            />
            <span className="text-xs font-semibold text-ink-muted">{unit}</span>
          </span>
        </label>

        <label className="min-w-64 flex-1 text-xs text-ink">
          <span className="block font-semibold">直した理由(必須)</span>
          <input
            ref={reasonRef}
            type="text"
            disabled={busy}
            value={reason}
            onChange={(e) => update(text, e.target.value)}
            placeholder="例: 請求側で15万円減額したため"
            className="mt-1 block w-full rounded-md border border-line bg-white px-2 py-1.5 text-sm"
          />
        </label>
      </div>

      {candidate !== null ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded border border-caution-border bg-caution-soft px-3 py-2 text-xs text-ink">
          <p>
            桁が違うかもしれません。{num(candidate, digits)} {unit} のことですか?
          </p>
          <button
            type="button"
            onClick={() => update(toInputText(candidate, digits), reason)}
            className="rounded border border-line bg-white px-3 py-0.5 font-semibold"
          >
            この値にする
          </button>
        </div>
      ) : null}

      {touched && formError ? (
        <p className="mt-2 text-xs font-semibold text-danger">{formError}</p>
      ) : check && check.message !== "" ? (
        <p
          className={`mt-2 text-xs ${check.verdict === "ok" ? "font-semibold text-brand-deep" : "text-ink-muted"}`}
        >
          {check.verdict === "ok" ? "OK: " : "確認: "}
          {check.message}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="pressable rounded-md bg-accent px-5 py-2.5 text-sm font-semibold text-white hover:bg-accent-deep disabled:opacity-50"
        >
          {busy ? "保存しています…" : "この値で保存して次へ"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded-md border border-line bg-white px-4 py-2.5 text-sm text-ink-muted hover:bg-subtle"
        >
          やめる
        </button>
        <p className="text-[11px] text-ink-muted">
          入力した内容は自動で控えているので、間違えて閉じても消えません。
        </p>
      </div>
    </div>
  );
}

/**
 * 全部見終わったときの画面。
 *
 * ここが体験の「終わり」なので、次の1歩(収支表に反映する)だけを大きく置き、
 * それ以外は見直し用の一覧に畳む (ピークエンドの法則)。
 */
function FinishedPanel({
  items,
  verdicts,
  skipped,
  canEdit,
  pendingCount,
  applying,
  vehicleCount,
  onApply,
  onExit,
  onReopen,
  onUndo,
}: {
  items: readonly ReviewItem[];
  verdicts: Record<string, Verdict>;
  skipped: readonly ReviewItem[];
  canEdit: boolean;
  pendingCount: number;
  applying: boolean;
  vehicleCount: number;
  onApply: () => void;
  onExit: () => void;
  onReopen: (item: ReviewItem) => void;
  onUndo: (item: ReviewItem) => void;
}) {
  const handled = items.filter((item) => {
    const verdict = verdicts[item.issue.key];
    return verdict === "ok" || verdict === "fixed";
  });

  return (
    <div className="mt-4">
      {skipped.length > 0 ? (
        <div className="rounded-lg border border-caution-border bg-caution-soft px-4 py-3">
          <p className="text-sm font-semibold text-ink">
            あとで見るにした指摘が {skipped.length}件 残っています。
          </p>
          <ul className="mt-2 space-y-1">
            {skipped.map((item) => (
              <li key={item.issue.key} className="text-xs text-ink">
                <button
                  type="button"
                  onClick={() => onReopen(item)}
                  className="font-semibold text-brand-deep hover:underline"
                >
                  車番 {item.row.vehicleNoLabel} / {labelOf(item.issue.field)}
                </button>
                <span className="ml-2 text-ink-muted">{item.issue.title}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-lg font-bold text-ink">準備が整いました。</p>
      )}

      {canEdit ? (
        <div className="mt-4 rounded-lg border border-line px-4 py-4">
          {applying ? (
            <ApplyingProgress vehicleCount={vehicleCount} />
          ) : (
            <>
              <p className="text-sm text-ink">
                {pendingCount > 0
                  ? `直した数字が ${pendingCount}件 あります。収支表に反映すると、損益や経費の合計が新しい数字で作り直されます。`
                  : "直した数字はありません。確認済みにした内容はすでに保存されています。"}
              </p>
              <button
                type="button"
                onClick={onApply}
                disabled={pendingCount === 0}
                className="pressable mt-3 rounded-md bg-accent px-6 py-3 text-base font-semibold text-white hover:bg-accent-deep disabled:opacity-50"
              >
                収支表に反映する
              </button>
            </>
          )}
        </div>
      ) : null}

      {handled.length > 0 ? (
        <div className="mt-4">
          <h4 className="text-xs font-bold text-ink">今回の確認内容({handled.length}件)</h4>
          <ul className="mt-1.5 divide-y divide-line rounded-lg border border-line">
            {handled.map((item) => (
              <li
                key={item.issue.key}
                className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs"
              >
                <span className="font-semibold text-ink">
                  車番 {item.row.vehicleNoLabel} / {labelOf(item.issue.field)}
                </span>
                <span className="text-ink-muted">
                  {verdicts[item.issue.key] === "fixed"
                    ? "値を直しました"
                    : "このままでOKにしました"}
                </span>
                {canEdit ? (
                  <button
                    type="button"
                    onClick={() => onUndo(item)}
                    className="ml-auto rounded border border-line px-3 py-0.5 font-semibold text-ink-muted hover:bg-subtle"
                  >
                    元に戻す
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <button
        type="button"
        onClick={onExit}
        className="mt-4 rounded-md border border-line px-4 py-2 text-sm font-semibold text-ink-muted hover:bg-subtle"
      >
        表に戻る
      </button>
    </div>
  );
}

/**
 * 反映中の表示。
 *
 * 何秒かかるかは車両台数とデータ量で変わるので、正確な残り時間は出せない。
 * 出せないものを出さない代わりに「だいたいの目安」と「待たなくてよい」ことを書く
 * (ux-design §6 正直なUI / §11 知覚パフォーマンス)。
 */
function ApplyingProgress({ vehicleCount }: { vehicleCount: number }) {
  const [elapsed, setElapsed] = useState(0);
  // 実測値がまだ無いので、1台あたり0.5秒の粗い見積り。下限20秒。
  const estimate = Math.max(20, Math.round(vehicleCount * 0.5));

  useEffect(() => {
    const timer = window.setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const ratio = Math.min(0.95, elapsed / estimate);
  return (
    <div>
      <p className="text-sm font-semibold text-ink">収支表を作り直しています…</p>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-subtle">
        <div
          className="h-full rounded-full bg-brand transition-[width] duration-500"
          style={{ width: `${Math.round(ratio * 100)}%` }}
        />
      </div>
      <p className="num mt-2 text-xs text-ink-muted">
        {elapsed}秒経過 / 目安 {estimate}秒ほど
      </p>
      <p className="mt-1 text-xs text-ink-muted">
        {vehicleCount}台分をまとめて計算し直しています。終わるまでこのページを開いたままにしてください。
        席を外していただいてかまいません。
      </p>
    </div>
  );
}
