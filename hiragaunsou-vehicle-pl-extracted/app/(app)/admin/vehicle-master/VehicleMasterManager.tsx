"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { VehicleMasterRecord } from "../../../../src/domain/repositories/MasterRepository";
import type {
  VehicleMasterImportRow,
  VehicleMasterImportRowError,
} from "../../../../src/infrastructure/parsers/vehicleMasterParser";
import { yen } from "../../../_lib/format";

const COST_CATEGORY_LABELS: Record<string, string> = {
  "6.5t": "6.5t",
  large: "大型",
  semiTrailer: "セミトレーラ",
  unic: "ユニック",
  medium: "中型",
};

interface Preview {
  fileName: string;
  valid: VehicleMasterImportRow[];
  errors: VehicleMasterImportRowError[];
}

export function VehicleMasterManager({ initialVehicles }: { initialVehicles: VehicleMasterRecord[] }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [vehicles, setVehicles] = useState(initialVehicles);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const existingNos = useMemo(() => new Set(vehicles.map((v) => v.vehicleNo)), [vehicles]);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    setDone(null);
    setPreview(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/admin/vehicle-master", { method: "POST", body: form });
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
      const res = await fetch("/api/admin/vehicle-master/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ records: preview.valid }),
      });
      const data = (await res.json().catch(() => null)) as
        | { inserted?: number; updated?: number; error?: string }
        | null;
      if (!res.ok || !data) {
        setError(data?.error ?? "取込に失敗しました");
        return;
      }
      setDone(`車両マスタを更新しました(新規${data.inserted ?? 0}件・更新${data.updated ?? 0}件)`);
      setPreview(null);
      if (fileInputRef.current) fileInputRef.current.value = "";

      const listRes = await fetch("/api/admin/vehicle-master");
      const listData = (await listRes.json().catch(() => null)) as {
        vehicles?: VehicleMasterRecord[];
      } | null;
      if (listRes.ok && listData?.vehicles) setVehicles(listData.vehicles);
      router.refresh();
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setBusy(false);
    }
  }

  const newCount = preview?.valid.filter((r) => !existingNos.has(r.vehicleNo)).length ?? 0;
  const updateCount = (preview?.valid.length ?? 0) - newCount;

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-line bg-white p-5">
        <h2 className="text-sm font-bold text-ink">CSVを取り込む</h2>
        <p className="mt-1 text-xs leading-relaxed text-ink-muted">
          社内Excel「車両別収支計算用」の収支表シートから、車番・車種名・所属・自賠責保険・任意保険・
          自動車税・自動車重量税・車両リース費・車両割賦支払費の9列を書き出したCSVを選んでください。
          車種名から原価カテゴリ(修繕費・タイヤ費の標準単価)を自動判定します。
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
                以下の行は取り込めません(CSVの車種名を直してから入れ直してください)
              </p>
              <ul className="mt-1.5 space-y-1 text-[11px] leading-relaxed text-ink">
                {preview.errors.map((e) => (
                  <li key={`${e.rowNumber}-${e.vehicleNo}`}>
                    {e.rowNumber}行目 車番{e.vehicleNo}: {e.reason}
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
                  <th className="py-2 pr-3">車番</th>
                  <th className="py-2 pr-3">車種名</th>
                  <th className="py-2 pr-3">原価区分</th>
                  <th className="py-2 pr-3">所属</th>
                  <th className="py-2 pr-3">自賠責</th>
                  <th className="py-2 pr-3">任意保険</th>
                  <th className="py-2 pr-3">自動車税</th>
                  <th className="py-2 pr-3">重量税</th>
                  <th className="py-2 pr-3">リース</th>
                  <th className="py-2">割賦</th>
                </tr>
              </thead>
              <tbody>
                {preview.valid.map((r) => (
                  <tr key={r.vehicleNo} className="border-b border-line last:border-b-0">
                    <td className="py-2 pr-3 text-xs">
                      {existingNos.has(r.vehicleNo) ? (
                        <span className="text-ink-muted">更新</span>
                      ) : (
                        <span className="font-semibold text-brand-deep">新規</span>
                      )}
                    </td>
                    <td className="num py-2 pr-3">{r.vehicleNo}</td>
                    <td className="py-2 pr-3 text-ink-muted">{r.vehicleType}</td>
                    <td className="py-2 pr-3 text-ink-muted">
                      {COST_CATEGORY_LABELS[r.costCategory] ?? r.costCategory}
                    </td>
                    <td className="py-2 pr-3 text-ink-muted">{r.depot}</td>
                    <td className="num py-2 pr-3 text-ink-muted">{yen(r.insCompulsory)}</td>
                    <td className="num py-2 pr-3 text-ink-muted">{yen(r.insVoluntary)}</td>
                    <td className="num py-2 pr-3 text-ink-muted">{yen(r.taxAuto)}</td>
                    <td className="num py-2 pr-3 text-ink-muted">{yen(r.taxWeight)}</td>
                    <td className="num py-2 pr-3 text-ink-muted">{yen(r.lease)}</td>
                    <td className="num py-2 text-ink-muted">{yen(r.installment)}</td>
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
        <h2 className="text-sm font-bold text-ink">現在の車両マスタ({vehicles.length}台)</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-ink-muted">
                <th className="py-2 pr-3">車番</th>
                <th className="py-2 pr-3">車種名</th>
                <th className="py-2 pr-3">原価区分</th>
                <th className="py-2 pr-3">所属</th>
                <th className="py-2 pr-3">自賠責</th>
                <th className="py-2 pr-3">任意保険</th>
                <th className="py-2 pr-3">自動車税</th>
                <th className="py-2 pr-3">重量税</th>
                <th className="py-2 pr-3">リース</th>
                <th className="py-2">割賦</th>
              </tr>
            </thead>
            <tbody>
              {vehicles.map((v) => (
                <tr key={v.vehicleNo} className="border-b border-line last:border-b-0">
                  <td className="num py-2 pr-3">{v.vehicleNo}</td>
                  <td className="py-2 pr-3 text-ink-muted">{v.vehicleType}</td>
                  <td className="py-2 pr-3 text-ink-muted">
                    {COST_CATEGORY_LABELS[v.costCategory] ?? v.costCategory}
                  </td>
                  <td className="py-2 pr-3 text-ink-muted">{v.depot}</td>
                  <td className="num py-2 pr-3 text-ink-muted">{yen(v.insCompulsory)}</td>
                  <td className="num py-2 pr-3 text-ink-muted">{yen(v.insVoluntary)}</td>
                  <td className="num py-2 pr-3 text-ink-muted">{yen(v.taxAuto)}</td>
                  <td className="num py-2 pr-3 text-ink-muted">{yen(v.taxWeight)}</td>
                  <td className="num py-2 pr-3 text-ink-muted">{yen(v.lease)}</td>
                  <td className="num py-2 text-ink-muted">{yen(v.installment)}</td>
                </tr>
              ))}
              {vehicles.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-4 text-center text-xs text-ink-muted">
                    車両マスタが登録されていません。CSVを取り込んでください。
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
