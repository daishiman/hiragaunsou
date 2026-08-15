/**
 * 選んだ改善要望を Claude Code へ渡すときの「何をするか」の決め方。
 *
 * ここは通信も保存もしない。何件を新しく発行し、何件を版上げし、何件は何もしないかを
 * 先に全部決めてから実行する。押す前に内訳を見せるためであり、
 * 「押してみないと何が起きるか分からない」操作にしないため。
 *
 * 冪等であることが一番の関心。同じものを2回押しても、同時に押しても、
 * 通信が切れて再実行されても、指示文が2つにならないこと。3段で守る。
 *   1. ここ (計画) … 内容が変わっていない件は実行対象にしない
 *   2. 保存 (repository) … 発行の権利を1人だけが取る (リース)
 *   3. DB … improvement_instruction の主キーが request_id
 * 1だけでは同時に走った2つが両方発行になる。3だけでは版が競って上書きし合う。
 * 3段そろって初めて「1つの要望に指示文は1つ」が保たれる。
 */

import type { Instruction } from "./improvementInstruction";
import { improvementStatusLabel, type ImprovementStatus } from "./improvement";
import { publishExclusionReason } from "./improvementLifecycle";

/* ───────────────────────── 保存されている指示文の状態 ───────────────────────── */

/** DB に持つ状態。表示用の「対応完了」は要望そのものの状況から導くので、ここには持たない。 */
export const INSTRUCTION_STATES = ["published", "fetched", "withdrawn"] as const;
export type InstructionState = (typeof INSTRUCTION_STATES)[number];

export function isInstructionState(value: string): value is InstructionState {
  return (INSTRUCTION_STATES as readonly string[]).includes(value);
}

/** 1件の指示文について保存している値。行が無ければ未発行。 */
export interface StoredInstruction {
  version: number;
  hash: string | null;
  state: InstructionState;
  syncedFields: string | null;
  publishedAt: Date | null;
  fetchedAt: Date | null;
}

/* ───────────────────────── 一覧に出す状態 ───────────────────────── */

export type InstructionDisplayState =
  | "none"
  | "published"
  | "outdated"
  | "fetched"
  | "done"
  | "excluded";

const DISPLAY_LABEL: Record<InstructionDisplayState, string> = {
  none: "未発行",
  published: "発行済み",
  outdated: "更新あり",
  fetched: "取込済み",
  done: "対応完了",
  excluded: "対象外",
};

export function instructionStateLabel(state: InstructionDisplayState): string {
  return DISPLAY_LABEL[state];
}

/**
 * 一覧の1行に出す状態を決める。
 *
 * 「更新あり」は内容の指紋ではなく時刻で見る。一覧の判定のために全件の
 * 診断情報を読み直すのは重すぎるため。実際に発行するかどうかは、実行時に
 * 指紋で厳密に判定する (変わっていなければ何も起きない)。
 */
export function displayStateOf(row: {
  status: ImprovementStatus;
  archivedAt: Date | null;
  updatedAt: Date;
  instruction: StoredInstruction | null;
}): InstructionDisplayState {
  if (row.status === "done") return "done";
  if (publishExclusionReason(row) !== null) return "excluded";
  const i = row.instruction;
  if (!i || i.state === "withdrawn") return "none";
  if (i.publishedAt !== null && row.updatedAt.getTime() > i.publishedAt.getTime()) return "outdated";
  return i.state === "fetched" ? "fetched" : "published";
}

/* ───────────────────────── 内容の指紋 ───────────────────────── */

/**
 * 指示文の指紋。前回と同じなら版を上げない。
 *
 * 中身そのものを比べる手もあるが、要望1件あたり数十KBになる。
 * 変わったかどうかだけ分かればよいので指紋にする。
 */
export async function instructionContentHash(instruction: Instruction): Promise<string> {
  const source = `${instruction.title}\n\n${instruction.markdown}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
  return Array.from(new Uint8Array(digest), (v) => v.toString(16).padStart(2, "0")).join("");
}

/* ───────────────────────── 発行した時点の控え ───────────────────────── */

/**
 * 最後に発行した時点の値。次に版を上げるとき、何が変わったかを書くために持つ。
 * 指紋だけでは「変わった」ことしか分からない。
 */
export interface SyncedFields {
  status: ImprovementStatus;
  handledNote: string | null;
  screenLabel: string;
  archived: boolean;
}

export function syncedFieldsOf(input: {
  status: ImprovementStatus;
  handledNote: string | null;
  screenLabel: string;
  archivedAt: Date | null;
}): SyncedFields {
  return {
    status: input.status,
    handledNote: input.handledNote,
    screenLabel: input.screenLabel,
    archived: input.archivedAt != null,
  };
}

export function parseSyncedFields(raw: string | null): SyncedFields | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<SyncedFields>;
    if (typeof v.status !== "string" || typeof v.screenLabel !== "string") return null;
    return {
      status: v.status as ImprovementStatus,
      handledNote: typeof v.handledNote === "string" ? v.handledNote : null,
      screenLabel: v.screenLabel,
      archived: v.archived === true,
    };
  } catch {
    return null;
  }
}

/**
 * 前の版から何が変わったかの一言。
 *
 * 指示文の本文は最新に置き換わる。それだけだと「何が変わったのか」が消えるので、
 * 変更点を管理画面と発行の記録に残す (Claude Code にも冒頭で読ませる)。
 */
export function changeSummaryText(
  before: SyncedFields | null,
  after: SyncedFields,
  actorName: string,
): string {
  const changes: string[] = [];
  if (!before) {
    changes.push("- 管理画面の内容に合わせて指示文を作り直しました。");
  } else {
    if (before.status !== after.status) {
      changes.push(
        `- 状況: ${improvementStatusLabel(before.status)} → **${improvementStatusLabel(after.status)}**`,
      );
    }
    if ((before.handledNote ?? "") !== (after.handledNote ?? "")) {
      const next = after.handledNote?.trim();
      changes.push(next ? `- 対応メモ: ${next}` : "- 対応メモ: （消しました）");
    }
    if (before.archived !== after.archived) {
      changes.push(after.archived ? "- 廃棄しました" : "- 廃棄から戻しました");
    }
    if (before.screenLabel !== after.screenLabel) {
      changes.push(`- 画面: ${before.screenLabel} → ${after.screenLabel}`);
    }
    if (changes.length === 0) changes.push("- 内容を最新に更新しました。");
  }
  return [...changes, `更新した人: ${actorName || "管理者"}`].join("\n");
}

/* ───────────────────────── 何をするかの計画 ───────────────────────── */

export type InstructionSyncKind = "publish" | "revise" | "skip" | "excluded";

export interface InstructionSyncInput {
  id: string;
  screenLabel: string;
  status: ImprovementStatus;
  archivedAt: Date | null;
  instruction: StoredInstruction | null;
  /** 今回の内容の指紋。 */
  nextHash: string;
}

export interface InstructionSyncPlanItem {
  id: string;
  screenLabel: string;
  kind: InstructionSyncKind;
  /** 実行後に何版になるか (何もしないなら現在の版)。 */
  version: number;
  /** その扱いになった理由。画面にそのまま出す。 */
  reason: string;
}

export interface InstructionSyncPlan {
  items: InstructionSyncPlanItem[];
  publish: number;
  revise: number;
  skip: number;
  excluded: number;
}

export function planInstructionSync(rows: InstructionSyncInput[]): InstructionSyncPlan {
  const items = rows.map((row): InstructionSyncPlanItem => {
    const base = { id: row.id, screenLabel: row.screenLabel };
    const excluded = publishExclusionReason(row);
    if (excluded) {
      return { ...base, kind: "excluded", version: row.instruction?.version ?? 0, reason: excluded };
    }

    const i = row.instruction;
    if (!i || i.state === "withdrawn") {
      return {
        ...base,
        kind: "publish",
        version: (i?.version ?? 0) + 1,
        reason:
          i && i.state === "withdrawn"
            ? "取り下げていた指示文を、新しい版で出し直します"
            : "指示文を新しく発行します",
      };
    }
    if (i.hash !== null && i.hash === row.nextHash) {
      return {
        ...base,
        kind: "skip",
        version: i.version,
        reason: `v${i.version} から内容が変わっていません`,
      };
    }
    return {
      ...base,
      kind: "revise",
      version: i.version + 1,
      reason: `内容が変わったので v${i.version} → v${i.version + 1} に更新します`,
    };
  });

  return {
    items,
    publish: items.filter((i) => i.kind === "publish").length,
    revise: items.filter((i) => i.kind === "revise").length,
    skip: items.filter((i) => i.kind === "skip").length,
    excluded: items.filter((i) => i.kind === "excluded").length,
  };
}

/** 確認ダイアログに出す一言。押す前に何が起きるかが1行で分かるようにする。 */
export function planSummaryText(plan: InstructionSyncPlan): string {
  const parts = [
    `新しく発行 ${plan.publish}件`,
    `内容を更新 ${plan.revise}件`,
    `変更なしのため何もしない ${plan.skip}件`,
  ];
  if (plan.excluded > 0) parts.push(`対象外 ${plan.excluded}件`);
  return parts.join(" / ");
}
