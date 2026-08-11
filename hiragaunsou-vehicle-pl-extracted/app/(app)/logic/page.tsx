import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../src/infrastructure/auth/session";
import { createDb } from "../../../src/infrastructure/db/client";
import { D1RateMasterRepository } from "../../../src/infrastructure/db/D1MasterRepository";
import type { RateSettings } from "../../../src/domain/rules/vehiclePlCalculation";
import { resolveWorkingYearMonth } from "../../_lib/workingYearMonth";
import { Disclosure } from "../../_components/Disclosure";
import { ScreenHeader } from "../../_components/ScreenHeader";
import { DataTable, type DataTableColumn } from "../../_components/DataTable";
import { SectionHeading } from "../../_components/SectionHeading";
import { AlertPanel } from "../../_components/AlertPanel";
import { Badge, type BadgeTone } from "../../_components/Badge";
import { Prose } from "../../_components/Card";

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

/** 状態の札。色は意味にだけ使う (Badge の4色から選ぶ)。 */
const STATUS_LABEL: Record<MapStatus, { label: string; tone: BadgeTone }> = {
  fixed: { label: "確定", tone: "neutral" },
  hypo: { label: "仮説 — 要ヒアリング", tone: "caution" },
  agree: { label: "方針合意が必要", tone: "brand" },
};

const LAYER_HEAD: Record<1 | 2 | 3, string> = {
  1: "層① 自動流入 — 1次ソースから自動で入る（人間は触らない）",
  2: "層② 連鎖確定 — 入力とマスタから自動計算で決まる",
  3: "層③ 原票読取 — CSV／Excel／PDFから取得し、例外だけ確認する",
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
      item: "運行回数・稼働時間・走行距離・燃費（分母）",
      layer: 1,
      src: "デジタコ → 車楽",
      how: "車楽からCSVエクスポート定期取込（API有無を初回確認）",
      status: "hypo",
    },
    { item: "運賃・附帯料金・伝票件数", layer: 1, src: "車楽（請求システム）", how: "同上", status: "hypo" },
    { item: "道路使用料", layer: 1, src: "デジタコETC → 車楽", how: "同上", status: "hypo" },
    {
      item: "高速割引料",
      layer: 2,
      src: `道路使用料 × 割引率${rates.tollDiscountRate}`,
      how: "率マスタから自動計算（率は率マスタ設定で変更できます）",
      status: "fixed",
    },
    {
      item: "賞与",
      layer: 2,
      src: `規程（年${manYen(rates.bonusAnnual)}÷12）`,
      how: "運転者が紐づけば自動",
      status: "fixed",
    },
    {
      item: "福利厚生費",
      layer: 2,
      src: "社保合計",
      how: "給与データに含まれるなら自動、なければ率マスタ×給与",
      status: "hypo",
    },
    {
      item: "車検・タイヤ費（標準原価）",
      layer: 2,
      src: "原価計算シート（大型10.7円/km等）",
      how: "率マスタ × 走行距離 で自動",
      status: "fixed",
    },
    {
      item: "自賠責・任意保険／自動車税・重量税",
      layer: 2,
      src: "車両マスタ",
      how: "車検・更新イベント時のみマスタ更新 → 月割自動配賦",
      status: "fixed",
    },
    {
      item: "車両リース・割賦",
      layer: 2,
      src: "車両マスタ（毎月支払額）",
      how: "契約時登録 → 毎月自動計上",
      status: "fixed",
    },
    {
      item: "一般管理費",
      layer: 2,
      src: `売上 × ${percent(rates.adminFeeRate)}（3期平均）`,
      how: "率マスタから自動（当面現行踏襲）",
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
      item: "軽油代（インタンク／外部）・給油量",
      layer: 3,
      src: "給油レシート・外部請求書",
      how: "CSV／Excelは自動取込、PDFはOCRで車番・金額を抽出",
      status: "hypo",
    },
    {
      item: "インタンク単価（円/ℓ）",
      layer: 3,
      src: "月次の仕入単価",
      how: "請求書/仕入データから取得し、全車へ自動反映",
      status: "hypo",
    },
    {
      item: "給与",
      layer: 3,
      src: "ACELINK NX-CE CSV",
      how: "給与集計表（日給者）をファイル取込",
      status: "fixed",
    },
    {
      item: "修理費（実費）",
      layer: 3,
      src: "修理伝票・請求書",
      how: "車番・金額をOCR／CSV取込。標準原価とは別フィールドで保持",
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
    file: "車両別運行実績表（燃費計算）◯◯.csv",
    role: "入力",
    system: "デジタコ ITP-WEBServiceV3",
    用途: "STEP1 運行回数・稼働時間・走行距離。営業所ごとに1ファイル",
  },
  {
    file: "◯年◯月売上モニタリスト.csv",
    role: "入力",
    system: "車楽クラウド",
    用途: "STEP2 運賃・付帯料金・道路使用料を車番別に集計",
  },
  {
    file: "◯給与集計表（日給者）.csv",
    role: "入力",
    system: "ACELINK NX-CE",
    用途: "STEP4 給与・社保合計。車番の列は無い",
  },
  {
    file: "請求書・給油機レシート（紙）",
    role: "入力",
    system: "各社・高速協",
    用途: "STEP3／5／6 燃料費・修繕費・タイヤ・高速料金。手入力画面から入れる",
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

/** 役割の札。分類の名前 (良し悪しが無いもの) と、注意して読むものを Badge の色で分ける。 */
const ROLE_TONE: Record<SourceFileRow["role"], BadgeTone> = {
  入力: "neutral",
  作業台: "brand",
  成果物: "caution",
};

const QUESTIONS: readonly (readonly [string, string])[] = [
  ["車楽のデータ出力手段（CSV／API／画面のみ）", "層①の接続方式が確定"],
  ["燃料集計Excelの1次ソースと作成手順", "層③の2項目を自動化できるか決まる"],
  ["給与ソフトの製品名と出力形式", "給与取込・福利厚生の自動算出が確定"],
  ["現状の月次工数の実測（入力・分析）", "効果測定の基準となる値が確定"],
  ["層③として残す項目の最終合意", "ホームのToDo設計が確定"],
  ["修繕費の「推計」と「実費」の分離への同意", "実力損益が出せるようになる"],
  ["異常検知の閾値感覚（例月の何倍で疑うか）", "異常値チェックの検知ルールを調整"],
  ["レポート配信先（Slackか既存Kintoneか）", "月次レポートの届け先が決まる"],
  ["締め確定の運用（誰が・いつ・遡及修正ルール）", "権限と監査ログの仕様が確定"],
  ["遊休車9台の扱い（処分・予備の方針）", "ダッシュボードでの表現が決まる"],
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
    desc: "車番・運転者・走行距離が決まると、率マスタと車両マスタから自動計算。",
  },
  {
    num: "03 — 原票を自動で読む",
    title: "燃料・給与・修理費・単価・例外",
    desc: "入力ではなく、ファイル取込と要確認の判定だけにする。",
  },
] as const;

function buildFlowTree(rates: RateSettings): readonly { depth: number; text: string }[] {
  return [
    { depth: 0, text: "月次シート作成（自動）" },
    { depth: 1, text: "車両マスタ → 保険・税・リース・配賦単価が全車に即時セット" },
    { depth: 2, text: "[運転者名] 確定 → 賞与（規程）・給与枠（前月参照）がセット" },
    { depth: 2, text: "[走行距離] 流入 → 車検・タイヤ標準原価／燃費を自動計算" },
    { depth: 2, text: `[売上] 流入 → 一般管理費（×${percent(rates.adminFeeRate)}）を自動計算` },
    { depth: 2, text: `[道路使用料] 流入 → 高速割引（×${rates.tollDiscountRate}） → 運行費計` },
    { depth: 3, text: "上流の確定ごとに → 損益・利益率・全社集計・対前年の収支表をすぐ作り直す" },
    { depth: 4, text: "収支表を作り直すたびに → 異常検知 → 異常値チェックにカード生成" },
  ];
}

/**
 * 入れ子の深さぶんの左余白。
 * inline style で marginLeft を書くと、余白の刻みが画面ごとに変わる。Tailwind の目盛りに揃える。
 */
const DEPTH_INDENT = ["ml-0", "ml-4", "ml-8", "ml-12", "ml-16"] as const;

/** 元ファイル一覧の列。1件ずつ読むのではなく、役割どうしを見比べる表なので DataTable にする。 */
const SOURCE_FILE_COLUMNS: readonly DataTableColumn<SourceFileRow>[] = [
  {
    key: "file",
    header: "ファイル（名前の例）",
    cell: (f) => f.file,
    cellClassName: "font-semibold text-ink",
    headClassName: "min-w-[14rem]",
  },
  {
    key: "role",
    header: "役割",
    cell: (f) => <Badge tone={ROLE_TONE[f.role]}>{f.role}</Badge>,
    cellClassName: "whitespace-nowrap",
  },
  {
    key: "system",
    header: "出力元",
    priority: "low",
    cell: (f) => f.system,
    cellClassName: "text-ink-muted",
    headClassName: "min-w-[10rem]",
  },
  {
    key: "use",
    header: "何に使うか",
    cell: (f) => f.用途,
    cellClassName: "wrap text-ink-muted",
    headClassName: "min-w-[18rem]",
  },
];

/** 項目別の接続マップの列。収支表の項目どうしを見比べる表。 */
const MAP_COLUMNS: readonly DataTableColumn<MapRow>[] = [
  {
    key: "item",
    header: "収支表の項目",
    cell: (r) => r.item,
    cellClassName: "font-semibold text-ink",
    headClassName: "min-w-[12rem]",
  },
  {
    key: "src",
    header: "1次ソース",
    priority: "low",
    cell: (r) => r.src,
    cellClassName: "text-ink-muted",
    headClassName: "min-w-[11rem]",
  },
  {
    key: "how",
    header: "決まり方",
    cell: (r) => r.how,
    cellClassName: "wrap text-ink-muted",
    headClassName: "min-w-[16rem]",
  },
  {
    key: "status",
    header: "状態",
    cell: (r) => <Badge tone={STATUS_LABEL[r.status].tone}>{STATUS_LABEL[r.status].label}</Badge>,
    cellClassName: "whitespace-nowrap",
  },
];

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
      <ScreenHeader screen="/logic" />

      {/*
        この画面は「どの数字がどこから来るか」の合意文書で、文章量が多い。
        最初に出すのは見出しだけにして、読みたい章を押したときにその章だけ開く形にした
        (見出しの並びがそのまま目次になる)。文章は1つも減らしていない。
      */}
      <Disclosure summary="全体の考え方（3つの層）">
        <div className="grid gap-3 lg:grid-cols-3">
        {STEP_FLOW.map((s) => (
          <div key={s.num} className="card p-5">
            <p className="text-[11px] font-semibold text-brand-deep">{s.num}</p>
            <p className="mt-1.5 text-sm font-bold text-ink">{s.title}</p>
            <p className="mt-1 text-xs text-ink-muted">{s.desc}</p>
          </div>
        ))}
        </div>
      </Disclosure>

      <Disclosure summary="元になるファイルと、その役割">
        {/*
          T7 §4-1 の質問への答え: ファイルごとの役割と出力元を「見比べる」ための一覧なので表。
          1件を読んで判定する場面ではない。
        */}
        <Prose>列単位の対応は docs/product/data-flow-map.md</Prose>
        <div className="mt-3">
          <DataTable
            caption="元になるファイルと、その役割"
            columns={SOURCE_FILE_COLUMNS}
            rows={SOURCE_FILES}
            rowKey={(f) => f.file}
            empty={
              <Prose>
                元ファイルの一覧が空です。仕様として持っている内容なので、
                空になるのは実装の不具合です。管理者にお知らせください。
              </Prose>
            }
          />
        </div>
        <div className="mt-4 flex flex-col gap-3">
          <AlertPanel tone="caution" title="「運送収支表」は入力ではなく、このシステムが作る成果物です">
            業務フローのSTEP8で、出来上がった収支表を貼り付ける先にあたります。
            ここから数字を読む仕様は作りません（完成した表を元に同じ表を作ることになるため）。
          </AlertPanel>
          <AlertPanel tone="info" title="ファイル名は変わっても構いません。中身で判定します">
            <p>
              上の表のファイル名は目印としての例です（◯の部分は月や営業所名が入ります）。
              どの帳票かは列の見出しで見分け、何年何月分かもファイルの中身から判定します。
            </p>
            <p className="mt-2">
              年月の判定は帳票によって根拠が違います。★車両別収支計算用はシート1行目の見出し
              「令和◯年◯月車両別収支表」、売上モニタリストは「計上日」の日付から判定します。
              給与集計表と車両別運行実績表は<strong>中身に日付が1つも無い</strong>ため自動では決まらず、
              取込のときに何年何月分かを画面で選んでいただきます。
            </p>
          </AlertPanel>
        </div>
      </Disclosure>

      <Disclosure
        summary={`項目別の接続マップ（${MAP.length}項目中 ${pendingCount}項目がヒアリングで確定待ち）`}
      >
        {/*
          T7 §4-1 の質問への答え: 収支表の項目どうしを「1次ソースと決まり方の列で見比べる」ので表。
          層ごとに1つの表に分けているのは、1つの表の中に見出し行を混ぜると
          列見出しの意味が途中で切れて読めなくなるため。
        */}
        {([1, 2, 3] as const).map((layer) => {
          const rows = MAP.filter((r) => r.layer === layer);
          return (
            <div key={`layer-${layer}`}>
              <SectionHeading divider={layer !== 1} action={`${rows.length}項目`}>
                {LAYER_HEAD[layer]}
              </SectionHeading>
              <div className="mt-3">
                <DataTable
                  caption={LAYER_HEAD[layer]}
                  columns={MAP_COLUMNS}
                  rows={rows}
                  rowKey={(r) => r.item}
                  empty={
                    <Prose>
                      この層に当てはまる項目がありません。仕様として持っている内容なので、
                      空になるのは実装の不具合です。管理者にお知らせください。
                    </Prose>
                  }
                />
              </div>
            </div>
          );
        })}

        <div className="mt-4">
          <AlertPanel tone="caution" title="集計・損益などの下流の値は手入力できない構造にします">
            Excelで起きた年間集計への転記漏れを、仕組みごと根絶するためです。
          </AlertPanel>
        </div>

        {/* 生の details を書かず Disclosure に揃える(同じページで2つの折りたたみが別の顔になるのを防ぐ)。 */}
        <Disclosure tone="inline" summary="連鎖反映の流れ（入力が決まると何が決まるか）">
          {FLOW_TREE.map((n) => (
            <div
              key={n.text}
              className={`mt-1.5 border-l-2 border-line pl-3 text-xs text-ink ${DEPTH_INDENT[n.depth] ?? "ml-16"}`}
            >
              {n.text}
            </div>
          ))}
        </Disclosure>
      </Disclosure>

      <Disclosure summary={`ヒアリングで確定させること（${QUESTIONS.length}件）`}>
        {/*
          T7 §4-1 の質問への答え: 1件ずつ読んで「決まったか」を判定していく項目なので表にしない。
          番号付きの一覧のままにする。
        */}
        <Prose>この画面を見ながら一緒に確認します</Prose>
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
              <Badge tone="caution">未確定</Badge>
            </li>
          ))}
        </ul>
      </Disclosure>
    </>
  );
}
