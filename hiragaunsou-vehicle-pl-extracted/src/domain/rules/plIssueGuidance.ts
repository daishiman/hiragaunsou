/**
 * 指摘を「仕様を知らない人でも何をすればよいか分かる言葉」に翻訳する。
 *
 * vehiclePlReview.ts の reason は、システムの内部事情(どのCSVがどう紐付くか)を
 * 知っている人向けに書かれている。ここはその手前の層で、
 *  - いま何が起きているか (実際の数字を差し込んだ1〜2文)
 *  - よくある原因
 *  - 取りうる対応
 * の3点を必ずセットで返す。「値が閾値を超過しています」で終わらせないための場所。
 *
 * 基準値(ふつうはこのくらい)は月ごとに計算するのでここには持たず、呼び出し側が
 * ValueBenchmark として渡す。文言の組み立てだけをここに閉じ込める。
 *
 * Domain層: フレームワーク非依存。
 */

import type { ReviewIssueCode, VehiclePlIssue } from "./vehiclePlReview";

/** 「ふつうはこのくらい」の材料。どれも無い場合があるので全て null 許容。 */
export interface ValueBenchmark {
  /** 同じ車種の中央値 (サンプルが少なければ全車両の中央値) */
  typical: number | null;
  /** typical が何の中央値か (「大型の中央値」「全車両の中央値」) */
  typicalLabel: string;
  /** 先月の同じ車両・同じ項目の値 */
  previous: number | null;
  /** previous が何月か (「2026年6月」) */
  previousLabel: string;
}

export const EMPTY_BENCHMARK: ValueBenchmark = {
  typical: null,
  typicalLabel: "",
  previous: null,
  previousLabel: "",
};

/**
 * 指摘の付いた項目そのものは直せないが、直す入口が別の項目にある場合の対応表。
 *
 * 例: 運送収入は「運賃 − 手数料」の計算結果なので、直すのは運賃側。
 * 燃費も「走行 ÷ 給油」の計算結果で、走行距離の桁違いが原因のことが多い。
 * ここが無いと「取りうる対応」に書いた操作の入口が画面に出ず、
 * 読んだ人が「どこで直すのか」を探すことになる。
 */
export const EDIT_TARGET_FIELD: Partial<Record<ReviewIssueCode, string>> = {
  sales_unlinked: "fare",
  nempi_out_of_range: "km",
};

/** 指摘1件の説明。画面はこの3つをそのまま並べるだけでよい。 */
export interface IssueGuidance {
  /** いま何が起きているか。実際の数字入りの平易な文 */
  summary: string;
  /** よくある原因 */
  causes: readonly string[];
  /** 取りうる対応 */
  actions: readonly string[];
}

/** 区分そのものの意味。語だけでは伝わらないので必ず添える。 */
export const SEVERITY_MEANING = {
  blocking: "このままだと収支表の数字が間違っています",
  warning: "数字としては成立しますが、実態と違うかもしれません",
  info: "知らせるだけです。直さなくてかまいません",
} as const;

function n(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function yen(value: unknown): string {
  return `${Math.round(n(value)).toLocaleString("ja-JP")}円`;
}

function qty(value: unknown, digits = 1): string {
  return n(value).toLocaleString("ja-JP", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/**
 * 桁数を項目ごとに持たずに整える。金額に「1,800,000.0円」と小数点が付くと、
 * 直すべき桁がどこなのか読み取りにくくなる (この画面は桁の話をしている)。
 */
function auto(value: unknown): string {
  const parsed = n(value);
  return qty(parsed, Number.isInteger(parsed) ? 0 : 1);
}

function text(value: unknown, fallback = "未登録"): string {
  const s = value === null || value === undefined ? "" : String(value);
  return s.trim() === "" ? fallback : s;
}

/**
 * 何倍ずれているかを日本語で言う。「1.8倍ほど多い」のように、
 * 比率そのものより「多い/少ない」が先に伝わる語順にする。
 */
function deviationPhrase(value: number, typical: number): string {
  if (typical <= 0 || value <= 0) return "";
  const ratio = value / typical;
  if (ratio >= 1.05) return `${ratio.toFixed(1)}倍ほど多い`;
  if (ratio <= 0.95) return `${(1 / ratio).toFixed(1)}分の1ほど少ない`;
  return "";
}

/**
 * 指摘を平易な説明に翻訳する。
 *
 * row は収支表1行分の値。指摘の種類ごとに「見せると判断できる数字」が違うので、
 * ここで行から必要なものだけ拾って文に差し込む。
 */
export function issueGuidance(
  issue: Pick<VehiclePlIssue, "code" | "field" | "value" | "reason">,
  row: Record<string, number | string | null>,
  benchmark: ValueBenchmark = EMPTY_BENCHMARK,
  fieldLabel = "この項目",
  unit = "",
): IssueGuidance {
  const code: ReviewIssueCode = issue.code;

  switch (code) {
    case "sales_unlinked":
      return {
        summary:
          `この車両は今月 ${n(row.trips).toLocaleString("ja-JP")}回 運行し、` +
          `${qty(row.km)}km 走っていますが、売上が 0円 のままです。` +
          `このままでは経費だけが残り、実際より大きな赤字になります。`,
        causes: [
          "売上の一覧にある車番と、この車両が結び付いていない",
          "今月分の売上データがまだ取り込まれていない",
          "応援・回送など、本当に売上の立たない運行だった",
        ],
        actions: [
          "運賃の金額が分かっていれば、この画面で運賃を直す",
          "取込の画面で、車番の結び付きを直してから取り込み直す",
          "売上0で正しければ「このままでよい」にする",
        ],
      };

    case "payroll_unlinked":
      return {
        summary:
          `この車両は今月 ${n(row.trips).toLocaleString("ja-JP")}回 運行していますが、` +
          `給与が 0円 です。運転者は「${text(row.driver)}」、社員コードは「${text(row.code)}」です。`,
        causes: [
          "運転者の一覧に、この車番が登録されていない",
          "月の途中で運転者が入れ替わり、どの車両の給与か決まらなかった",
          "その運転者の給与データが今月分に含まれていない",
        ],
        actions: [
          "給与の金額が分かっていれば、この画面で給与を直す",
          "運転者の登録画面で、この車番と社員コードを結び付ける",
          "実際に給与の発生しない車両であれば「このままでよい」にする",
        ],
      };

    case "fuel_missing":
      return {
        summary:
          `${qty(row.km)}km 走っているのに、給油の記録がありません。` +
          `燃料費が 0円 のままだと、経費が実際より少なく出ます。`,
        causes: [
          "今月の燃料費をまだ入力していない",
          "給油伝票がこの車番とは別の車番で入力されている",
          "外部給油だけで、社内の給油記録に残っていない",
        ],
        actions: [
          "燃料費の入力画面で、今月の給油量と金額を入れる",
          "他の車番に入っていないか確認する",
        ],
      };

    case "vehicle_master_missing":
      return {
        summary:
          `保険料・自動車税・リース料が3つとも 0円 です。` +
          `車種は「${text(row.type)}」、所属は「${text(row.depot)}」です。` +
          `この3つは車両の登録内容から自動で入るので、3つとも0なのは登録が無いときです。`,
        causes: [
          "この車番が車両の登録一覧に無い",
          "登録はあるが、保険・税・リース料の欄が空のまま",
          "今月から使い始めた車両で、登録がまだ済んでいない",
        ],
        actions: [
          "車両の登録画面で、この車番の保険料・自動車税・リース料を入れる",
          "本当に費用の発生しない車両であれば「このままでよい」にする",
        ],
      };

    case "nempi_out_of_range":
      return {
        summary:
          `燃費が ${qty(row.nempi, 2)}km/L になっています。` +
          `トラックのふつうの燃費は 1〜10km/L です。` +
          `この値は 走行 ${qty(row.km)}km ÷ 給油 ${qty(row.fuelQty)}L で計算しているので、` +
          `どちらかの数字が実態と違います。`,
        causes: [
          "走行距離の桁が違う(1桁多い・少ない)",
          "給油量が一部しか入力されていない、または重複して入っている",
          "月をまたいで給油した分が片方の月に寄っている",
        ],
        actions: [
          "走行距離が違っていれば、この画面で走行距離を直す",
          "給油量が違っていれば、燃料費の入力画面で直す",
          "実態としてこの燃費で合っていれば「このままでよい」にする",
        ],
      };

    case "toll_discount_exceeds":
      return {
        summary:
          `高速道路の割引 ${yen(row.tollDisc)} が、通行料 ${yen(row.toll)} より大きくなっています。` +
          `割引が通行料を超えると、運行費の合計がマイナスになってしまいます。`,
        causes: [
          "割引額を通行料の欄に、通行料を割引の欄に入れ違えている",
          "通行料の実費入力がまだ済んでいない",
          "前月分の割引がまとめて今月に入っている",
        ],
        actions: [
          "高速料金の入力画面で、通行料と割引額を入れ直す",
          "請求書と突き合わせて、どちらの数字が正しいか確認する",
        ],
      };

    case "deficit":
      return {
        summary:
          `今月は ${yen(Math.abs(n(row.profit)))} の赤字です` +
          `(運送収入 ${yen(row.sales)} − 経費 ${yen(row.expense)})。` +
          `入力の抜けは見つからなかったので、実力として赤字の可能性があります。`,
        causes: [
          "稼働が少ない月だった(車検・修理・長期休暇)",
          "大きな修理費や事故費用がこの月に入った",
          "運賃の単価が経費に見合っていない",
        ],
        actions: [
          "この車両の詳しい内訳を見て、どの費目が重いか確かめる",
          "赤字の理由が分かっていれば「このままでよい」にする",
        ],
      };

    case "excel_mismatch":
      return {
        summary:
          `手作業で作っている収支表(Excel)と、このシステムの ${fieldLabel} が食い違っています。` +
          `どちらが正しいかは中身を見ないと決められないため、両方の数字を並べています。`,
        causes: [
          "Excel側で後から手直しした分が、システムに入っていない",
          "システム側の取込に漏れ・重複がある",
          "集計する範囲(日付の区切り)が両者で違う",
        ],
        actions: [
          "Excelが正しければ、この画面でシステムの数字を直す",
          "システムが正しければ「このままでよい」にする",
        ],
      };

    case "anomaly": {
      const value = typeof issue.value === "number" ? issue.value : n(row[issue.field]);
      const phrase =
        benchmark.typical !== null ? deviationPhrase(value, benchmark.typical) : "";
      const head =
        phrase === ""
          ? `${fieldLabel}が ${auto(value)}${unit} で、いつもの月と比べて外れた値になっています。`
          : `${fieldLabel}が ${auto(value)}${unit} です。` +
            `${benchmark.typicalLabel}は ${auto(benchmark.typical)}${unit} なので、${phrase}値です。`;
      return {
        summary: `${head}伝票の入力ミスか、桁が1つ違っている可能性があります。`,
        causes: [
          "桁を1つ多く(少なく)打ってしまった",
          "同じ伝票を二重に取り込んでいる",
          "実際に特別な運行・特別な費用があった月だった",
        ],
        actions: [
          "正しい数字が分かっていれば、この画面で直す",
          "元の伝票と突き合わせて、二重に入っていないか確かめる",
          "この月は本当にこの数字で合っていれば「このままでよい」にする",
        ],
      };
    }

    case "overridden":
      return {
        summary:
          `${fieldLabel}は、人が手で直した数字です。直した理由は「${text(issue.reason, "記録なし")}」です。` +
          `翌月に同じ直しが必要かどうかを判定できるように、印だけ残しています。`,
        causes: ["請求側の調整があった", "取り込んだ数字が実態と違っていた"],
        actions: [
          "この直しでよければ「このままでよい」にする",
          "直しすぎ・直し漏れがあれば、この画面でもう一度直す",
        ],
      };

    case "trailer_unlinked":
      return {
        summary:
          `この行は「${text(row.type)}」、引っぱられる側のトレーラです。` +
          `引っぱるトラクタが登録されていないため、運賃も運転者も付かず、費用だけの赤字行として残っています。`,
        causes: [
          "車両の登録画面で、どのトラクタが引くかを選んでいない",
          "今月からトラクタの組み合わせが変わった",
        ],
        actions: [
          "車両の登録画面で、引っぱるトラクタを選ぶ(選ぶとその行にまとまります)",
          "単独で運用している車両であれば「このままでよい」にする",
        ],
      };

    default:
      return { summary: issue.reason, causes: [], actions: [] };
  }
}

/**
 * 入力された値が「ふつうの範囲」に入っているかの判定。
 *
 * 中央値しか手掛かりが無いので、半分〜2倍を「ふつう」とする。統計的な厳密さより、
 * 桁を1つ間違えた入力(10倍・1/10)を必ず捕まえられることを優先した幅。
 */
export type ValueVerdict = "unknown" | "ok" | "high" | "low";

export interface ValueCheck {
  verdict: ValueVerdict;
  /** 画面にそのまま出す1行。色だけで伝えないための本文。 */
  message: string;
}

export function checkValue(
  value: number,
  benchmark: ValueBenchmark,
  unit = "",
): ValueCheck {
  const typical = benchmark.typical;
  if (typical === null || typical <= 0 || !Number.isFinite(value)) {
    return { verdict: "unknown", message: "" };
  }
  const low = typical * 0.5;
  const high = typical * 2;
  const typicalText = `${benchmark.typicalLabel}は約 ${auto(typical)}${unit}`;
  if (value >= low && value <= high) {
    return { verdict: "ok", message: `この値ならふつうの範囲です(${typicalText})` };
  }
  if (value > high) {
    return { verdict: "high", message: `まだふつうより大きい値です(${typicalText})` };
  }
  return { verdict: "low", message: `まだふつうより小さい値です(${typicalText})` };
}

/**
 * 桁を打ち間違えた疑いがあるときの、直した候補。
 *
 * 中央値との比が 10倍・100倍・1/10・1/100 に近いときだけ返す。
 * 「1.8倍大きい」ような値には候補を出さない(それは桁の問題ではないため)。
 */
export function digitFixCandidate(value: number, benchmark: ValueBenchmark): number | null {
  const typical = benchmark.typical;
  if (typical === null || typical <= 0 || !Number.isFinite(value) || value <= 0) return null;

  const exponent = Math.log10(value / typical);
  const rounded = Math.round(exponent);
  if (rounded === 0 || Math.abs(rounded) > 3) return null;
  // 10^k からの距離。0.3 は「3倍ずれ」までを桁違いとみなさないための線。
  if (Math.abs(exponent - rounded) > 0.3) return null;

  const candidate = value / 10 ** rounded;
  // 小数の丸め誤差で 849999.9999 のような値を出さない。
  return Number(candidate.toPrecision(12));
}
