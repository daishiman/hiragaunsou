"use client";

import type { ReactNode } from "react";
import { UnsavedChangesBar } from "./UnsavedChangesBar";
import type { EditableRecordsForm } from "./useEditableRecords";

/**
 * 編集フォーム (useEditableRecords) の状態を、そのまま下の帯につなぐだけの部品。
 *
 * 画面側が書くのは <EditFormActionBar form={form} /> の1行だけになる。
 * 未保存件数・保存中・保存できたかどうか・離脱の確認は共通の帯が受け持つので、
 * 画面ごとに数え方や言い回しがずれない。
 */
export function EditFormActionBar<TRecord>({
  form,
  saveLabel,
  resetLabel,
  variant,
  leading,
  trailing,
  notice,
}: {
  form: EditableRecordsForm<TRecord>;
  saveLabel?: string;
  resetLabel?: string;
  variant?: "page" | "card";
  leading?: ReactNode;
  trailing?: ReactNode;
  notice?: ReactNode;
}) {
  return (
    <UnsavedChangesBar
      unsavedCount={form.changedCount}
      saving={form.saving}
      onSave={() => void form.save()}
      onReset={form.resetAll}
      statusMessage={form.statusMessage}
      errorMessage={form.errorMessage}
      blockedMessage={
        form.invalidCount > 0
          ? `${form.invalidCount}件の欄が数字として読めません。直してから保存してください`
          : null
      }
      saveLabel={saveLabel}
      resetLabel={resetLabel}
      variant={variant}
      leading={leading}
      trailing={trailing}
      notice={notice}
    />
  );
}
