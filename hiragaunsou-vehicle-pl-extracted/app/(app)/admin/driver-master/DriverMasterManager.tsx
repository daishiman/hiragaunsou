"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { DriverMasterRecord } from "../../../../src/domain/repositories/MasterRepository";
import type {
  DriverMasterImportRow,
  DriverMasterImportRowError,
} from "../../../../src/infrastructure/parsers/driverMasterParser";

interface Preview {
  fileName: string;
  valid: DriverMasterImportRow[];
  errors: DriverMasterImportRowError[];
}

interface SkippedRow {
  employeeCode: string;
  driverName: string;
  vehicleNo: string;
  reason: string;
}

export function DriverMasterManager({ initialDrivers }: { initialDrivers: DriverMasterRecord[] }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [drivers, setDrivers] = useState(initialDrivers);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [skipped, setSkipped] = useState<SkippedRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const existingCodes = useMemo(() => new Set(drivers.map((d) => d.employeeCode)), [drivers]);
  const unassigned = drivers.filter((d) => !d.vehicleNo).length;

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    setDone(null);
    setPreview(null);
    setSkipped([]);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/admin/driver-master", { method: "POST", body: form });
      const data = (await res.json().catch(() => null)) as (Preview & { error?: string }) | null;
      if (!res.ok || !data) {
        setError(data?.error ?? "CSVの読み込みに失敗しました");
        return;
      }
      setPreview({ fileName: data.fileName, valid: data.valid, errors: data.errors });
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!preview || preview.valid.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/driver-master/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ records: preview.valid }),
      });
      const data = (await res.json().catch(() => null)) as
        | { inserted?: number; updated?: number; skipped?: SkippedRow[]; error?: string }
        | null;
      if (!res.ok || !data) {
        setError(data?.error ?? "取込に失敗しました");
        return;
      }
      setDone(`運転者マスタを更新しました(新規${data.inserted ?? 0}件・更新${data.updated ?? 0}件)`);
      setSkipped(data.skipped ?? []);
      setPreview(null);
      if (fileInputRef.current) fileInputRef.current.value = "";

      const listRes = await fetch("/api/admin/driver-master");
      const listData = (await listRes.json().catch(() => null)) as {
        drivers?: DriverMasterRecord[];
      } | null;
      if (listRes.ok && listData?.drivers) setDrivers(listData.drivers);
      router.refresh();
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setBusy(false);
    }
  }

  const newCount = preview?.valid.filter((r) => !existingCodes.has(r.employeeCode)).length ?? 0;
  const updateCount = (preview?.valid.length ?? 0) - newCount;

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-line bg-white p-5">
        <h2 className="text-sm font-bold text-ink">CSVを取り込む</h2>
        <p className="mt-1 text-xs leading-relaxed text-ink-muted">
          社員No・氏名・車番の3列を書き出したCSVを選んでください。
          給与集計表は社員No単位、収支表は車番単位で集計されるため、両者を結ぶのはこの表だけです。
          車番が空の方(内勤・退職等)も登録できます。給与が乗らないだけで、エラーにはなりません。
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
          }}
          className="mt-3 block w-full text-xs text-ink file:mr-3 file:rounded-md file:border file:border-line file:bg-subtle file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-ink"
        />
        {error ? <p className="mt-2 text-xs text-danger">{error}</p> : null}
        {done ? <p className="mt-2 text-xs font-semibold text-brand-deep">{done}</p> : null}

        {skipped.length > 0 ? (
          <div className="mt-3 rounded-md border border-caution-border bg-caution-soft px-3 py-2">
            <p className="text-xs font-semibold text-ink">
              以下の{skipped.length}件は車両マスタに無い車番のため取り込んでいません
            </p>
            <ul className="mt-1.5 space-y-1 text-[11px] leading-relaxed text-ink">
              {skipped.map((s) => (
                <li key={s.employeeCode}>
                  社員No{s.employeeCode} {s.driverName}: {s.reason}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      {preview ? (
        <section className="rounded-xl border border-line bg-white p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-bold text-ink">取込内容の確認({preview.fileName})</h2>
            <p className="num text-xs text-ink-muted">
              新規{newCount}件・更新{updateCount}件
              {preview.errors.length > 0 ? ` / エラー${preview.errors.length}件` : ""}
            </p>
          </div>

          {preview.errors.length > 0 ? (
            <div className="mt-3 rounded-md border border-caution-border bg-caution-soft px-3 py-2">
              <p className="text-xs font-semibold text-ink">
                以下の行は取り込めません(CSVを直してから入れ直してください)
              </p>
              <ul className="mt-1.5 space-y-1 text-[11px] leading-relaxed text-ink">
                {preview.errors.map((e) => (
                  <li key={`${e.rowNumber}-${e.employeeCode}`}>
                    {e.rowNumber}行目 社員No{e.employeeCode}: {e.reason}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-ink-muted">
                  <th className="py-2 pr-3">区分</th>
                  <th className="py-2 pr-3">社員No</th>
                  <th className="py-2 pr-3">氏名</th>
                  <th className="py-2">車番</th>
                </tr>
              </thead>
              <tbody>
                {preview.valid.map((r) => (
                  <tr key={r.employeeCode} className="border-b border-line last:border-b-0">
                    <td className="py-2 pr-3 text-xs">
                      {existingCodes.has(r.employeeCode) ? (
                        <span className="text-ink-muted">更新</span>
                      ) : (
                        <span className="font-semibold text-brand-deep">新規</span>
                      )}
                    </td>
                    <td className="num py-2 pr-3">{r.employeeCode}</td>
                    <td className="py-2 pr-3 text-ink-muted">{r.driverName}</td>
                    <td className="num py-2 text-ink-muted">{r.vehicleNo ?? "未割当"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button
            type="button"
            disabled={busy || preview.valid.length === 0}
            onClick={() => void confirm()}
            className="pressable mt-4 rounded-md bg-accent px-5 py-2 text-sm font-semibold text-white hover:bg-accent-deep disabled:opacity-50"
          >
            {busy ? "取り込んでいます…" : `${preview.valid.length}件を取り込む`}
          </button>
        </section>
      ) : null}

      <section className="rounded-xl border border-line bg-white p-5">
        <h2 className="text-sm font-bold text-ink">
          現在の運転者マスタ({drivers.length}名
          {unassigned > 0 ? ` / うち車番未割当${unassigned}名` : ""})
        </h2>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-ink-muted">
                <th className="py-2 pr-3">社員No</th>
                <th className="py-2 pr-3">氏名</th>
                <th className="py-2">車番</th>
              </tr>
            </thead>
            <tbody>
              {drivers.map((d) => (
                <tr key={d.employeeCode} className="border-b border-line last:border-b-0">
                  <td className="num py-2 pr-3">{d.employeeCode}</td>
                  <td className="py-2 pr-3 text-ink-muted">{d.driverName}</td>
                  <td className="num py-2 text-ink-muted">
                    {d.vehicleNo ?? <span className="text-ink-muted">未割当</span>}
                  </td>
                </tr>
              ))}
              {drivers.length === 0 ? (
                <tr>
                  <td colSpan={3} className="py-4 text-center text-xs text-ink-muted">
                    運転者マスタが登録されていません。このままだと収支表の人件費が全車両0のままになります。
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
