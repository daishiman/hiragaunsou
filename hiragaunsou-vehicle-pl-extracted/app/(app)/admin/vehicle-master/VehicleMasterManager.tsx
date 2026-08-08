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
  trailer: "被けん引車(トレーラ)",
};

/**
 * けん引先に選べる車両。
 *
 * 除くのは「自分自身」と「他のトレーラ」だけにする。所属(depot)では絞らない。
 * 実データの5組はすべて本社だが、絞ってしまうと営業所をまたぐ組み合わせが出たときに
 * 登録手段そのものが無くなる。対応表は元データのどのCSVにも無く、この画面が唯一の
 * 入口なので、ここで塞ぐと復旧できない。
 *
 * 代わりに並び順で探しやすくする。同じ所属を先に出し、その中は車番順にする。
 * 車番は "2" "129" "1113" のような文字列なので、単純な文字列比較だと "1113" が "2" より
 * 前に来る。numeric 比較で人が読む順に揃える。
 */
function tractorCandidates(
  vehicles: readonly VehicleMasterRecord[],
  trailer: VehicleMasterRecord,
): VehicleMasterRecord[] {
  return vehicles
    .filter((v) => v.vehicleNo !== trailer.vehicleNo && v.costCategory !== "trailer")
    .sort((a, b) => {
      const sameDepot = (v: VehicleMasterRecord) => (v.depot === trailer.depot ? 0 : 1);
      return (
        sameDepot(a) - sameDepot(b) ||
        a.vehicleNo.localeCompare(b.vehicleNo, "ja", { numeric: true })
      );
    });
}

interface Preview {
  fileName: string;
  valid: VehicleMasterImportRow[];
  errors: VehicleMasterImportRowError[];
}

export function VehicleMasterManager({
  initialVehicles,
  yearMonth,
}: {
  initialVehicles: VehicleMasterRecord[];
  /** けん引先を変えたら収支表を作り直すので、どの月の表を直すのかが要る。 */
  yearMonth: string;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [vehicles, setVehicles] = useState(initialVehicles);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const existingNos = useMemo(() => new Set(vehicles.map((v) => v.vehicleNo)), [vehicles]);
  const [towedBusy, setTowedBusy] = useState<string | null>(null);

  /**
   * トレーラのけん引先を設定・解除する。車両マスタを直したら収支表も作り直すので、
   * 表と土台がずれた状態は残らない (再計算はAPI側が受け持つ)。
   */
  async function saveTowedBy(vehicleNo: string, towedByVehicleNo: string | null) {
    setTowedBusy(vehicleNo);
    setError(null);
    setDone(null);
    try {
      const res = await fetch("/api/vehicle-master/towed-by", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ yearMonth, vehicleNo, towedByVehicleNo }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setError(data?.error ?? "けん引先の更新に失敗しました");
        return;
      }
      setVehicles((prev) =>
        prev.map((v) => (v.vehicleNo === vehicleNo ? { ...v, towedByVehicleNo } : v)),
      );
      setDone(
        towedByVehicleNo
          ? `車番${vehicleNo}を車番${towedByVehicleNo}の行に合算するようにしました(収支表を作り直しました)`
          : `車番${vehicleNo}のけん引先を解除しました(収支表を作り直しました)`,
      );
      router.refresh();
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setTowedBusy(null);
    }
  }

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    setDone(null);
    setPreview(null);
    try {
      const form = new FormData();
      form.append("file", file);
      // 年度ブック(12か月分のシート)を渡されたとき、どの月のシートを見るかの手掛かり。
      form.append("yearMonth", yearMonth);
      const res = await fetch("/api/admin/vehicle-master", { method: "POST", body: form });
      const data = (await res.json().catch(() => null)) as (Preview & { error?: string }) | null;
      if (!res.ok || !data) {
        setError(data?.error ?? "ファイルの読み込みに失敗しました");
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
        body: JSON.stringify({ records: preview.valid, yearMonth }),
      });
      const data = (await res.json().catch(() => null)) as
        | { inserted?: number; updated?: number; recalculated?: boolean; error?: string }
        | null;
      if (!res.ok || !data) {
        setError(data?.error ?? "取込に失敗しました");
        return;
      }
      const towed = towedCount > 0 ? `・けん引先${towedCount}組` : "";
      setDone(
        `車両マスタを更新しました(新規${data.inserted ?? 0}件・更新${data.updated ?? 0}件${towed})。` +
          (data.recalculated
            ? `${yearMonth}の収支表も作り直しました。`
            : `${yearMonth}の収支表はまだ作り直していません(データ取込が済んでから収支表を作成してください)。`),
      );
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
  /** Excelの行の並びから復元できたけん引の組数。人が見て確かめられるよう件数を出す。 */
  const towedCount = preview?.valid.filter((r) => r.towedByVehicleNo).length ?? 0;

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-line bg-white p-5">
        <h2 className="text-sm font-bold text-ink">ファイルを取り込む</h2>
        <p className="mt-1 text-xs leading-relaxed text-ink-muted">
          社内Excel「★車両別収支計算用」をそのまま選んでください({yearMonth}
          の収支表シートから車番・車種名・所属・保険・税・リース費・割賦費を読み取ります)。
          CSVに書き出す必要はありません。CSVを選ぶ場合は、その9列を書き出したものにしてください。
          車種名から原価カテゴリ(修繕費・タイヤ費の標準単価)を自動判定します。
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
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

          {towedCount > 0 ? (
            <p className="mt-1 text-xs leading-relaxed text-ink-muted">
              Excelの行の並び(トラクタの直下に被けん引車)から、けん引先を{towedCount}
              組復元しました。下の「けん引先」列で組み合わせを確かめてから取り込んでください
              (違っていれば取込後に一覧で選び直せます)。
            </p>
          ) : null}

          {preview.errors.length > 0 ? (
            <div className="mt-3 rounded-md border border-caution-border bg-caution-soft px-3 py-2">
              <p className="text-xs font-semibold text-ink">
                以下の行は取り込めません(元ファイルの車種名を直してから入れ直してください)
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
                  <th className="py-2 pr-3">けん引先</th>
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
                    <td className="num py-2 pr-3 text-ink-muted">
                      {r.towedByVehicleNo ? `→ ${r.towedByVehicleNo}` : "—"}
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
        <p className="mt-1 text-xs leading-relaxed text-ink-muted">
          トレーラ(被けん引車)は運賃も運転者も付かないのに保険・税・リース料だけが付くため、
          けん引先を決めないと「売上ゼロ・費用だけの赤字行」として収支表に並びます。
          けん引先を選ぶとその行に合算され、車番は「129/1113」のようにまとめて表示されます
          (収支表は{yearMonth}分を作り直します)。
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-ink-muted">
                <th className="py-2 pr-3">車番</th>
                <th className="py-2 pr-3">車種名</th>
                <th className="py-2 pr-3">原価区分</th>
                <th className="py-2 pr-3">けん引先</th>
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
                  <td className="py-2 pr-3">
                    {v.costCategory === "trailer" ? (
                      <select
                        value={v.towedByVehicleNo ?? ""}
                        disabled={towedBusy !== null}
                        onChange={(e) => void saveTowedBy(v.vehicleNo, e.target.value || null)}
                        className="num rounded-md border border-line px-2 py-1 text-xs disabled:opacity-50"
                      >
                        <option value="">単独で表に出す</option>
                        {tractorCandidates(vehicles, v).map((t) => (
                          <option key={t.vehicleNo} value={t.vehicleNo}>
                            {t.vehicleNo}({t.vehicleType})
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-[11px] text-ink-muted">—</span>
                    )}
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
                  <td colSpan={11} className="py-4 text-center text-xs text-ink-muted">
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
