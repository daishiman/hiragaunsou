"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertPanel } from "./AlertPanel";
import { Disclosure } from "./Disclosure";
import type { ImportDiff } from "../../src/domain/rules/importDiffDetection";

/**
 * 「前回と異なります」の中身。ImportDiffAlertPanel から差分を受け取って出すだけ。
 *
 * 強く出すもの(見落とすと収支表が静かに壊れるもの)だけを開いて並べ、
 * 起きて当たり前の変更は畳んでおく。全部を同じ強さで出すと、どれも読まれない。
 */
export function ImportDiffAlertList({
  diffs,
  className,
}: {
  diffs: ImportDiff[];
  className?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const critical = diffs.filter((d) => d.severity === "critical");
  const caution = diffs.filter((d) => d.severity !== "critical");

  async function ack(targets: ImportDiff[]) {
    if (targets.length === 0) return;
    setBusy(true);
    try {
      const res = await fetch("/api/import-diffs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fingerprints: targets.map((d) => d.fingerprint),
          targetKind: targets[0]!.targetKind,
          targetLabel: targets[0]!.targetLabel,
          summary: describe(targets[0]!),
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (data.error) setError(data.error);
      else {
        setError(null);
        // 確認済みにしたものは次から出ない。画面は取り直して合わせる
        router.refresh();
      }
    } catch {
      setError("確認済みにできませんでした");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={className}>
      <AlertPanel
        tone={critical.length > 0 ? "caution" : "info"}
        title={
          critical.length > 0
            ? `前回と異なります(要確認 ${critical.length}件)`
            : `前回と異なります(${caution.length}件)`
        }
      >
        {error ? <p className="mb-2 text-danger">{error}</p> : null}

        {critical.length > 0 ? (
          <ul className="space-y-1.5">
            {critical.map((d) => (
              <li key={d.fingerprint} className="flex items-baseline justify-between gap-3">
                <span>{describe(d)}</span>
                <button
                  type="button"
                  className="btn btn-quiet btn-sm pressable shrink-0"
                  disabled={busy}
                  onClick={() => void ack([d])}
                >
                  確認済みにする
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {caution.length > 0 ? (
          <Disclosure summary={`ふつうの変更も見る (${caution.length}件)`} tone="inline">
            <ul className="space-y-1.5">
              {caution.map((d) => (
                <li key={d.fingerprint} className="flex items-baseline justify-between gap-3">
                  <span>{describe(d)}</span>
                  <button
                    type="button"
                    className="btn btn-quiet btn-sm pressable shrink-0"
                    disabled={busy}
                    onClick={() => void ack([d])}
                  >
                    確認済みにする
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="btn btn-quiet btn-sm pressable mt-2"
              disabled={busy}
              onClick={() => void ack(caution)}
            >
              これらをまとめて確認済みにする
            </button>
          </Disclosure>
        ) : null}
      </AlertPanel>
    </div>
  );
}

const show = (v: string | null) => (v === null || v === "" ? "(空)" : v);

/** 1件の違いを、業務の言葉の1行にする。専門用語は使わない */
export function describe(d: ImportDiff): string {
  const before = show(d.before);
  const after = show(d.after);
  switch (d.kind) {
    case "row_added":
      return `${d.targetLabel}: 今回から新しく入っています`;
    case "row_removed":
      return `${d.targetLabel}: 前回はありましたが、今回は入っていません`;
    case "unassigned":
      return `${d.targetLabel}: ${d.fieldLabel}が空になりました (${before} → 未割当)`;
    case "digit_jump":
      return `${d.targetLabel} の${d.fieldLabel}: ${before} → ${after} (桁が違います)`;
    case "mojibake":
      return `${d.targetLabel} の${d.fieldLabel}: ${after} (文字が壊れている可能性があります)`;
    case "duplicate_candidate":
      return `${d.targetLabel} と ${d.counterpartLabel ?? ""}: 同じものが2件あります (${before} / ${after})`;
    case "near_match":
      return `${d.targetLabel} と ${d.counterpartLabel ?? ""}: ${before} と ${after} がよく似ています。同じ人なら片方を直してください`;
    case "link_changed":
      return `${d.targetLabel} の${d.fieldLabel}: ${before} → ${after}`;
    case "value_changed":
    default:
      return `${d.targetLabel} の${d.fieldLabel}: ${before} → ${after}`;
  }
}
