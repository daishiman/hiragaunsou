/**
 * 取り込んだ内容が「前回と異なります」かどうかの判定。
 *
 * ねらいは “気づきにくい所に気づけること” の一点。
 * だから全部の違いを同じ強さで並べない。並べると読まれなくなり、結局気づけない。
 *
 *   出さない : 書き方が違うだけのもの (全角/半角・空白・ゼロ埋め)。裏で吸収し、記録だけ残す
 *   ふつう   : 人事異動や金額改定のような、起きて当たり前の変更
 *   強く出す : 起きたら困るもの (桁違い・未割当の発生・行の消失・文字化け・二重登録)
 *
 * Domain層: フレームワーク非依存。D1・fetch等の外部依存を import しない。
 */

import {
  compareValues,
  looksLikeMojibake,
  normalizeCompareKey,
  normalizeIdKey,
  parseAmountLoose,
  type ValueRelation,
} from "./valueNormalization";

export type ImportDiffSeverity = "critical" | "caution";

export type ImportDiffKind =
  /** 値が変わった (氏名・車種・金額など) */
  | "value_changed"
  /** 車番↔運転者の紐付けが変わった */
  | "link_changed"
  /** 今回から現れた */
  | "row_added"
  /** 前回はあったが今回は無い。消したのか、渡し漏れたのかが区別できない */
  | "row_removed"
  /** 車番が外れて未割当になった */
  | "unassigned"
  /** 前回と桁が違う */
  | "digit_jump"
  /** 文字化けの疑い */
  | "mojibake"
  /** 書き方違いで同じものが2件登録されている */
  | "duplicate_candidate"
  /** もしかして同じ? (1〜2文字違い。自動では同一視しない) */
  | "near_match";

/** 見比べる対象の種類 */
export type ImportDiffTargetKind = "vehicle" | "driver" | "rate";

export interface ImportDiff {
  /** 同じ指摘を指す不変のキー。「確認済み」を覚えておく先 */
  fingerprint: string;
  kind: ImportDiffKind;
  severity: ImportDiffSeverity;
  targetKind: ImportDiffTargetKind;
  /** 突き合わせに使った正規化キー */
  targetKey: string;
  /** 画面に出す対象名 (元の表記のまま) */
  targetLabel: string;
  field: string;
  fieldLabel: string;
  /** 変更前 (元の表記のまま) */
  before: string | null;
  /** 変更後 (元の表記のまま) */
  after: string | null;
  /** 「同じものが2件」「もしかして同じ?」のときの相手 */
  counterpartLabel: string | null;
}

/** 書き方が違うだけとして自動で吸収したもの。画面には出さず、裏で追えるように残す */
export interface AbsorbedDiff {
  targetKind: ImportDiffTargetKind;
  targetKey: string;
  targetLabel: string;
  field: string;
  before: string;
  after: string;
}

/** 比べたい項目1つ */
export interface ComparableField {
  field: string;
  fieldLabel: string;
  value: string | null;
  /**
   * id    : 車番・社員コード (ゼロ埋め・全角を吸収)
   * name  : 人名 (姓名間の空白を吸収)
   * text  : そのほかの文字列
   * amount: 金額 (カンマ・¥・括弧マイナスを吸収し、桁違いを見る)
   */
  kind: "id" | "name" | "text" | "amount";
}

/** 比べたい1件 (車両1台・運転者1名・率1項目) */
export interface ComparableRecord {
  /** 突き合わせの識別子 (元の表記のまま。正規化はこの中で行う) */
  key: string;
  /** 画面に出す名前 */
  label: string;
  fields: ComparableField[];
}

export interface ImportDiffResult {
  diffs: ImportDiff[];
  absorbed: AbsorbedDiff[];
}

/**
 * 「確認済み」を覚えておくためのキー。
 *
 * 値そのものを含める。同じ項目でも別の値に変わったら、それは新しい指摘なので
 * もう一度出す必要がある (「前に1回OKした」は「次も同じでOK」の根拠にならない)。
 * 正規化した値で作るので、書き方だけ変わって出直すことはない。
 */
export function importDiffFingerprint(input: {
  targetKind: string;
  targetKey: string;
  kind: string;
  field: string;
  before: string | null;
  after: string | null;
}): string {
  return [
    input.targetKind,
    input.targetKey,
    input.kind,
    input.field,
    normalizeCompareKey(input.before),
    normalizeCompareKey(input.after),
  ].join("|");
}

/** 前回比で桁が違うか (10倍以上、または1/10以下)。0円との出入りは桁違いとは呼ばない */
export function isDigitJump(before: number | null, after: number | null): boolean {
  if (before == null || after == null) return false;
  const b = Math.abs(before);
  const a = Math.abs(after);
  if (b === 0 || a === 0) return false;
  const ratio = a / b;
  return ratio >= 10 || ratio <= 0.1;
}

function severityOf(kind: ImportDiffKind): ImportDiffSeverity {
  switch (kind) {
    // 起きたら困るもの。見落とすと収支表の数字が静かに壊れる
    case "row_removed":
    case "unassigned":
    case "digit_jump":
    case "mojibake":
    case "duplicate_candidate":
      return "critical";
    // 起きて当たり前のもの。念のため見せるだけ
    case "value_changed":
    case "link_changed":
    case "row_added":
    case "near_match":
      return "caution";
  }
}

function makeDiff(input: Omit<ImportDiff, "fingerprint" | "severity">): ImportDiff {
  return {
    ...input,
    severity: severityOf(input.kind),
    fingerprint: importDiffFingerprint({
      targetKind: input.targetKind,
      targetKey: input.targetKey,
      kind: input.kind,
      field: input.field,
      before: input.before,
      after: input.after,
    }),
  };
}

/** 紐付けを表す項目名。ここが変わると人件費の乗る先が変わるので、値の変更とは別に扱う */
const LINK_FIELDS = new Set(["vehicleNo", "employeeCode"]);

/**
 * 前回の内容と今回の内容を突き合わせる。
 *
 * previous が空 (はじめての取込) のときは、比べる相手がいないので差分を出さない。
 * 「はじめて入れた」を全件「前回と異なります」で埋めても意味がない。
 */
export function detectImportDiffs(input: {
  previous: readonly ComparableRecord[];
  current: readonly ComparableRecord[];
  targetKind: ImportDiffTargetKind;
}): ImportDiffResult {
  const { previous, current, targetKind } = input;
  const diffs: ImportDiff[] = [];
  const absorbed: AbsorbedDiff[] = [];

  const prevByKey = new Map(previous.map((r) => [normalizeIdKey(r.key), r]));
  const currByKey = new Map(current.map((r) => [normalizeIdKey(r.key), r]));

  // 文字化けは前回との比較を待たずに出す。比べる相手も化けていたら気づけない
  for (const record of current) {
    const key = normalizeIdKey(record.key);
    for (const f of record.fields) {
      if (f.value && looksLikeMojibake(f.value)) {
        diffs.push(
          makeDiff({
            kind: "mojibake",
            targetKind,
            targetKey: key,
            targetLabel: record.label,
            field: f.field,
            fieldLabel: f.fieldLabel,
            before: null,
            after: f.value,
            counterpartLabel: null,
          }),
        );
      }
    }
  }

  if (previous.length === 0) {
    return { diffs: [...diffs, ...detectDuplicateCandidates(current, targetKind)], absorbed };
  }

  for (const record of current) {
    const key = normalizeIdKey(record.key);
    const before = prevByKey.get(key);
    if (!before) {
      diffs.push(
        makeDiff({
          kind: "row_added",
          targetKind,
          targetKey: key,
          targetLabel: record.label,
          field: "_row",
          fieldLabel: "登録",
          before: null,
          after: record.label,
          counterpartLabel: null,
        }),
      );
      continue;
    }

    const beforeFields = new Map(before.fields.map((f) => [f.field, f]));
    for (const f of record.fields) {
      const b = beforeFields.get(f.field);
      if (!b) continue;

      if (f.kind === "amount") {
        const pushed = compareAmountField({
          targetKind,
          targetKey: key,
          label: record.label,
          field: f,
          beforeValue: b.value,
        });
        if (pushed.absorbedItem) absorbed.push(pushed.absorbedItem);
        if (pushed.diff) diffs.push(pushed.diff);
        continue;
      }

      // 金額は上で処理済みなので、ここに来る kind は id/name/text のいずれか
      const relation: ValueRelation = compareValues(b.value, f.value, { kind: f.kind });
      if (relation === "same") continue;
      if (relation === "same_after_normalize") {
        // 書き方が違うだけ。騒がずに吸収し、記録だけ残す
        absorbed.push({
          targetKind,
          targetKey: key,
          targetLabel: record.label,
          field: f.field,
          before: b.value ?? "",
          after: f.value ?? "",
        });
        continue;
      }

      // 紐付けが外れて未割当になった場合だけは強く出す
      const becameEmpty = (f.value ?? "") === "" && (b.value ?? "") !== "";
      const kind: ImportDiffKind = LINK_FIELDS.has(f.field)
        ? becameEmpty
          ? "unassigned"
          : "link_changed"
        : "value_changed";

      diffs.push(
        makeDiff({
          kind,
          targetKind,
          targetKey: key,
          targetLabel: record.label,
          field: f.field,
          fieldLabel: f.fieldLabel,
          before: b.value,
          after: f.value,
          counterpartLabel: null,
        }),
      );
    }
  }

  // 前回あって今回無いもの。消したのか渡し漏れたのかは機械では決められないので、必ず人に出す
  for (const record of previous) {
    const key = normalizeIdKey(record.key);
    if (currByKey.has(key)) continue;
    diffs.push(
      makeDiff({
        kind: "row_removed",
        targetKind,
        targetKey: key,
        targetLabel: record.label,
        field: "_row",
        fieldLabel: "登録",
        before: record.label,
        after: null,
        counterpartLabel: null,
      }),
    );
  }

  diffs.push(...detectDuplicateCandidates(current, targetKind));
  return { diffs, absorbed };
}

function compareAmountField(input: {
  targetKind: ImportDiffTargetKind;
  targetKey: string;
  label: string;
  field: ComparableField;
  beforeValue: string | null;
}): { diff: ImportDiff | null; absorbedItem: AbsorbedDiff | null } {
  const { targetKind, targetKey, label, field, beforeValue } = input;
  const before = parseAmountLoose(beforeValue);
  const after = parseAmountLoose(field.value);

  // 金額として同じなら、書き方が違っても差分にしない ("1,234" と "１２３４" と "¥1234")
  if (before.value !== null && after.value !== null && before.value === after.value) {
    if ((beforeValue ?? "") !== (field.value ?? "")) {
      return {
        diff: null,
        absorbedItem: {
          targetKind,
          targetKey,
          targetLabel: label,
          field: field.field,
          before: beforeValue ?? "",
          after: field.value ?? "",
        },
      };
    }
    return { diff: null, absorbedItem: null };
  }

  // 空欄と 0 は別物。空欄になったのは入力漏れかもしれないので見せる
  if (before.blank && after.blank) return { diff: null, absorbedItem: null };

  const kind: ImportDiffKind = isDigitJump(before.value, after.value)
    ? "digit_jump"
    : "value_changed";

  return {
    diff: makeDiff({
      kind,
      targetKind,
      targetKey,
      targetLabel: label,
      field: field.field,
      fieldLabel: field.fieldLabel,
      before: beforeValue,
      after: field.value,
      counterpartLabel: null,
    }),
    absorbedItem: null,
  };
}

/**
 * 同じものが2件登録されていないか。
 *
 * 「書き方が違うだけで正規化すると一致する」ものは二重登録。統合しないと、
 * 片方だけ直して片方が古いまま残る。
 * 「1〜2文字違い」は自動で同じにはせず、確認候補としてだけ出す。
 */
export function detectDuplicateCandidates(
  records: readonly ComparableRecord[],
  targetKind: ImportDiffTargetKind,
): ImportDiff[] {
  const diffs: ImportDiff[] = [];

  // 識別子そのものが正規化すると重なるもの ("001" と "1")
  const byIdKey = new Map<string, ComparableRecord[]>();
  for (const r of records) {
    const key = normalizeIdKey(r.key);
    const list = byIdKey.get(key) ?? [];
    list.push(r);
    byIdKey.set(key, list);
  }
  for (const [key, list] of byIdKey) {
    if (list.length < 2) continue;
    diffs.push(
      makeDiff({
        kind: "duplicate_candidate",
        targetKind,
        targetKey: key,
        targetLabel: list[0]!.label,
        field: "_key",
        fieldLabel: "登録",
        before: list[0]!.key,
        after: list[1]!.key,
        counterpartLabel: list[1]!.label,
      }),
    );
  }

  // 名前が正規化すると重なるもの ("田中 一郎" と "田中一郎")
  const nameFieldOf = (r: ComparableRecord) => r.fields.find((f) => f.kind === "name");
  const byName = new Map<string, ComparableRecord[]>();
  for (const r of records) {
    const nameField = nameFieldOf(r);
    if (!nameField?.value) continue;
    const key = normalizeCompareKey(nameField.value);
    if (key === "") continue;
    const list = byName.get(key) ?? [];
    list.push(r);
    byName.set(key, list);
  }
  for (const [, list] of byName) {
    if (list.length < 2) continue;
    // 識別子まで同じなら上のループで拾っている
    if (normalizeIdKey(list[0]!.key) === normalizeIdKey(list[1]!.key)) continue;
    const a = list[0]!;
    const b = list[1]!;
    diffs.push(
      makeDiff({
        kind: "duplicate_candidate",
        targetKind,
        targetKey: normalizeIdKey(a.key),
        targetLabel: a.label,
        field: nameFieldOf(a)?.field ?? "driverName",
        fieldLabel: nameFieldOf(a)?.fieldLabel ?? "氏名",
        before: nameFieldOf(a)?.value ?? null,
        after: nameFieldOf(b)?.value ?? null,
        counterpartLabel: b.label,
      }),
    );
  }

  return diffs;
}

/**
 * 「もしかして同じ?」の候補。1〜2文字違いの名前どうしを挙げるだけで、決して自動では寄せない。
 *
 * 「田中」と「田仲」は別人でありうる。機械が勝手に同じにすると、
 * 別人の給与が1台の車に乗る。寄せるかどうかは必ず人が決める。
 */
export function detectNearMatches(
  records: readonly ComparableRecord[],
  targetKind: ImportDiffTargetKind,
): ImportDiff[] {
  const named = records
    .map((r) => ({ record: r, field: r.fields.find((f) => f.kind === "name") }))
    .filter((x): x is { record: ComparableRecord; field: ComparableField } => !!x.field?.value);

  const diffs: ImportDiff[] = [];
  for (let i = 0; i < named.length; i++) {
    for (let j = i + 1; j < named.length; j++) {
      const a = named[i]!;
      const b = named[j]!;
      if (normalizeIdKey(a.record.key) === normalizeIdKey(b.record.key)) continue;
      if (compareValues(a.field.value, b.field.value, { kind: "name" }) !== "near") continue;
      diffs.push(
        makeDiff({
          kind: "near_match",
          targetKind,
          targetKey: normalizeIdKey(a.record.key),
          targetLabel: a.record.label,
          field: a.field.field,
          fieldLabel: a.field.fieldLabel,
          before: a.field.value,
          after: b.field.value,
          counterpartLabel: b.record.label,
        }),
      );
    }
  }
  return diffs;
}

/** 確認済みにした指紋を取り除く */
export function excludeAcked(
  diffs: readonly ImportDiff[],
  ackedFingerprints: ReadonlySet<string>,
): ImportDiff[] {
  return diffs.filter((d) => !ackedFingerprints.has(d.fingerprint));
}

/** 強く出すものが先。同じ強さなら対象名で並びを安定させる */
export function sortImportDiffs(diffs: readonly ImportDiff[]): ImportDiff[] {
  const rank = (d: ImportDiff) => (d.severity === "critical" ? 0 : 1);
  return [...diffs].sort(
    (a, b) => rank(a) - rank(b) || a.targetLabel.localeCompare(b.targetLabel, "ja"),
  );
}
