import { Fragment } from "react";
import { redirect } from "next/navigation";
import { getServerSession } from "../../../src/infrastructure/auth/session";
import { PageHead } from "../../_components/PageHead";

/**
 * S10 データ設計・自動化方針 (モック view-logic.js に対応)。
 * 「どの数字がどこから来て、どう決まるか」を発注者と合意するための画面。
 * 内容は仕様の合意事項そのものなのでDBではなくコードで保持する(変更履歴はgitに残る)。
 */

type MapStatus = "fixed" | "hypo" | "agree";

const STATUS_LABEL: Record<MapStatus, { label: string; className: string }> = {
  fixed: { label: "確定", className: "bg-subtle text-ink border-line" },
  hypo: { label: "仮説 — 要ヒアリング", className: "bg-caution-soft text-ink border-caution-border" },
  agree: { label: "方針合意が必要", className: "bg-brand-soft text-brand-deep border-transparent" },
};

const LAYER_HEAD: Record<1 | 2 | 3, string> = {
  1: "層① 自動流入 — 1次ソースから自動で入る(人間は触らない)",
  2: "層② 連鎖確定 — 入力とマスタから自動計算で決まる",
  3: "層③ 原票読取 — CSV/Excel/PDFから取得し、例外だけ確認する",
};

const MAP: readonly { item: string; layer: 1 | 2 | 3; src: string; how: string; status: MapStatus }[] =
  [
    {
      item: "運行回数・稼働時間・稼働Km・燃費(分母)",
      layer: 1,
      src: "デジタコ → 車楽",
      how: "車楽からCSVエクスポート定期取込(API有無を初回確認)",
      status: "hypo",
    },
    { item: "運賃・附帯料金・伝票件数", layer: 1, src: "車楽(請求システム)", how: "同上", status: "hypo" },
    { item: "道路使用料", layer: 1, src: "デジタコETC → 車楽", how: "同上", status: "hypo" },
    {
      item: "高速割引料",
      layer: 2,
      src: "道路使用料 × 割引率0.356",
      how: "率マスタから自動計算(率は設定画面で変更可)",
      status: "fixed",
    },
    { item: "賞与", layer: 2, src: "規程(年40万円÷12)", how: "運転者が紐づけば自動", status: "fixed" },
    {
      item: "福利厚生費",
      layer: 2,
      src: "社保合計",
      how: "給与データに含まれるなら自動、なければ料率マスタ×給与",
      status: "hypo",
    },
    {
      item: "車検・タイヤ費(標準原価)",
      layer: 2,
      src: "原価計算シート(大型10.7円/km等)",
      how: "単価マスタ × 稼働Km で自動",
      status: "fixed",
    },
    {
      item: "自賠責・任意保険/自動車税・重量税",
      layer: 2,
      src: "車両マスタ",
      how: "車検・更新イベント時のみマスタ更新 → 月割自動配賦",
      status: "fixed",
    },
    {
      item: "車両リース・割賦",
      layer: 2,
      src: "車両マスタ(毎月支払額)",
      how: "契約時登録 → 毎月自動計上",
      status: "fixed",
    },
    {
      item: "一般管理費",
      layer: 2,
      src: "売上 × 16.9%(3期平均)",
      how: "率マスタから自動(当面現行踏襲)",
      status: "agree",
    },
    {
      item: "固定費・変動費・経費計・損益・利益率",
      layer: 2,
      src: "上記すべて",
      how: "現行Excelの定義式をそのまま実装。手入力は構造的に不可",
      status: "fixed",
    },
    {
      item: "軽油代(インタンク/外部)・給油量",
      layer: 3,
      src: "給油レシート・外部請求書",
      how: "CSV/Excelは自動取込、PDFはOCRで車番・金額を抽出",
      status: "hypo",
    },
    {
      item: "インタンク単価(円/ℓ)",
      layer: 3,
      src: "月次の仕入単価",
      how: "請求書/仕入データから取得し、全車へ自動反映",
      status: "hypo",
    },
    {
      item: "給与",
      layer: 3,
      src: "ACELINK NX-CE CSV",
      how: "給与集計表(日給者)をファイル取込",
      status: "fixed",
    },
    {
      item: "修理費(実費)",
      layer: 3,
      src: "修理伝票・請求書",
      how: "車番・金額をOCR/CSV取込。標準原価とは別フィールドで保持",
      status: "agree",
    },
  ] as const;

const QUESTIONS: readonly (readonly [string, string])[] = [
  ["車楽のデータ出力手段(CSV/API/画面のみ)", "層①の接続方式が確定"],
  ["燃料集計Excelの1次ソースと作成手順", "層③の2項目を自動化できるか決まる"],
  ["給与ソフトの製品名と出力形式", "給与取込・福利厚生の自動算出が確定"],
  ["現状の月次工数の実測(入力・分析)", "効果測定の基準値が確定"],
  ["層③として残す項目の最終合意", "ホームのToDo設計が確定"],
  ["修繕費の「推計」と「実費」の分離への同意", "実力損益が出せるようになる"],
  ["異常検知の閾値感覚(例月の何倍で疑うか)", "異常値チェックの検知ルールを調整"],
  ["レポート配信先(Slackか既存Kintoneか)", "月次レポートの届け先が決まる"],
  ["締め確定の運用(誰が・いつ・遡及修正ルール)", "権限と監査ログの仕様が確定"],
  ["遊休車9台の扱い(処分・予備の方針)", "ダッシュボードでの表現が決まる"],
] as const;

const STEP_FLOW = [
  {
    num: "01 — 自動で入る",
    title: "デジタコ・ETC・車楽の売上",
    desc: "すでに連携済みのデータ。人は何もしない。",
  },
  {
    num: "02 — 入力から連鎖して決まる",
    title: "保険・税・賞与・標準原価・管理費・損益",
    desc: "車番・運転者・稼働Kmが決まると、マスタから自動計算。",
  },
  {
    num: "03 — 原票を自動で読む",
    title: "燃料・給与・修理費・単価・例外",
    desc: "入力ではなく、ファイル取込と要確認の判断だけにする。",
  },
] as const;

const FLOW_TREE: readonly { depth: number; text: string }[] = [
  { depth: 0, text: "月次シート作成(自動)" },
  { depth: 1, text: "車両マスタ → 保険・税・リース・配賦単価が全車に即時セット" },
  { depth: 2, text: "[運転者名] 確定 → 賞与(規程)・給与枠(前月参照)がセット" },
  { depth: 2, text: "[稼働Km] 流入 → 車検・タイヤ標準原価/燃費を自動計算" },
  { depth: 2, text: "[売上] 流入 → 一般管理費(×16.9%)を自動計算" },
  { depth: 2, text: "[道路使用料] 流入 → 高速割引(×0.356) → 運行費計" },
  { depth: 3, text: "上流の確定ごとに → 損益・利益率・全社集計・対前年を即時再計算" },
  { depth: 4, text: "再計算のたびに → 異常検知 → 異常値チェックにカード生成" },
];

export default async function LogicPage() {
  const session = await getServerSession();
  if (!session) redirect("/sign-in");

  const pendingCount = MAP.filter((r) => r.status !== "fixed").length;

  return (
    <>
      <PageHead
        kind="spec"
        title="データ設計・自動化方針"
        lead="収支表の各項目がどこから来て、どう決まるかの一覧です。「確定」以外はヒアリングで詰める項目です。"
      />

      <section className="grid gap-3 lg:grid-cols-3">
        {STEP_FLOW.map((s) => (
          <div key={s.num} className="rounded-xl border border-line bg-white p-5">
            <p className="text-[11px] font-semibold text-brand-deep">{s.num}</p>
            <p className="mt-1.5 text-sm font-bold text-ink">{s.title}</p>
            <p className="mt-1 text-xs text-ink-muted">{s.desc}</p>
          </div>
        ))}
      </section>

      <section className="mt-5 rounded-xl border border-line bg-white">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-5 py-3">
          <h2 className="text-sm font-bold text-ink">項目別の接続マップ</h2>
          <p className="text-xs text-ink-muted">
            {MAP.length}項目中 {pendingCount}項目がヒアリングで確定待ち
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-max border-collapse text-xs">
            <thead>
              <tr className="border-b border-line bg-subtle text-ink-muted">
                <th className="px-3 py-2 text-left font-medium">収支表の項目</th>
                <th className="px-3 py-2 text-left font-medium">1次ソース</th>
                <th className="px-3 py-2 text-left font-medium">決まり方</th>
                <th className="px-3 py-2 text-left font-medium">状態</th>
              </tr>
            </thead>
            <tbody>
              {([1, 2, 3] as const).map((layer) => (
                <Fragment key={`layer-${layer}`}>
                  <tr className="border-b border-line bg-brand-soft/60">
                    <td colSpan={4} className="px-3 py-2 text-[11px] font-semibold text-brand-deep">
                      {LAYER_HEAD[layer]}
                    </td>
                  </tr>
                  {MAP.filter((r) => r.layer === layer).map((r) => (
                    <tr key={r.item} className="border-b border-line align-top">
                      <td className="min-w-[12rem] px-3 py-2 font-semibold text-ink">{r.item}</td>
                      <td className="min-w-[11rem] px-3 py-2 text-ink-muted">{r.src}</td>
                      <td className="min-w-[16rem] px-3 py-2 text-ink-muted">{r.how}</td>
                      <td className="whitespace-nowrap px-3 py-2">
                        <span
                          className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${STATUS_LABEL[r.status].className}`}
                        >
                          {STATUS_LABEL[r.status].label}
                        </span>
                      </td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mx-5 my-4 rounded-md border border-caution-border bg-caution-soft px-3 py-2 text-xs leading-relaxed text-ink">
          原則: <strong>集計・損益などの下流の値は手入力できない構造</strong>
          にします(Excelで起きた年間集計への転記漏れを仕組みごと根絶)。
        </div>
        <details className="border-t border-line">
          <summary className="cursor-pointer px-5 py-3 text-xs font-semibold text-brand-deep">
            連鎖反映の流れ(入力が決まると何が決まるか)
          </summary>
          <div className="px-5 pb-5">
            {FLOW_TREE.map((n) => (
              <div
                key={n.text}
                className="mt-1.5 border-l-2 border-line pl-3 text-xs text-ink"
                style={{ marginLeft: `${n.depth * 1.1}rem` }}
              >
                {n.text}
              </div>
            ))}
          </div>
        </details>
      </section>

      <section className="mt-5 rounded-xl border border-line bg-white">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-5 py-3">
          <h2 className="text-sm font-bold text-ink">
            ヒアリングで確定させること({QUESTIONS.length}件)
          </h2>
          <p className="text-xs text-ink-muted">この画面を見ながら一緒に確認します</p>
        </div>
        <ul>
          {QUESTIONS.map(([q, effect], i) => (
            <li
              key={q}
              className="flex items-start gap-3 border-b border-line px-5 py-3 text-xs last:border-b-0"
            >
              <span className="num shrink-0 font-bold text-ink-muted">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="min-w-0 flex-1">
                <span className="text-ink">{q}</span>
                <span className="ml-1 text-ink-muted">→ {effect}</span>
              </span>
              <span className="shrink-0 text-ink-muted">未確定</span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
