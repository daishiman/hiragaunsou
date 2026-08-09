"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { yearMonthLabel } from "../../_lib/format";

type RebuildResponse = {
  status?: string;
  reason?: string;
  vehicleCount?: number;
  error?: string;
};

/**
 * 取込はあるのに収支表が1行も無い月に出す、作り直しの入口。
 *
 * 取り込んだ本人には「4つとも取り込んだのに表が空」としか見えず、以前はここに
 * 「データ取込へ」しか無かったため、同じファイルを取り込み直す以外に打つ手が無かった。
 * 空になる理由(車両マスタが空/運行実績か売上が足りない)は押した結果で分かるので、
 * まず押せる形にして、返ってきた理由と直しに行く先を出す。
 */
export function RebuildPanel({ yearMonth }: { yearMonth: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [fixHref, setFixHref] = useState<string | null>(null);

  async function rebuild() {
    setBusy(true);
    setMessage(null);
    setFixHref(null);
    try {
      const res = await fetch("/api/vehicle-pl/rebuild", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ yearMonth }),
      });
      const data = (await res.json().catch(() => null)) as RebuildResponse | null;
      if (!res.ok) {
        setMessage(data?.error ?? "収支表を作り直せませんでした");
        return;
      }
      if (data?.status === "built" && (data.vehicleCount ?? 0) > 0) {
        setMessage(`${data.vehicleCount}台分の収支表を作りました`);
        router.refresh();
        return;
      }
      if (data?.reason === "no_vehicle_master" || (data?.vehicleCount ?? 0) === 0) {
        setMessage("車両マスタに車両が1台も登録されていないため、収支表を作れません");
        setFixHref("/admin/vehicle-master");
        return;
      }
      if (data?.reason === "imports_incomplete") {
        setMessage("この月は運行実績か売上の取込が足りません");
        setFixHref(`/import?ym=${yearMonth}`);
        return;
      }
      setMessage("収支表を作り直せませんでした。時間をおいてもう一度お試しください");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-dashed border-line bg-white px-6 py-10 text-center">
      <p className="text-sm font-semibold text-ink">
        {yearMonthLabel(yearMonth)}のファイルは取り込めていますが、収支表がまだ作られていません
      </p>
      <p className="mt-1 text-sm text-ink-muted">
        取り込んだ内容から、車両別の収支をここで作れます。取込をやり直す必要はありません。
      </p>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          className="btn btn-primary pressable"
          disabled={busy}
          onClick={rebuild}
        >
          {busy ? "作り直しています…" : "収支表を作り直す"}
        </button>
        <Link href={`/import?ym=${yearMonth}`} className="btn btn-quiet pressable">
          取込の状況を見る
        </Link>
      </div>
      {message ? (
        <p className="mt-3 text-sm font-semibold text-ink">
          {message}
          {fixHref ? (
            <Link href={fixHref} className="ml-2 underline">
              直しに行く
            </Link>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
