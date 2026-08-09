"use client";

import { useState } from "react";

/**
 * 確認結果を紙・メールで渡すための操作。
 *
 * PDF出力を自前で作らず、ブラウザの印刷 (「PDFとして保存」を含む) に寄せる。
 * 印刷のプレビューは全員が知っている操作で、紙にもPDFにも同じ経路で出せるため。
 */
export function PrintActions() {
  const [copied, setCopied] = useState(false);

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 3000);
    } catch {
      // クリップボードが使えない環境ではURL欄を選んでもらう方が早いので、
      // 失敗を握りつぶさずその場に出す。
      window.prompt("このページのURLをコピーしてください", window.location.href);
    }
  }

  return (
    <div className="no-print flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => window.print()}
        className="btn btn-primary pressable"
      >
        印刷する / PDFで保存
      </button>
      <button
        type="button"
        onClick={() => void copyUrl()}
        className="btn btn-quiet pressable"
      >
        {copied ? "コピーしました" : "このページのURLをコピー"}
      </button>
    </div>
  );
}
