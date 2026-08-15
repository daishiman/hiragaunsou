import type { ImprovementRepository } from "../../domain/repositories/ImprovementRepository";
import type {
  InstructionTokenRecord,
  InstructionTokenRepository,
} from "../../domain/repositories/InstructionTokenRepository";
import {
  statusChangeRejection,
  tokenActorName,
  tokenCompanyRejection,
} from "../../domain/rules/instructionAccess";
import { applyHandoffEvent, type HandoffEvent } from "../../domain/rules/instructionHandoff";

/**
 * 鍵から届いた出来事 (PR作成・マージ・取り下げ) を1件に反映する。
 *
 * 守りは3段。どれか1つでも欠けると、鍵1本の使い道が広がりすぎる。
 *   1. その鍵が状態を変えてよいか (status:own / status:any)
 *   2. status:own なら、その要望を実際に読み取っているか
 *   3. 会社の境界 (単一テナントのいまは素通り。マルチテナント化時の掛け金)
 *
 * どちらの主体 (手元の開発者か GitHub Actions か) による更新かは、
 * 記録の actorName に必ず残す。後から「CI が勝手に閉じた件」を数えられるようにする。
 */
export interface HandoffDeps {
  repo: ImprovementRepository;
  tokens: InstructionTokenRepository;
}

export type HandoffResult =
  | { ok: true; status: string | null; message: string }
  | { ok: false; status: number; message: string };

export async function recordHandoffEvent(
  requestId: string,
  event: HandoffEvent,
  pr: { url: string; number: number } | null,
  token: InstructionTokenRecord,
  deps: HandoffDeps,
): Promise<HandoffResult> {
  const hasClaim = token.abilities.includes("status:any")
    ? true
    : await deps.tokens.hasClaim(token.id, requestId);
  const denied = statusChangeRejection(token, hasClaim);
  if (denied) return { ok: false, status: 403, message: denied };

  const row = await deps.repo.findById(requestId);
  if (!row) {
    return { ok: false, status: 404, message: "この要望は見つかりません。" };
  }

  // 会社の境界。要望側に会社IDを持たせるのはマルチテナント化のときで、
  // いまは必ず null どうしなので素通りする (呼ぶ場所だけ先に置いてある)。
  const outOfCompany = tokenCompanyRejection(token, null);
  if (outOfCompany) return { ok: false, status: 403, message: outOfCompany };

  // PR の作成・取り下げは、控えを必ず伴う。番号の無い「レビュー待ち」は
  // 管理画面から辿れず、直ったかどうかを確かめる手段が無くなる。
  if ((event === "pr_opened" || event === "pr_merged") && !pr) {
    return {
      ok: false,
      status: 400,
      message: "確認依頼 (PR) の URL が要ります。https://github.com/…/pull/番号 の形で送ってください。",
    };
  }

  const outcome = applyHandoffEvent(row.status, event, pr);
  if (outcome.nextStatus !== null || outcome.pr !== undefined) {
    await deps.repo.recordHandoff(requestId, {
      ...(outcome.nextStatus !== null ? { status: outcome.nextStatus } : {}),
      ...(outcome.pr !== undefined ? { pr: outcome.pr } : {}),
    });
  }

  await deps.repo.appendAudit([
    {
      requestId,
      actorId: null,
      actorName: tokenActorName(token),
      action: "handoff",
      fromStatus: row.status,
      toStatus: outcome.nextStatus,
      reason: outcome.reason,
    },
  ]);
  await deps.tokens.touch(token.id);

  return { ok: true, status: outcome.nextStatus, message: outcome.reason };
}
