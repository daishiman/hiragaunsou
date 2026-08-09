"use client";

import type { EditChange, EditSubmitResult } from "./useEditableRecords";

/**
 * 車両マスタ・運転者マスタの「まとめて保存」の送り先。
 *
 * 2つの画面で同じ処理になるので、画面には置かずここに1つだけ置く。
 * 送るのは変更のあった項目だけ。保存できなかった項目は、どの行のどの項目かを付けて返す。
 */
export function saveMasterChanges<TRecord>(targetKind: "vehicle" | "driver") {
  return async (changes: EditChange<TRecord>[]): Promise<EditSubmitResult> => {
    const res = await fetch("/api/master-changes/entries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        edits: changes.map((c) => ({
          targetKind,
          targetKey: c.rowKey,
          field: c.def.field,
          value: c.after,
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
          ? `${data.saved ?? 0}件を保存しました。締めた月(${heldBack.join("・")})はそのままです`
          : `${data.saved ?? 0}件を保存しました`,
    };
  };
}
