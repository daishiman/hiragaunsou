"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ConfirmDialog } from "../ConfirmDialog";
import { setLeaveGuard } from "./navigationGuard";

/**
 * 「保存していない入力があるまま画面を離れようとしたとき」の確認。
 *
 * 見た目を持たない部品で、置くだけで次の2つが付いてくる:
 *   ・タブを閉じる・再読込 → ブラウザ標準の確認
 *   ・対象年月の切り替えなど、アプリの中の移動 → この画面の確認
 *
 * マスタ画面 (UnsavedChangesBar) と手入力画面の両方がこれを使う。画面ごとに書くと
 * 必ず書き漏れが出て、「片方の画面だけ黙って入力が消える」状態になるため1つにまとめる。
 */
export function UnsavedLeaveGuard({
  dirty,
  title = "保存していない変更があります",
  children,
}: {
  dirty: boolean;
  title?: string;
  /** 確認の本文。何が失われるかを画面の言葉で書く */
  children?: ReactNode;
}) {
  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null);
  // 関所には常に最新の「保存していないか」を見せる必要がある。
  // 登録した時点の値を閉じ込めると、直したあとも「離れてよい」と答えてしまう。
  const dirtyRef = useRef(dirty);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  /* 閉じる・再読込のときはブラウザ標準の確認に任せる (アプリ側では止められないため) */
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (!dirtyRef.current) return;
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  /* 対象年月の切り替えなど、アプリの中の移動はこちらで止めて確認を出す */
  useEffect(() => {
    setLeaveGuard((proceed) => {
      // 直していないときは引き止めない。ここで proceed を呼ばずに true だけ返すと、
      // 呼び出し側 (対象年月の切り替え) は「移動した」と思うのに実際は動かない。
      if (!dirtyRef.current) {
        proceed();
        return true;
      }
      setPendingLeave(() => proceed);
      return false;
    });
    return () => setLeaveGuard(null);
  }, []);

  return (
    <ConfirmDialog
      open={pendingLeave !== null}
      title={title}
      confirmLabel="変更を捨てて移動する"
      cancelLabel="この画面に留まる"
      tone="caution"
      onCancel={() => setPendingLeave(null)}
      onConfirm={() => {
        const proceed = pendingLeave;
        setPendingLeave(null);
        proceed?.();
      }}
    >
      {children ?? <p>保存していない入力があります。このまま移動すると、打った内容は失われます。</p>}
    </ConfirmDialog>
  );
}
