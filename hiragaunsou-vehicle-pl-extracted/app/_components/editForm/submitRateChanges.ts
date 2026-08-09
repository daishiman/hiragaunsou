"use client";

import type { RateMasterKeyDef } from "../../../src/domain/rules/rateMasterCatalog";
import type { EditChange, EditSubmitResult } from "./useEditableRecords";

/**
 * 率マスタの「まとめて保存」の送り先。
 *
 * 車両・運転者マスタ (submitMasterChanges) と対になる、もう1つの宛先。
 * 画面に保存処理を書かず宛先だけを差し替える形にしておくと、保存の作法
 * (変更分だけ送る・保存できなかった欄を返す・締めた月を伝える) を1箇所で保てる。
 *
 * @param yearMonth いま見ている月。「この月のみ」の欄はこの月に保存する
 * @param toStoredValue 画面に出している値 → 保存する値 (率は % で見せて 0〜1 で保存する)
 */
export function saveRateChanges(
  yearMonth: string,
  toStoredValue: (def: RateMasterKeyDef, display: string) => number,
) {
  return async (changes: EditChange<RateMasterKeyDef>[]): Promise<EditSubmitResult> => {
    const res = await fetch("/api/rate-master/entries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        edits: changes.map((c) => ({
          key: c.record.key,
          // 欄が「全期間共通」なら月を持たない値として保存する
          yearMonth: c.def.field === "common" ? null : yearMonth,
          field: c.def.field,
          value: toStoredValue(c.record, c.after),
        })),
      }),
    });
    const data = (await res.json().catch(() => null)) as {
      saved?: number;
      failures?: { targetKey: string; field: string; message: string }[];
      heldBack?: string[];
      error?: string;
    } | null;

    if (!res.ok || !data) {
      return { error: data?.error ?? "保存できませんでした" };
    }

    const heldBack = data.heldBack ?? [];
    return {
      failures: (data.failures ?? []).map((f) => ({
        rowKey: f.targetKey,
        field: f.field,
        message: f.message,
      })),
      // 締めた月を据え置いたことは必ず伝える。黙って据え置くと
      // 「直したのに古い数字のまま」に見える。
      message:
        heldBack.length > 0
          ? `${data.saved ?? 0}件を保存し、収支表を作り直しました。締めた月(${heldBack.join("・")})はそのままです`
          : `${data.saved ?? 0}件を保存し、収支表を作り直しました`,
    };
  };
}
