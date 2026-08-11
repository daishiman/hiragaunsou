/**
 * 車両別収支表 作成業務フロー(業務フロー docx 2026-07-28版)の8ステップ定義。
 *
 * 画面はこの定義を唯一の出典にして「現在地・残りの手順・次にやること」を出す。
 * 文言は業務で実際に使われている言葉(車両別運行実績表・売上モニタリスト・高速協 等)をそのまま使い、
 * システム都合の用語に置き換えない。
 *
 * Domain層: フレームワーク非依存。
 */

export type WorkflowStepId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/** その手順を人がどう進めるか */
export type WorkflowStepMode =
  /** CSV/Excelを取り込む (主動線) */
  | "import"
  /** 請求書・レシートを見て入力する */
  | "entry"
  /** 出来上がった表を確認する */
  | "check";

export interface WorkflowStepDefinition {
  id: WorkflowStepId;
  /** 業務フロー docx の見出しそのまま */
  title: string;
  /** 何をするか。1行・業務の言葉で */
  summary: string;
  /** どこから来るデータか (出典システム・帳票名) */
  source: string;
  mode: WorkflowStepMode;
  /** この手順を行う画面 */
  href: string;
  /** docx の「判断基準・補足」。属人的な判断が要る箇所はここに出して迷わせない */
  notes: readonly string[];
  /** 経験則に依存し、まだルール化されていない工程 (docx の黄色枠相当) */
  isJudgementHeavy: boolean;
}

export const WORKFLOW_STEPS: readonly WorkflowStepDefinition[] = [
  {
    id: 1,
    // 実際にはデジタコの運行実績のほか給与集計表・完成済み収支表もこの入口から入れるため、
    // 帳票名そのままの「車両別運行実績表」ではなく「車両実績表等」と呼ぶ(画面の呼び名に合わせる)
    title: "車両実績表等の取り込み",
    summary: "3営業所分の車両別運行実績表(CSV)を取り込む",
    source: "ITP-WEBServiceV3『車両別運行実績表』",
    mode: "import",
    href: "/import?step=1",
    notes: ["3営業所分すべて取り込みます。"],
    isJudgementHeavy: false,
  },
  {
    id: 2,
    title: "売上データの取り込み・整形と車番別集計",
    summary:
      "売上モニタリストを取り込み、傭車・2重計上・諸口を整理してから車番別に集計。キリンの協力金を配賦する",
    source: "車楽クラウド『売上モニタリスト』",
    mode: "import",
    href: "/import?step=2",
    notes: [
      "車番が「88888」のものは傭車。取込時に自動で除外します。",
      "2重計上は過去に888番・10番・5000番で発生実績あり。運転者が「諸口」のデータを手がかりに確認します。",
      "諸口データは内容を確認したうえで、直すか削除します。判定は画面で1クリック、記録は翌月に引き継がれます。",
      "車番別の集計は取込時に自動で行います(手作業のピボット操作は不要)。",
      "キリンの輸送協力金・経営支援金は2等分し、24番・300番の「その他」に入れます(この2台が専属のため)。",
      "他車両もキリン配送に入ることがありますが、スポット運行のため配分対象外です。",
    ],
    isJudgementHeavy: true,
  },
  {
    id: 3,
    title: "燃料費の入力",
    summary: "インタンクの給油量、外部給油の金額・給油量、アドブルーを入力する",
    source: "給油機のレシート / 各社の請求書",
    mode: "entry",
    href: "/manual-entry?step=3",
    notes: [
      "インタンクは車番と給油量だけ入力します(金額はインタンク単価から自動計算)。",
      "外部給油は請求書のとおり車番・給油量・燃料費を入力します。",
      "請求書にアドブルーの記載があれば併せて入力します。",
    ],
    isJudgementHeavy: false,
  },
  {
    id: 4,
    title: "人件費の取り込み",
    summary: "給与集計表(日給者)のCSVを取り込む",
    source: "ACELINK NX-CE『給与集計表(日給者)』",
    mode: "import",
    href: "/import?step=4",
    notes: ["社員コードで運転者マスタと突合し、車番へ紐づけます。"],
    isJudgementHeavy: false,
  },
  {
    id: 5,
    title: "経費(修繕費・タイヤ)の入力",
    summary: "各社の請求書を見て、車番ごとの修繕費とタイヤ代を入力する",
    source: "各社の請求書",
    mode: "entry",
    href: "/manual-entry?step=5",
    notes: [
      "集計は自動で行います(手作業のピボット操作は不要)。",
      "タイヤ代を入力しない車両は、走行距離×単価の標準原価で計算します。",
    ],
    isJudgementHeavy: false,
  },
  {
    id: 6,
    title: "高速料金の入力",
    summary: "高速協の請求書を見て、車番ごとの通行料金と割引額を入力する",
    source: "高速協の請求書",
    mode: "entry",
    href: "/manual-entry?step=6",
    notes: [
      "請求書に割引額の合計が載っていないため、個別の割引額を足し合わせて入力します。画面の合算ツールが使えます。",
      "未入力の車両は、売上モニタリストの通行料金 × 組合割引率で計算します。",
    ],
    isJudgementHeavy: false,
  },
  {
    id: 7,
    title: "収支表のチェック",
    summary: "自動で組み上がった収支表を確認し、異常値を1件ずつ判定する",
    source: "STEP1〜6の入力内容",
    mode: "check",
    href: "/anomaly",
    notes: [
      "Excelの XLOOKUP に相当する突合は自動で行われます。",
      "リース料・割賦支払額に変更があれば、この段階で直します。",
    ],
    isJudgementHeavy: false,
  },
  {
    id: 8,
    title: "運送収支表への転記(完成)",
    summary: "月次の収支表と年間集計を確認して締める",
    source: "STEP7までの確定内容",
    mode: "check",
    href: "/grid",
    notes: [
      "転記作業は不要です。年間集計・対前年は自動で更新されます。",
      "内容を確認したら「この月を確定する」を押して締めます。Excelが必要ならCSVで書き出せます。",
    ],
    isJudgementHeavy: false,
  },
];

export function findWorkflowStep(id: number): WorkflowStepDefinition | undefined {
  return WORKFLOW_STEPS.find((s) => s.id === id);
}
