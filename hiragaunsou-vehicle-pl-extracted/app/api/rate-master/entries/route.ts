import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../../src/infrastructure/auth/accessControl";
import { createDb } from "../../../../src/infrastructure/db/client";
import { D1RateMasterRepository } from "../../../../src/infrastructure/db/D1MasterRepository";
import { masterChangeStack } from "../../../_lib/masterChangeStack";
import { findRateMasterKeyDef, validateRateValue } from "../../../../src/domain/rules/rateMasterCatalog";
import { isSameOriginRequest } from "../../../_lib/assertSameOrigin";
import type { MasterEditInput } from "../../../../src/usecase/steps/applyMasterChange";

/** 率マスタを触れる権限。1件ずつの入口 (/api/rate-master) と同じにする。 */
const RATE_MASTER_PERMISSION = "manage_imports" as const;

function isYearMonth(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

interface RateEditInput {
  key: string;
  /** null なら全期間共通値 */
  yearMonth: string | null;
  /** 画面のどの欄から来たか (保存できなかったときに欄を指し示すために返す) */
  field: string;
  value: number;
}

/**
 * POST /api/rate-master/entries
 * 率マスタの直しを「まとめて」保存する。
 *
 * 1件ずつの入口と業務上の意味は同じだが、収支表の作り直しを最後に1回だけにする。
 * 率は全車両に効くため、3項目直しただけで全車両の再計算が3回走ると待ち時間がそのまま3倍になる。
 * 一部だけ保存できなかったことも、項目ごとに返して打ち直しの範囲を最小にする。
 */
export async function POST(request: Request) {
  const session = await getServerSession();
  if (!checkAccess(session, RATE_MASTER_PERMISSION)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { env } = await getCloudflareContext({ async: true });
  if (!isSameOriginRequest(request, env.BETTER_AUTH_URL)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as { edits?: unknown } | null;
  const rawEdits = Array.isArray(body?.edits) ? body.edits : null;
  if (!rawEdits || rawEdits.length === 0) {
    return NextResponse.json({ error: "直す内容がありません" }, { status: 400 });
  }
  if (rawEdits.length > 200) {
    return NextResponse.json({ error: "一度に保存できるのは200項目までです" }, { status: 400 });
  }

  const edits: RateEditInput[] = [];
  for (const raw of rawEdits) {
    const e = raw as Record<string, unknown>;
    const key = typeof e.key === "string" ? e.key : "";
    if (!findRateMasterKeyDef(key)) {
      return NextResponse.json({ error: "設定できないキーです" }, { status: 400 });
    }
    const yearMonth = e.yearMonth == null ? null : e.yearMonth;
    if (yearMonth !== null && !isYearMonth(yearMonth)) {
      return NextResponse.json({ error: "yearMonth は YYYY-MM か null です" }, { status: 400 });
    }
    edits.push({
      key,
      yearMonth,
      field: typeof e.field === "string" ? e.field : "value",
      value: Number(e.value),
    });
  }

  const db = createDb(env.DB);
  const rateMasterRepo = new D1RateMasterRepository(db);
  const actor = { id: session!.id, name: session!.name ?? "" };

  // 直す前の値を先に控える。控えないと履歴が「何から何へ」を示せず、元に戻せない。
  const before = await rateMasterRepo.listRates();

  const recorded: MasterEditInput[] = [];
  const failures: { targetKey: string; field: string; message: string }[] = [];

  for (const edit of edits) {
    const def = findRateMasterKeyDef(edit.key)!;
    const validation = validateRateValue(def, edit.value);
    if (!validation.ok) {
      failures.push({ targetKey: edit.key, field: edit.field, message: validation.error });
      continue;
    }
    try {
      const prev = before.find(
        (e) => e.key === def.key && (e.yearMonth ?? null) === edit.yearMonth,
      );
      await rateMasterRepo.setRate(def.key, edit.yearMonth, edit.value, session!.id);
      recorded.push({
        targetKind: "rate",
        targetKey: `${def.key}|${edit.yearMonth ?? ""}`,
        targetLabel: def.label,
        field: "value",
        fieldLabel: def.label,
        beforeValue: prev ? String(prev.value) : null,
        afterValue: String(edit.value),
      });
    } catch (e) {
      failures.push({
        targetKey: edit.key,
        field: edit.field,
        message: e instanceof Error ? e.message : "保存できませんでした",
      });
    }
  }

  /*
   * 作り直す範囲。月を指定した率はその月にしか効かないが、全期間共通の率は
   * まだ締めていない全部の月に効く。両方が混ざっているときは広い方 (null = 未確定の全月) を採る。
   * 狭い方に合わせると、共通値を直したのに他の月の表が古いまま残る。
   */
  const months = new Set(edits.map((e) => e.yearMonth));
  const onlyYearMonth = months.size === 1 ? ([...months][0] ?? null) : null;

  const applied =
    recorded.length > 0
      ? await stackExecute(db, actor, recorded, onlyYearMonth)
      : { appliedYearMonths: [] as string[], heldBackYearMonths: [] as string[] };

  return NextResponse.json({
    saved: recorded.length,
    failures,
    applied: applied.appliedYearMonths,
    heldBack: applied.heldBackYearMonths,
  });
}

async function stackExecute(
  db: ReturnType<typeof createDb>,
  actor: { id: string; name: string },
  edits: MasterEditInput[],
  onlyYearMonth: string | null,
) {
  const stack = masterChangeStack(db, actor);
  return stack.applier.execute({ edits, actor, onlyYearMonth });
}
