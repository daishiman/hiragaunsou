"use client";

import { useState, type ReactNode } from "react";
import { StickyActionBar } from "../StickyActionBar";
import { ConfirmDialog } from "../ConfirmDialog";
import { UnsavedLeaveGuard } from "./UnsavedLeaveGuard";
import { requestLeave } from "./navigationGuard";

/**
 * 「一覧を直してまとめて保存する」画面の共通の土台 — 画面の下に貼り付ける操作の帯。
 *
 * どの画面でも同じものが同じ場所にある状態にする:
 *   ・未保存◯件 (直した数を数えなくても分かる)
 *   ・保存する / 変更を取り消す
 *   ・保存できた・できなかったの一文
 *   ・保存しないまま離れようとしたときの確認 (閉じる・再読込・対象年月の切り替え)
 *
 * 離脱の確認をこの帯に持たせているのは、画面ごとに書くと必ず書き忘れが出るため。
 * この帯を置けば確認も付いてくる、という関係にする。
 */
export function UnsavedChangesBar({
  unsavedCount,
  saving,
  onSave,
  onReset,
  statusMessage,
  errorMessage,
  blockedMessage,
  saveLabel = "保存する",
  resetLabel = "変更を取り消す",
  variant = "page",
  leading,
  trailing,
  notice,
}: {
  /** 保存していない項目の数 */
  unsavedCount: number;
  saving: boolean;
  onSave: () => void;
  onReset: () => void;
  statusMessage?: string | null;
  errorMessage?: string | null;
  /** 保存を押せない理由 (数として読めない値が入っている等)。あるときは保存を止める */
  blockedMessage?: string | null;
  saveLabel?: string;
  resetLabel?: string;
  variant?: "page" | "card";
  /** 帯の左に足す操作 (手入力画面の「戻る」) */
  leading?: ReactNode;
  /** 帯の右に足す操作 (手入力画面の「次へ」) */
  trailing?: ReactNode;
  notice?: ReactNode;
}) {
  const dirty = unsavedCount > 0;
  const [confirmReset, setConfirmReset] = useState(false);

  return (
    <>
      <StickyActionBar variant={variant} notice={notice}>
        {leading}
        <button
          type="button"
          disabled={!dirty || saving || Boolean(blockedMessage)}
          onClick={onSave}
          className="btn btn-primary pressable"
        >
          {saving ? "保存しています…" : saveLabel}
        </button>
        <button
          type="button"
          disabled={!dirty || saving}
          onClick={() => setConfirmReset(true)}
          className="btn btn-quiet pressable"
        >
          {resetLabel}
        </button>

        {/* 状態は色ではなく文字で出す。何件が保存待ちかを常に正直に置く */}
        {dirty ? (
          <span data-unsaved-count={unsavedCount} className="text-xs font-semibold text-ink">
            未保存 <span className="num">{unsavedCount}</span>件
          </span>
        ) : null}
        {statusMessage ? <span className="text-xs text-ink-muted">{statusMessage}</span> : null}
        {blockedMessage ? (
          <span className="text-xs font-semibold text-danger">{blockedMessage}</span>
        ) : null}
        {errorMessage ? <span className="text-xs text-danger">{errorMessage}</span> : null}

        {trailing ? <div className="ml-auto">{trailing}</div> : null}
      </StickyActionBar>

      <ConfirmDialog
        open={confirmReset}
        title="直した内容を元に戻しますか?"
        confirmLabel="変更を取り消す"
        cancelLabel="編集を続ける"
        tone="caution"
        onCancel={() => setConfirmReset(false)}
        onConfirm={() => {
          setConfirmReset(false);
          onReset();
        }}
      >
        <p>
          保存していない<span className="num">{unsavedCount}</span>
          件の変更をすべて取り消し、保存されている値に戻します。保存済みの内容は変わりません。
        </p>
      </ConfirmDialog>

      <UnsavedLeaveGuard dirty={dirty}>
        <p>
          <span className="num">{unsavedCount}</span>
          件を保存していません。このまま移動すると、直した内容は失われます。
        </p>
      </UnsavedLeaveGuard>
    </>
  );
}

/** 帯を置かない画面から関所だけを使いたいとき (通常は UnsavedChangesBar を置けばよい) */
export { requestLeave };
