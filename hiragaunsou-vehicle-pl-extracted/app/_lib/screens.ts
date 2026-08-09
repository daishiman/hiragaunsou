import { hasPermission, type Permission } from "../../src/domain/rules/permissions";

/**
 * 画面の情報設計の唯一の定義。
 *
 * ここ1ファイルだけを直せば、以下すべてに同じ内容が反映される。
 *   - サイドバーのグループ・並び順・項目名・ホバー説明 (app/_lib/navigation.ts が導出)
 *   - 各画面のページ見出し・リード文・種別バッジ (app/_components/ScreenHeader.tsx が描画)
 *   - 各画面の「この画面ですること / ここでは見ないこと / 次にどこへ行くか」
 *   - 毎月の締めの工程順と、前の工程・次の工程への導線
 *
 * 画面ごとに文言を書き散らすと、同じ画面をサイドバーでは「チェック」、
 * ページの見出しでは「収支表のチェック(業務フロー STEP7)」と呼ぶような食い違いが起きる。
 * 呼び名も説明も、この表の1行が正となる。
 *
 * 画面を1枚足すときにやること: この配列に1件足すだけ。ページ側は
 * <ScreenHeader screen="/新しい画面" /> を書けば見出し・リード・役割説明が揃う。
 */

/** ページ種別バッジの色分けキー。サイドバーのグループ見出しとも対応する。 */
export type ScreenKind = "analysis" | "ops" | "data" | "master" | "spec" | "tool";

/** サイドバーのグループID。並び順は SCREEN_GROUPS の定義順。 */
export type ScreenGroupId =
  | "analysis"
  | "monthly"
  | "result"
  | "master"
  | "spec"
  | "account"
  | "reflect";

/**
 * サイドバーに出す件数バッジの種類。
 *
 * 「その数字が無いと、画面を開くまで分からないことがあるか?」を満たすものだけを置く。
 * anomaly(未判定の件数)は「まだ手が残っているか」が開かずに分かる唯一の手がかりなので残す。
 * かつてあった registration(登録済み台数)は、見ても次の行動が変わらないため廃止した。
 */
export type ScreenBadge = "anomaly";

/**
 * そのグループをどこに置くか。
 *   sidebar — 常時サイドバーに出す。毎月の締めで何度も行き来する業務の画面。
 *   account — サイドバー下部のユーザー名から開くメニューに入れる。
 *             月1回も開かない運用・設定・仕様書の画面。常時見えていても選択肢を増やすだけで、
 *             「これが無いと何が分からないか」に答えられない。
 */
export type ScreenPlacement = "sidebar" | "account";

/** 「ここでは見ないこと」「次にすること」で使う一言 + 行き先 */
export interface ScreenPointer {
  /** 業務の言葉で書いた一文 */
  text: string;
  /** 行き先。同じ画面内で完結する説明ならば省略する */
  href?: string;
  /** リンクに出す短い名前。省略時は行き先の画面名を使う */
  linkLabel?: string;
}

export interface ScreenDef {
  /** 画面のパス。動的ルートは先頭部分だけを書く (例: /vehicle) */
  href: string;
  /** サイドバー・パンくずに出す短い名前 */
  label: string;
  /** ページ見出し(h1)。サイドバー名より少し詳しくてよい */
  title: string;
  /** サイドバーのホバー説明。1行で読み切れる長さにする */
  desc: string;
  /** ページ見出しの下に出す説明。「何を見て何をする画面か」を1〜2文で */
  lead: string;
  /** この画面ですること。動詞で終える */
  does: string;
  /** ここでは見ない/できないこと。重複して見える隣の画面を必ず名指しする */
  notHere?: ScreenPointer;
  /** この画面が終わったら次にどこへ行くか */
  next?: ScreenPointer;
  group: ScreenGroupId;
  kind: ScreenKind;
  /**
   * 毎月の締めの工程順 (1始まり)。持っている画面だけが
   * 「毎月の締め n/5」「前の工程 / 次の工程」の導線を出す。
   */
  flowOrder?: number;
  badge?: ScreenBadge;
  /**
   * この画面を開くのに要る権限。省略時はログインのみで開ける。
   * ページ側の checkAccess と同じ基準をここにも持ち、権限が無い人には
   * サイドバーにそもそも出さない(押しても理由なくホームへ戻される状態を作らない)。
   */
  permission?: Permission;
  /** サイドバーに出さない画面 (一覧から辿る詳細画面など) */
  hiddenFromNav?: boolean;
}

export const SCREEN_GROUPS: readonly {
  id: ScreenGroupId;
  label: string;
  kind: ScreenKind;
  placement: ScreenPlacement;
}[] = [
  { id: "analysis", label: "儲かっているかを見る", kind: "analysis", placement: "sidebar" },
  { id: "monthly", label: "毎月の締め（この順に進む）", kind: "ops", placement: "sidebar" },
  { id: "result", label: "できあがった収支表", kind: "data", placement: "sidebar" },
  { id: "master", label: "計算の基準（先に登録しておく）", kind: "master", placement: "sidebar" },
  // 読むだけの仕様書。毎月の作業では開かないので、常時サイドバーに置かず
  // ユーザー名から開くメニューへ入れる (置き場所の判断は docs/design-system.md §11-9)。
  { id: "spec", label: "仕組みの説明", kind: "spec", placement: "account" },
  // 自分のアカウント・利用者の管理・APIキー・取込の後始末。いずれも業務ではなく運用の画面で、
  // 月に1回も開かない。常時見せると選択肢だけが増えるため、ユーザー名のメニューに集約する。
  { id: "account", label: "アカウント・管理", kind: "tool", placement: "account" },
  // 依頼者の指示: 「直した内容の反映」は率マスタ・車両マスタ・運転者マスタとは性質が違う
  // (マスタを直す画面ではなく、直した結果を締めた月へ反映するか決める画面) ため一番下に置く。
  { id: "reflect", label: "直した内容の反映（最後に確認）", kind: "master", placement: "sidebar" },
] as const;

export const KIND_LABELS: Record<ScreenKind, string> = {
  analysis: "分析",
  ops: "毎月の締め",
  data: "できあがった収支表",
  master: "計算の基準",
  spec: "仕組みの説明",
  tool: "設定・管理",
};

/**
 * 画面の定義。配列の順序がそのままサイドバーの並び順になる
 * (グループ内の並びはこの配列順、グループ同士の並びは SCREEN_GROUPS 順)。
 */
export const SCREENS: readonly ScreenDef[] = [
  // ── 儲かっているかを見る ───────────────────────────────
  {
    href: "/dashboard",
    label: "ダッシュボード（期間指定）",
    title: "経営ダッシュボード（期間を指定して見る）",
    desc: "開始月と終了月を指定して、その期間の損益・売上・赤字車両を見る",
    lead: "開始月と終了月を選ぶと、その期間の損益・売上・赤字車両・1kmあたり原価をまとめて表示します。",
    does: "見たい期間を自分で決めて、会社全体の損益を見る",
    notHere: {
      text: "車両1台ごとの内訳は出しません。1台ずつ見るときは月次収支表へ。",
      href: "/grid",
      linkLabel: "月次収支表",
    },
    next: {
      text: "赤字の車両が出ていたら、原因の型で分けて打ち手を決めます。",
      href: "/deficit",
      linkLabel: "赤字の理由",
    },
    group: "analysis",
    kind: "analysis",
    permission: "view",
  },
  {
    href: "/deficit",
    label: "赤字の理由",
    title: "赤字の理由（原因を3つに分ける）",
    desc: "赤字の車両を原因の型で3つに分け、打ち手に繋げる",
    lead: "赤字の車両を「突発修繕型」「単価・効率型」「遊休・低稼働型」の3つに分けて、打ち手の当てやすい形にします。",
    does: "赤字がなぜ出たのかを原因の型で分け、どこから手を付けるか決める",
    notHere: {
      text: "数字の直しはここではできません。直すのは月次収支表です。",
      href: "/grid",
      linkLabel: "月次収支表",
    },
    next: {
      text: "気になる車両は1台の明細で12か月の動きを見ます。",
      href: "/grid",
      linkLabel: "月次収支表",
    },
    group: "analysis",
    kind: "analysis",
    permission: "view",
  },
  {
    href: "/report",
    label: "AI要因分析",
    title: "AI要因分析レポート",
    desc: "損益が動いた理由をAIに文章で要約させる（生成ごとに費用が発生）",
    lead: "損益が動いた理由をAIが文章で要約します。生成のたびに費用が発生するので、必要なときだけ実行してください。",
    does: "損益の動きの理由を、人に説明できる文章にする",
    notHere: {
      text: "毎日の確認にはAIを使いません。数字だけを見るならダッシュボードで足ります。",
      href: "/dashboard",
      linkLabel: "ダッシュボード",
    },
    next: {
      text: "かかった費用は利用状況で確認できます。",
      href: "/usage",
      linkLabel: "利用状況",
    },
    group: "analysis",
    kind: "analysis",
    permission: "report_settings",
  } as ScreenDef,

  // ── 毎月の締め ─────────────────────────────────────
  {
    href: "/",
    label: "ホーム",
    title: "ホーム（今月の進み具合）",
    desc: "今やることを1つだけ案内します。まずはここから",
    lead: "今月の締めがどこまで進んでいるかを表示し、次にやることを1つだけ案内します。",
    does: "今月の締めの進み具合を見て、次に開く画面を1つだけ決める",
    notHere: {
      text: "数字そのものはここでは直しません。直すのは各工程の画面です。",
    },
    next: {
      text: "「次にやること」のボタンから、そのまま作業へ進めます。",
    },
    group: "monthly",
    kind: "ops",
  },
  {
    href: "/import",
    label: "データ取込",
    title: "データ取込（ファイルを入れる）",
    desc: "運行実績・売上モニタリスト・給与集計表・完成済み収支表を取り込む",
    lead: "会社のシステムから出した4種類のファイルを、そのまま取り込みます。ファイルの種別と対象年月は中身から自動で判定します。",
    does: "元データのファイルを取り込む",
    notHere: {
      text: "請求書にしか無い金額（燃料費・修繕費・高速料金）はここでは入れません。手入力へ。",
      href: "/manual-entry",
      linkLabel: "手入力",
    },
    next: {
      text: "取り込んだ伝票のうち、判断が要る行を1件ずつ片付けます。",
      href: "/cleansing",
      linkLabel: "データ整形",
    },
    group: "monthly",
    kind: "ops",
    flowOrder: 1,
    permission: "input",
  },
  {
    href: "/cleansing",
    label: "データ整形",
    title: "データ整形（伝票を残すか外すか決める）",
    desc: "取り込んだ売上の伝票を1件ずつ、残す・付け替える・外すで判断する",
    lead: "取り込んだ売上の伝票のうち、傭車・2重計上の疑い・諸口の行を1件ずつ「このまま残す」「正しい車番へ付け替える」「収支計算から外す」で判断します。",
    does: "取り込んだ売上の伝票1行ずつについて、収支表に入れるかどうかを決める",
    notHere: {
      text: "金額そのものはここでは直せません。金額の直しは月次収支表で行います。",
      href: "/grid",
      linkLabel: "月次収支表",
    },
    next: {
      text: "伝票の判断が終わったら、請求書からの金額入力へ進みます。",
      href: "/manual-entry",
      linkLabel: "手入力",
    },
    group: "monthly",
    kind: "ops",
    flowOrder: 2,
    permission: "view",
  },
  {
    href: "/manual-entry",
    label: "手入力",
    title: "手入力（請求書から金額を入れる）",
    desc: "キリン配分・燃料費・修繕費・タイヤ・高速料金を請求書から入力する",
    lead: "ファイルに入っていない費用を、紙の請求書・レシートを見ながら入力します。Enterで次の欄へ進みます。",
    does: "紙の請求書・レシートにしか無い金額を入れる",
    notHere: {
      text: "取り込んだファイルに入っている数字はここでは入れません。入れ直すならデータ取込へ。",
      href: "/import",
      linkLabel: "データ取込",
    },
    next: {
      text: "入力が終わったら、いつもと違う値が無いかを確認します。",
      href: "/anomaly",
      linkLabel: "チェック",
    },
    group: "monthly",
    kind: "ops",
    flowOrder: 3,
    permission: "input",
  },
  {
    href: "/anomaly",
    label: "チェック（1件ずつ）",
    title: "チェック（いつもと違う値を1件ずつ判定）",
    desc: "いつもと違う値を1件ずつ「入力ミス」か「実績」かを判定する",
    lead: "いつもの月と離れている値を1件ずつ取り上げ、「入力ミス」か「これで正しい実績」かを判定します。過去12か月の推移を見ながら決められます。",
    does: "できあがった数字のうち、いつもと違うものを1件ずつ判定する",
    notHere: {
      text: "残りが全部で何件あるかを見るだけなら、要確認の一覧の方が早く分かります。",
      href: "/todo",
      linkLabel: "要確認の一覧",
    },
    next: {
      text: "判定が終わったら、完成した収支表を確認して月を確定します。",
      href: "/grid",
      linkLabel: "月次収支表",
    },
    group: "monthly",
    kind: "ops",
    flowOrder: 4,
    badge: "anomaly",
    permission: "view",
  },
  {
    href: "/todo",
    label: "要確認の一覧（まとめて）",
    title: "要確認の一覧（残っているものをまとめて見る）",
    desc: "チェックで未判定のものを、種類をまたいで一覧で見る",
    lead: "チェックでまだ判定していない項目を一覧にしたものです。判定する中身はチェックと同じで、見せ方だけが違います。",
    does: "未判定の項目が全部でいくつ残っているかを一覧で見る",
    notHere: {
      text: "1件ずつ順番に、過去の推移を見ながら判定したいときはチェックへ。中身は同じものです。",
      href: "/anomaly",
      linkLabel: "チェック",
    },
    next: {
      text: "残りが0件になったら、月次収支表で確定します。",
      href: "/grid",
      linkLabel: "月次収支表",
    },
    group: "monthly",
    kind: "ops",
    permission: "view",
  },

  // ── できあがった収支表 ────────────────────────────────
  {
    href: "/grid",
    label: "月次収支表（1か月・車両ごと）",
    title: "月次収支表（1か月ぶんを車両ごとに見る）",
    desc: "選んだ1か月を車両1台ずつ51項目で見る。直し・確定・書き出しもここ",
    lead: "選んだ1か月を、車両1台ずつ51項目で表示します。数字の直し、月の確定、CSVでの書き出しもこの画面で行います。",
    does: "1か月ぶんの完成した表を確認し、直して、月を確定する",
    notHere: {
      text: "1年ぶんの合計や前の年との比較は出しません。年で見るときは年間集計へ。",
      href: "/annual",
      linkLabel: "年間集計・対前年",
    },
    next: {
      text: "確定したら、1年の流れと前年との差を確認します。",
      href: "/annual",
      linkLabel: "年間集計・対前年",
    },
    group: "result",
    kind: "data",
    flowOrder: 5,
    permission: "view",
  },
  {
    // 収支表から開く印刷用の記録。サイドバーには出さないが、幅の判断も含めて
    // 画面の定義はここ1箇所に持つ (ページ側に max-w-* を書かせないため)。
    href: "/grid/report",
    label: "確認の記録（印刷）",
    title: "収支表 確認の記録",
    desc: "確定した月の収支表を、印刷して残せる形にする",
    lead: "確定した月の内容を印刷用にまとめたものです。",
    does: "月の確認結果を紙に残す",
    notHere: {
      text: "数字の直しはできません。直すのは月次収支表です。",
      href: "/grid",
      linkLabel: "月次収支表",
    },
    group: "result",
    kind: "data",
    permission: "view",
    hiddenFromNav: true,
  },
  {
    href: "/annual",
    label: "年間集計（1年・月ごと）",
    title: "年間集計・対前年（1年ぶんを月ごとに見る）",
    desc: "1年ぶんを月単位で合計し、前の年と比べる",
    lead: "1年ぶん（13か月）を月単位で合計し、前の年と比べます。車両1台ごとの内訳はここには出ません。",
    does: "1年の流れと、前の年との差を見る",
    notHere: {
      text: "車両1台ごとの内訳は出しません。1台ずつ見るときは月次収支表へ。",
      href: "/grid",
      linkLabel: "月次収支表",
    },
    next: {
      text: "期間を年度でなく自由に区切って見たいときはダッシュボードへ。",
      href: "/dashboard",
      linkLabel: "ダッシュボード",
    },
    group: "result",
    kind: "data",
    permission: "view",
  },
  {
    href: "/vehicle",
    label: "車両1台の明細",
    title: "車両1台の明細",
    desc: "車両1台の12か月の推移と、単月の数字の直し",
    lead: "この車両1台の経費内訳と12か月の推移です。単月の数字をここで直すこともできます。",
    does: "車両1台の動きを12か月で見て、必要なら単月の数字を直す",
    notHere: {
      text: "全車両を並べて見るときは月次収支表へ。",
      href: "/grid",
      linkLabel: "月次収支表",
    },
    group: "result",
    kind: "data",
    permission: "view",
    hiddenFromNav: true,
  },

  // ── 計算の基準(マスタ) ───────────────────────────────
  {
    href: "/rate-settings",
    label: "率マスタ設定",
    title: "率マスタ設定（全車両に効く率と単価）",
    desc: "一般管理費率・組合割引率・賞与年額など、全車両に一律で効く率と単価",
    lead: "全車両の計算に一律で効く率と単価を設定します。1つ書き換えると、その月の全車両の収支表が動きます。",
    does: "全車両に一律で効く「率」と「単価」を決める",
    notHere: {
      text: "車両1台ごとに違う金額（保険・税・リース）はここでは設定しません。車両マスタ管理へ。",
      href: "/admin/vehicle-master",
      linkLabel: "車両マスタ管理",
    },
    next: {
      text: "締めた月にも反映するかどうかは、直した内容の反映で決めます。",
      href: "/master-changes",
      linkLabel: "直した内容の反映",
    },
    group: "master",
    kind: "master",
    // 1つ書き換えると全車両・全月の収支表が動く値なので、依頼者の判断で管理者だけに絞った。
    permission: "manage_imports",
  },
  {
    href: "/admin/vehicle-master",
    label: "車両マスタ管理",
    title: "車両マスタ管理（車両1台ごとの固定費）",
    desc: "車番・車種・保険・税・リース料の登録先（収支表の固定費の土台）",
    lead: "車番・車種・所属と、毎月同じだけかかる金額（保険・税・リース費・割賦費）を登録します。収支表の固定費はここの登録値がそのまま乗ります。",
    does: "車両1台ごとに、毎月同じだけかかる金額を登録する",
    notHere: {
      text: "どの運転者がどの車に乗るかはここでは決めません。運転者マスタ管理へ。",
      href: "/admin/driver-master",
      linkLabel: "運転者マスタ管理",
    },
    next: {
      text: "同じExcelから、社員Noと車番の対応も登録します。",
      href: "/admin/driver-master",
      linkLabel: "運転者マスタ管理",
    },
    group: "master",
    kind: "master",
    permission: "manage_imports",
  },
  {
    href: "/admin/driver-master",
    label: "運転者マスタ管理",
    title: "運転者マスタ管理（社員Noと車番の対応）",
    desc: "社員Noと車番の対応表（給与を車両へ紐づける土台）",
    lead: "社員Noと車番の対応を登録します。給与集計表の金額をどの車両に乗せるかが、ここで決まります。車両マスタ管理と同じExcelを使います。",
    does: "「この人はこの車」を決める",
    notHere: {
      text: "車両そのものの登録（保険・税・リース）はここではしません。車両マスタ管理へ。",
      href: "/admin/vehicle-master",
      linkLabel: "車両マスタ管理",
    },
    next: {
      text: "締めた月にも反映するかどうかは、直した内容の反映で決めます。",
      href: "/master-changes",
      linkLabel: "直した内容の反映",
    },
    group: "master",
    kind: "master",
    permission: "manage_imports",
  },

  // ── 仕組みの説明 ───────────────────────────────────
  {
    href: "/logic",
    label: "データ設計・自動化方針",
    title: "データ設計・自動化方針（数字の出どころ）",
    desc: "どの数字がどのファイル・どの設定から来るかの一覧",
    lead: "収支表の各項目が、どのファイル・どの設定から来て、どう計算されるかの一覧です。読むための画面で、入力はありません。",
    does: "数字の出どころと決まり方を確認する",
    notHere: {
      text: "実際の数字はここには出ません。数字を見るのは月次収支表です。",
      href: "/grid",
      linkLabel: "月次収支表",
    },
    group: "spec",
    kind: "spec",
  },

  // ── アカウント・管理 ──────────────────────────────────
  {
    href: "/profile",
    label: "マイページ",
    title: "マイページ",
    desc: "自分のアカウント情報を確認・編集する",
    lead: "ログイン中のアカウント情報（名前・メール・パスワード）を確認・編集します。",
    does: "自分のアカウント情報を変える",
    notHere: {
      text: "他の人のロール変更はここではできません。ユーザー管理へ。",
      href: "/admin/users",
      linkLabel: "ユーザー管理",
    },
    group: "account",
    kind: "tool",
  },
  {
    href: "/usage",
    label: "利用状況",
    title: "利用状況（AIの概算費用）",
    desc: "AI（Claude API）利用の概算費用を確認する",
    lead: "AI（Claude API）の利用でかかっている概算費用と、利用者別の内訳です。",
    does: "AIの利用でいくらかかっているかを見る",
    notHere: {
      text: "APIキーの登録・削除はAI設定で行います。",
      href: "/ai-settings",
      linkLabel: "AI設定",
    },
    group: "account",
    kind: "tool",
    permission: "view",
  },
  {
    href: "/ai-settings",
    label: "AI設定",
    title: "AI設定（APIキーの管理）",
    desc: "AI分析に使うAPIキーを管理する",
    lead: "AI要因分析などに使う外部AIプロバイダのAPIキーを管理します。キーは暗号化して保存します。",
    does: "AIに使うAPIキーを登録・削除する",
    notHere: {
      text: "かかった費用の確認は利用状況で行います。",
      href: "/usage",
      linkLabel: "利用状況",
    },
    group: "account",
    kind: "tool",
    permission: "manage_api_keys",
  },
  {
    href: "/admin/users",
    label: "ユーザー管理",
    title: "ユーザー管理（誰が何を使えるか）",
    desc: "全ユーザーのロール変更・アカウント凍結・招待を行う",
    lead: "全ユーザーのロール変更・アカウント凍結（ログイン禁止）・新規ユーザーの招待を行います。",
    does: "誰がどの画面を使えるかを決める",
    notHere: {
      text: "自分自身の名前・メールの変更はマイページで行います。",
      href: "/profile",
      linkLabel: "マイページ",
    },
    group: "account",
    kind: "tool",
    permission: "manage_users",
  },
  {
    href: "/admin/import-batches",
    label: "取込データ管理",
    title: "取込データ管理（取り込んだ履歴と削除）",
    desc: "誤って取り込まれたデータを確認・削除する",
    lead: "全期間・全帳票の取込履歴を確認し、誤って取り込んだデータを削除します。削除は取り消せません。",
    does: "間違えて取り込んだデータを消す",
    notHere: {
      text: "新しく取り込むのはデータ取込です。",
      href: "/import",
      linkLabel: "データ取込",
    },
    group: "account",
    kind: "tool",
    permission: "manage_imports",
  },

  // ── 直した内容の反映(最下部) ────────────────────────────
  {
    href: "/master-changes",
    label: "直した内容の反映",
    title: "直した内容の反映（締めた月へ反映するか決める）",
    desc: "締めた月とマスタの食い違いを確認し、反映するかどうかを決める",
    lead: "マスタを直したあと、すでに締め終わった月の数字を新しい値に置き換えるかどうかを、月ごとに決めます。",
    does: "マスタの直しを、締め終わった月に反映するかどうかを決める",
    notHere: {
      text: "マスタそのものを直す画面ではありません。直すのは率マスタ設定・車両マスタ管理・運転者マスタ管理です。",
      href: "/rate-settings",
      linkLabel: "率マスタ設定",
    },
    next: {
      text: "反映した結果は月次収支表で確認できます。",
      href: "/grid",
      linkLabel: "月次収支表",
    },
    group: "reflect",
    kind: "master",
    permission: "manage_imports",
  },
] as const;

/** パス → 画面定義。ScreenHeader はこれ1本で引く。 */
const BY_HREF = new Map(SCREENS.map((s) => [s.href, s]));

export function getScreen(href: string): ScreenDef | null {
  return BY_HREF.get(href) ?? null;
}

/**
 * パスに対応する画面 (最長一致)。/vehicle/1177 のような詳細ページも拾う。
 */
export function findScreen(pathname: string): ScreenDef | null {
  if (pathname === "/") return getScreen("/");
  const matches = SCREENS.filter((s) => s.href !== "/" && pathname.startsWith(s.href));
  if (matches.length === 0) return null;
  return matches.reduce((best, s) => (s.href.length > best.href.length ? s : best));
}

/** 毎月の締めの工程 (flowOrder を持つ画面) を順番に並べたもの。 */
export const FLOW_SCREENS: readonly ScreenDef[] = SCREENS.filter(
  (s) => s.flowOrder !== undefined,
).sort((a, b) => (a.flowOrder ?? 0) - (b.flowOrder ?? 0));

export interface FlowPosition {
  /** 1始まりの現在位置 */
  index: number;
  total: number;
  prev: ScreenDef | null;
  next: ScreenDef | null;
}

/** 工程の何番目か + 前後の工程。工程に属さない画面は null。 */
export function flowPositionOf(href: string): FlowPosition | null {
  const i = FLOW_SCREENS.findIndex((s) => s.href === href);
  if (i < 0) return null;
  return {
    index: i + 1,
    total: FLOW_SCREENS.length,
    prev: i > 0 ? (FLOW_SCREENS[i - 1] ?? null) : null,
    next: i < FLOW_SCREENS.length - 1 ? (FLOW_SCREENS[i + 1] ?? null) : null,
  };
}

/** ロールで開ける画面だけに絞る。 */
export function visibleScreens(role: string): ScreenDef[] {
  return SCREENS.filter((s) => !s.permission || hasPermission(role, s.permission));
}
