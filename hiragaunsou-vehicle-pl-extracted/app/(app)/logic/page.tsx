import { Fragment } from "react";
import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../src/infrastructure/auth/session";
import { createDb } from "../../../src/infrastructure/db/client";
import { D1RateMasterRepository } from "../../../src/infrastructure/db/D1MasterRepository";
import type { RateSettings } from "../../../src/domain/rules/vehiclePlCalculation";
import { resolveWorkingYearMonth } from "../../_lib/workingYearMonth";
import { Disclosure } from "../../_components/Disclosure";
import { PageHead } from "../../_components/PageHead";

/**
 * S10 データ設計・自動化方針 (モック view-logic.js に対応)。
 * 「どの数字がどこから来て、どう決まるか」を発注者と合意するための画面。
 * 内容は仕様の合意事項そのものなのでDBではなくコードで保持する(変更履歴はgitに残る)。
 *
 * ただし率そのものは合意事項ではなく運用値なので、文言に埋め込まず rate_master から描く。
 * ここに「16.9%」と直書きされていたせいで、実運用が 17.48% に改定されたあとも
 * この画面だけが古い率を発注者に見せ続けていた。
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

interface MapRow {
  item: string;
  layer: 1 | 2 | 3;
  src: string;
  how: string;
  status: MapStatus;
}

/** 0.1748 → "17.48%"。末尾の余分な0は落とす (17.5% を "17.50%" と書かない) */
function percent(rate: number): string {
  return `${Number((rate * 100).toFixed(4))}%`;
}

/** 400000 → "40万円"。1万円未満の端数が出たら円表記に落とす */
function manYen(yen: number): string {
  return yen % 10000 === 0 ? `${yen / 10000}万円` : `${yen.toLocaleString("ja-JP")}円`;
}

function buildMap(rates: RateSettings): readonly MapRow[] {
  return [
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
      src: `道路使用料 × 割引率${rates.tollDiscountRate}`,
      how: "率マスタから自動計算(率は設定画面で変更可)",
      status: "fixed",
    },
    {
      item: "賞与",
      layer: 2,
      src: `規程(年${manYen(rates.bonusAnnual)}÷12)`,
      how: "運転者が紐づけば自動",
      status: "fixed",
    },
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
      src: `売上 × ${percent(rates.adminFeeRate)}(3期平均)`,
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
  ];
}

/**
 * 元ファイル一覧。実ファイル(data/)を開いて列構成まで確かめた内容だけを載せる。
 * 詳細な列単位の対応は docs/product/data-flow-map.md。
 *
 * 「運送収支表」を出力として最後に置いているのは、これを入力だと取り違えると
 * 「完成した表から数字を読んで同じ表を作る」という循環した仕様になるため。
 */
interface SourceFileRow {
  file: string;
  role: "入力" | "作業台" | "成果物";
  system: string;
  用途: string;
}

const SOURCE_FILES: readonly SourceFileRow[] = [
  {
    file: "車両別運行実績表(燃費計算)◯◯.csv",
    role: "入力",
    system: "デジタコ ITP-WEBServiceV3",
    用途: "STEP1 運行回数・稼働時間・稼働Km。営業所ごとに1ファイル",
  },
  {
    file: "◯年◯月売上モニタリスト.csv",
    role: "入力",
    system: "車楽クラウド",
    用途: "STEP2 運賃・付帯料金・道路使用料を車番別に集計",
  },
  {
    file: "◯給与集計表(日給者).csv",
    role: "入力",
    system: "ACELINK NX-CE",
    用途: "STEP4 給与・社保合計。車番の列は無い",
  },
  {
    file: "請求書・給油機レシート(紙)",
    role: "入力",
    system: "各社・高速協",
    用途: "STEP3/5/6 燃料費・修繕費・タイヤ・高速料金。手入力画面から入れる",
  },
  {
    file: "★車両別収支計算用◯年◯月.xlsx",
    role: "作業台",
    system: "社内Excel",
    用途: "収支表シートが車両マスタ・運転者マスタの元データ。STEP7の結果でもある",
  },
  {
    file: "運送収支表 ◯-◯ ◯月更新.xlsx",
    role: "成果物",
    system: "社内Excel",
    用途: "STEP8の転記先。このシステムが作る側であり、数字を読む先ではない",
  },
] as const;

const ROLE_CLASS: Record<SourceFileRow["role"], string> = {
  入力: "bg-subtle text-ink border-line",
  作業台: "bg-brand-soft text-brand-deep border-transparent",
  成果物: "bg-caution-soft text-ink border-caution-border",
};

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

function buildFlowTree(rates: RateSettings): readonly { depth: number; text: string }[] {
  return [
    { depth: 0, text: "月次シート作成(自動)" },
    { depth: 1, text: "車両マスタ → 保険・税・リース・配賦単価が全車に即時セット" },
    { depth: 2, text: "[運転者名] 確定 → 賞与(規程)・給与枠(前月参照)がセット" },
    { depth: 2, text: "[稼働Km] 流入 → 車検・タイヤ標準原価/燃費を自動計算" },
    { depth: 2, text: `[売上] 流入 → 一般管理費(×${percent(rates.adminFeeRate)})を自動計算` },
    { depth: 2, text: `[道路使用料] 流入 → 高速割引(×${rates.tollDiscountRate}) → 運行費計` },
    { depth: 3, text: "上流の確定ごとに → 損益・利益率・全社集計・対前年を即時再計算" },
    { depth: 4, text: "再計算のたびに → 異常検知 → 異常値チェックにカード生成" },
  ];
}

export default async function LogicPage() {
  const session = await getServerSession();
  if (!session) redirect("/sign-in");

  const { env } = await getCloudflareContext({ async: true });
  const db = createDb(env.DB);
  // 説明に出す率も、いま作業している月のものを見せる(他画面と違う月の率を説明すると読み合わせができない)。
  const rates = await new D1RateMasterRepository(db).getRates(await resolveWorkingYearMonth(db));
  const MAP = buildMap(rates);
  const FLOW_TREE = buildFlowTree(rates);

  const pendingCount = MAP.filter((r) => r.status !== "fixed").length;

  return (
    <>
      <PageHead
        kind="spec"
        title="データ設計・自動化方針"
        lead="各項目がどこから来て、どう決まるかの一覧"
      />

      {/*
        この画面は「どの数字がどこから来るか」の合意文書で、文章量が多い。
        最初に出すのは見出しだけにして、読みたい章を押したときにその章だけ開く形にした
        (見出しの並びがそのまま目次になる)。文章は1つも減らしていない。
      */}
      <Disclosure summary="全体の考え方(3つの層)">
        <div className="grid gap-3 lg:grid-cols-3">
        {STEP_FLOW.map((s) => (
          <div key={s.num} className="rounded-xl border border-line bg-white p-5">
            <p className="text-[11px] font-semibold text-brand-deep">{s.num}</p>
            <p className="mt-1.5 text-sm font-bold text-ink">{s.title}</p>
            <p className="mt-1 text-xs text-ink-muted">{s.desc}</p>
          </div>
        ))}
        </div>
      </Disclosure>

      <Disclosure summary="元になるファイルと、その役割">
        <p className="text-xs text-ink-muted">列単位の対応は docs/product/data-flow-map.md</p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-max border-collapse text-xs">
            <thead>
              <tr className="border-b border-line bg-subtle text-ink-muted">
                <th className="px-3 py-2 text-left font-medium">ファイル(名前の例)</th>
                <th className="px-3 py-2 text-left font-medium">役割</th>
                <th className="px-3 py-2 text-left font-medium">出力元</th>
                <th className="px-3 py-2 text-left font-medium">何に使うか</th>
              </tr>
            </thead>
            <tbody>
              {SOURCE_FILES.map((f) => (
                <tr key={f.file} className="border-b border-line align-top">
                  <td className="min-w-[14rem] px-3 py-2 font-semibold text-ink">{f.file}</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <span
                      className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${ROLE_CLASS[f.role]}`}
                    >
                      {f.role}
                    </span>
                  </td>
                  <td className="min-w-[10rem] px-3 py-2 text-ink-muted">{f.system}</td>
                  <td className="min-w-[18rem] px-3 py-2 text-ink-muted">{f.用途}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 space-y-2 rounded-md border border-caution-border bg-caution-soft px-3 py-2 text-xs leading-relaxed text-ink">
          <p>
            <strong>「運送収支表」は入力ではなく、このシステムが作る成果物です。</strong>
            業務フローのSTEP8で、出来上がった収支表を貼り付ける先にあたります。
            ここから数字を読む仕様は作りません(完成した表を元に同じ表を作ることになるため)。
          </p>
          <p>
            <strong>ファイル名は変わっても構いません。中身で判定します。</strong>
            上の表のファイル名は目印としての例です(◯の部分は月や営業所名が入ります)。
            どの帳票かは列の見出しで見分け、何年何月分かもファイルの中身から判定します。
          </p>
          <p>
            年月の判定は帳票によって根拠が違います。★車両別収支計算用はシート1行目の見出し
            「令和◯年◯月車両別収支表」、売上モニタリストは「計上日」の日付から判定します。
            給与集計表と車両別運行実績表は<strong>中身に日付が1つも無い</strong>ため自動では決まらず、
            取込のときに何年何月分かを画面で選んでいただきます。
          </p>
        </div>
      </Disclosure>

      <Disclosure
        summary={`項目別の接続マップ(${MAP.length}項目中 ${pendingCount}項目がヒアリングで確定待ち)`}
      >
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
        <div className="mt-4 rounded-md border border-caution-border bg-caution-soft px-3 py-2 text-xs leading-relaxed text-ink">
          原則: <strong>集計・損益などの下流の値は手入力できない構造</strong>
          にします(Excelで起きた年間集計への転記漏れを仕組みごと根絶)。
        </div>
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-semibold text-brand-deep">
            連鎖反映の流れ(入力が決まると何が決まるか)
          </summary>
          <div className="mt-2">
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
      </Disclosure>

      <Disclosure summary={`ヒアリングで確定させること(${QUESTIONS.length}件)`}>
        <p className="text-xs text-ink-muted">この画面を見ながら一緒に確認します</p>
        <ul className="mt-2">
          {QUESTIONS.map(([q, effect], i) => (
            <li
              key={q}
              className="flex items-start gap-3 border-b border-line py-2.5 text-xs last:border-b-0"
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
      </Disclosure>
    </>
  );
}
