"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type {
  AnomalyQueueItem,
  AnomalyRecommendation,
} from "../../../src/usecase/steps/getAnomalyQueue";
import { FIELD_LABELS } from "../../_lib/fieldLabels";
import { num, pct, yen } from "../../_lib/format";
import { ListToolbar, type SortOption } from "../../_components/ListToolbar";
import { AlertPanel } from "../../_components/AlertPanel";
import { Badge } from "../../_components/Badge";
import { StickyFilterBar } from "../../_components/StickyFilterBar";

type Judgement = AnomalyRecommendation;
type Priority = AnomalyQueueItem["priority"];

const QUEUE_SORT_OPTIONS: SortOption[] = [
  { value: "default", label: "対応する順（既定）" },
  { value: "priorityDesc", label: "優先度が高い順" },
  { value: "vehicleNoAsc", label: "車番順" },
];

const PRIORITY_ORDER: Record<Priority, number> = { 高: 0, 中: 1, 低: 2 };

/*
  判定の呼び名は T7 §1-1 の表に合わせる。/todo と /anomaly は同じ API
  (/api/todo/{id}/resolve) を呼んでいるのに、画面ごとに別の言い方をしていた。
  同じ操作は同じ言葉にする。
*/
const JUDGEMENT_LABEL: Record<Judgement, string> = {
  corrected: "直す",
  approved: "このままでよい",
};

/** 優先度 → 札の見え方。色相は増やさず、意味で選ぶ (Badge の注記) */
const PRIORITY_TONE: Record<Priority, "danger" | "caution" | "neutral"> = {
  高: "danger",
  中: "caution",
  低: "neutral",
};

function fieldLabel(field: string | null): string {
  if (!field) return "—";
  return (FIELD_LABELS as Record<string, string>)[field] ?? field;
}

/**
 * 異常値チェックの判定キュー (モック view-anomaly.js に対応)。
 *
 * 一覧で悩ませず「1件ずつ・推奨つきで・戻せる」形にする:
 *   - 12ヶ月の推移と中央値を先に見せてから2択を出す
 *   - 優先度の低いものは「これで正しい」を推奨(既定値効果で手数を減らす)
 *   - 判定直後に必ず取り消し線を出す(確認ダイアログではなくUndoで安全を担保する)
 *
 * 表かカードか (T7 §4-1)。ここで利用者がするのは「列をまたいで値を見比べる」ことではなく、
 * 1件の中身(当月の値・いつもの値・推移)を読んで直すかどうかを決めること。よってカードで出す
 * (T7 §4-3 で「異常の判定」はカードと決まっている)。
 */
export function AnomalyQueue({
  items,
  yearMonth,
  canApprove,
  plVehicleCount,
}: {
  items: AnomalyQueueItem[];
  yearMonth: string;
  canApprove: boolean;
  /** その月の収支表の台数。0なら判定対象そのものが存在しない。 */
  plVehicleCount: number;
}) {
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastDone, setLastDone] = useState<{ item: AnomalyQueueItem; judgement: Judgement } | null>(
    null,
  );
  const [queueSearch, setQueueSearch] = useState("");
  const [queueSort, setQueueSort] = useState("default");
  const [priorityFilters, setPriorityFilters] = useState<Set<Priority>>(new Set());

  const remaining = items.slice(index);
  const current = remaining[0] ?? null;

  function toggleQueuePriority(key: string) {
    setPriorityFilters((prev) => {
      const next = new Set(prev);
      const p = key as Priority;
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  }

  // 待ち行列の並び自体(remaining)は判定の進み方に使うので変えない。
  // 検索・絞り込み・並べ替えは、サイドバーの表示だけに効かせ、クリックでその項目へ直接ジャンプできるようにする。
  const query = queueSearch.trim();
  let queueView = remaining;
  if (query) {
    queueView = queueView.filter(
      (i) => (i.vehicleNo ?? "").includes(query) || fieldLabel(i.field).includes(query),
    );
  }
  if (priorityFilters.size > 0) {
    queueView = queueView.filter((i) => priorityFilters.has(i.priority));
  }
  if (queueSort === "priorityDesc") {
    queueView = [...queueView].sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
  } else if (queueSort === "vehicleNoAsc") {
    queueView = [...queueView].sort((a, b) =>
      (a.vehicleNo ?? "").localeCompare(b.vehicleNo ?? "", "ja", { numeric: true }),
    );
  }

  async function send(id: string, action: Judgement | "reopen") {
    const res = await fetch(`/api/todo/${encodeURIComponent(id)}/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    });
    if (!res.ok) throw new Error(`判定を保存できませんでした (HTTP ${res.status})`);
  }

  async function judge(item: AnomalyQueueItem, judgement: Judgement) {
    setPending(true);
    setError(null);
    try {
      await send(item.id, judgement);
      setLastDone({ item, judgement });
      setIndex((i) => i + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "判定を保存できませんでした");
    } finally {
      setPending(false);
    }
  }

  async function undo() {
    if (!lastDone) return;
    setPending(true);
    setError(null);
    try {
      await send(lastDone.item.id, "reopen");
      setIndex((i) => Math.max(0, i - 1));
      setLastDone(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "取り消しできませんでした");
    } finally {
      setPending(false);
    }
  }

  /*
    判定するものが無い理由は2つあり、意味が正反対になる。
      収支表がある → 全部見終わった (完了)
      収支表が無い → まだ見るものが作られていない (未着手)
    以前はどちらも「すべて判定済みです」と出ていたため、取込の直後にここへ来た人が
    工程が終わったと受け取ってしまっていた。理由を1行で言い、前の工程へ戻れるようにする。
    収支表が作られない原因(取込が足りない/車両マスタが空)は月次収支表の画面が名指しするので、
    説明を二重に持たず、そちらへ送る。
  */
  if (plVehicleCount === 0) {
    /*
      共通の EmptyState は行き先を1つしか持てない。ここは「月次収支表で足りないものを見る」と
      「取込へ戻る」の2つが要るので、EmptyState には寄せずカードのまま置く。
      行き先を1つに削るのは、詰まった人の逃げ道を減らすことになる。
    */
    return (
      <div className="card px-6 py-12 text-center">
        <p className="text-sm font-semibold text-ink">この月の収支表がまだありません</p>
        <p className="mt-1 text-sm text-ink-muted">
          チェックする中身が無いため、判定はまだ始められません。月次収支表で、何が足りないかを確認してください。
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <Link href={`/grid?ym=${yearMonth}`} className="btn btn-primary pressable">
            月次収支表で確認する
          </Link>
          <Link href={`/import?ym=${yearMonth}`} className="btn btn-quiet pressable">
            データ取込へ戻る
          </Link>
        </div>
      </div>
    );
  }

  if (!current) {
    // ここも行き先が2つ（ダッシュボード・月次収支表）あるため EmptyState には寄せない
    return (
      <div className="card px-6 py-12 text-center">
        <p className="text-sm font-semibold text-ink">この月の異常値はすべて判定済みです</p>
        <p className="mt-1 text-sm text-ink-muted">
          締めの結果はダッシュボードと月次収支表で確認できます。
        </p>
        {lastDone && (
          <p className="mt-3 text-xs text-ink-muted">
            直前の判定: 車番 {lastDone.item.vehicleNo} / {fieldLabel(lastDone.item.field)} →{" "}
            {JUDGEMENT_LABEL[lastDone.judgement]}
            <button
              type="button"
              onClick={undo}
              disabled={pending}
              className="btn btn-quiet btn-sm pressable ml-2"
            >
              この判定を取り消す
            </button>
          </p>
        )}
        <div className="mt-4 flex justify-center gap-2">
          <Link
            href={`/dashboard?ym=${yearMonth}`}
            className="btn btn-primary pressable"
          >
            ダッシュボードへ
          </Link>
          <Link
            href={`/grid?ym=${yearMonth}`}
            className="btn btn-quiet pressable"
          >
            月次収支表へ
          </Link>
        </div>
        {error ? (
          <div className="mt-3 text-left">
            <AlertPanel tone="danger" title={error} />
          </div>
        ) : null}
      </div>
    );
  }

  const sparkMax = Math.max(...current.spark.map((p) => Math.abs(p.value ?? 0)), 1);

  return (
    <div>
      {/*
        いま何件目か・あと何件かは、下までスクロールしても見えている必要がある。
        判定の途中で「あとどれだけ残っているか」が消えると、やめどきが分からなくなる。
      */}
      <StickyFilterBar summary={`残り ${remaining.length}件`}>
        <p className="num text-xs text-ink-muted">
          {index + 1} / {items.length} 件目
        </p>
      </StickyFilterBar>

      <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
        <section className="card p-5">
          {/* 何件目かは上の帯に出しているので、ここでは重ねて出さない */}
          <div className="flex items-baseline justify-end gap-3">
            <Badge tone={PRIORITY_TONE[current.priority]}>優先度 {current.priority}</Badge>
          </div>

        <h2 className="mt-2 text-lg font-bold text-ink">
          車番 {current.vehicleNo ?? "—"} — {fieldLabel(current.field)}
        </h2>
        <p className="mt-1 text-sm text-ink-muted">{current.message}</p>

        <div className="mt-4 grid grid-cols-3 gap-3">
          <div className="rounded-lg border border-line p-3">
            <p className="text-[11px] text-ink-muted">当月の値</p>
            <p className="num mt-1 text-xl font-bold text-ink">{yen(current.value)}</p>
          </div>
          <div className="rounded-lg border border-line p-3">
            <p className="text-[11px] text-ink-muted">いつもの値（中央値）</p>
            <p className="num mt-1 text-xl font-bold text-ink-muted">{yen(current.median)}</p>
          </div>
          <div className="rounded-lg border border-line p-3">
            <p className="text-[11px] text-ink-muted">中央値比</p>
            <p className="num mt-1 text-xl font-bold text-accent">
              {current.ratioToMedian === null ? "—" : pct(current.ratioToMedian, 0)}
            </p>
          </div>
        </div>

        <div className="mt-5">
          <p className="text-xs font-semibold text-ink">直近12ヶ月の推移</p>
          <div className="mt-2 flex items-end gap-1" role="img" aria-label="直近12ヶ月の推移">
            {current.spark.map((p) => {
              const h = p.value === null ? 0 : (Math.abs(p.value) / sparkMax) * 100;
              const isCurrent = p.yearMonth === yearMonth;
              return (
                <div key={p.yearMonth} className="flex flex-1 flex-col items-center gap-1">
                  <div className="flex h-20 w-full items-end">
                    <div
                      className={`w-full rounded-t ${isCurrent ? "bg-accent" : "bg-brand/40"}`}
                      style={{ height: `${Math.max(h, p.value === null ? 0 : 2)}%` }}
                      title={`${p.label}: ${p.value === null ? "データなし" : num(p.value)}`}
                    />
                  </div>
                  <span className="text-[10px] text-ink-muted">{p.label}</span>
                </div>
              );
            })}
          </div>
          {current.median !== null && (
            <p className="mt-1 text-[11px] text-ink-muted">
              中央値 {yen(current.median)}（当月を除く11ヶ月から算出）
            </p>
          )}
        </div>

        {!canApprove ? (
          <div className="mt-5">
            {/* 押せない理由と、次にどうすればよいかを1行で言う */}
            <AlertPanel tone="caution" title="判定するには承認権限が必要です。閲覧のみ可能です。">
              判定を任されている人に頼むか、管理者に権限の変更を依頼してください。
            </AlertPanel>
          </div>
        ) : (
          <div className="mt-5 grid gap-2 sm:grid-cols-2">
            {(["corrected", "approved"] as const).map((j) => {
              const recommended = current.recommendation === j;
              return (
                <button
                  key={j}
                  type="button"
                  disabled={pending}
                  onClick={() => judge(current, j)}
                  className={[
                    "btn pressable",
                    recommended ? "btn-primary" : "btn-secondary",
                  ].join(" ")}
                >
                  {JUDGEMENT_LABEL[j]}
                  {recommended && <span className="ml-1 text-xs font-normal">（おすすめ）</span>}
                </button>
              );
            })}
          </div>
        )}

        {error && (
          <div className="mt-3">
            <AlertPanel tone="danger" title={error}>
              もう一度お試しください。
            </AlertPanel>
          </div>
        )}

        {lastDone && (
          <p className="mt-3 text-xs text-ink-muted">
            直前: 車番 {lastDone.item.vehicleNo} / {fieldLabel(lastDone.item.field)} →{" "}
            {JUDGEMENT_LABEL[lastDone.judgement]}
            <button
              type="button"
              onClick={undo}
              disabled={pending}
              className="btn btn-quiet btn-sm pressable ml-2"
            >
              この判定を取り消す
            </button>
          </p>
        )}

        {/*
          文の途中に置いた下線つきのボタンは、リンクと見分けがつかないうえ
          「押すと何が起きるか」が文を最後まで読まないと分からなかった。
          説明文とボタンを分け、ボタンは他の画面と同じ形にする。
        */}
        <p className="mt-4 text-[11px] text-ink-muted">
          判定した内容は、一覧を読み込み直すと最新の状態になります。
        </p>
        <button
          type="button"
          onClick={() => router.refresh()}
          className="btn btn-quiet btn-sm pressable mt-2"
        >
          一覧を読み込み直す
        </button>
      </section>

      <aside className="card p-4">
        <p className="text-xs font-semibold text-ink">残りの待ち行列（{remaining.length}件）</p>
        <div className="mt-2">
          <ListToolbar
            searchValue={queueSearch}
            onSearchChange={setQueueSearch}
            searchPlaceholder="車番・項目で検索"
            sortOptions={QUEUE_SORT_OPTIONS}
            sortValue={queueSort}
            onSortChange={setQueueSort}
            filterChips={(["高", "中", "低"] as const).map((p) => ({
              key: p,
              label: `優先度${p}`,
              active: priorityFilters.has(p),
            }))}
            onToggleFilter={toggleQueuePriority}
          />
        </div>
        <ul className="mt-2 space-y-1">
          {queueView.slice(0, 12).map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => setIndex(items.indexOf(item))}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs ${item.id === current?.id ? "bg-brand-soft font-semibold text-brand-deep" : "text-ink-muted hover:bg-subtle"}`}
              >
                <span className="num shrink-0">{item.vehicleNo ?? "—"}</span>
                <span className="min-w-0 flex-1 truncate">{fieldLabel(item.field)}</span>
                <span className="shrink-0 text-[10px]">{item.priority}</span>
              </button>
            </li>
          ))}
        </ul>
        {queueView.length === 0 && (
          <p className="mt-2 text-[11px] text-ink-muted">
            この条件に合う項目はありません。検索の言葉を消すか、優先度の絞り込みを外すと全部出ます。
          </p>
        )}
        {queueView.length > 12 && (
          <p className="mt-2 text-[11px] text-ink-muted">ほか {queueView.length - 12} 件</p>
        )}
        </aside>
      </div>
    </div>
  );
}
