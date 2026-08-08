"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { VehicleMasterRecord } from "../../../../src/domain/repositories/MasterRepository";
import type {
  VehicleMasterImportRow,
  VehicleMasterImportRowError,
} from "../../../../src/infrastructure/parsers/vehicleMasterParser";
import {
  describeImportSource,
  type ImportSourceInfo,
} from "../../../../src/infrastructure/parsers/importSource";
import type { FileImportVerdict } from "../../../../src/domain/rules/fileImportCheck";
import { AlertPanel } from "../../../_components/AlertPanel";
import { ImportCheckPanel } from "../../../_components/ImportCheckPanel";
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
  source?: ImportSourceInfo;
}

/** 取込前の確認。中身の判定に問題があったときだけ出す。 */
interface CheckState {
  file: File;
  verdict: FileImportVerdict;
}

/**
 * 「対象月のシートが無かったので別の月で代用した」ときに続けて出す一文。
 * 運転者マスタは人事の対応、車両マスタは車両ごとの決まった金額と、理由が違う。
 */
const FALLBACK_NOTE =
  "保険・税・リース料は月ごとの実績ではなく車両ごとの決まった金額なので、この月から読んでも同じ値が入ります。";

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
  const [check, setCheck] = useState<CheckState | null>(null);
  /** 取込の記録に残す中身の指紋。次に同じファイルを選んだときの照合に使う。 */
  const [contentHash, setContentHash] = useState<string | null>(null);

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

  /**
   * ファイルを選んだ直後の下読み。名前ではなく中身から「何のファイルか」「必要な列が揃っているか」
   * 「前に取り込んでいないか」を確かめ、問題があれば取込を止めて確認を取る。
   * 全画面共通のルール(docs/product/file-import-common-spec.md)に従う。
   */
  async function inspectThenUpload(file: File) {
    setBusy(true);
    setError(null);
    setDone(null);
    setPreview(null);
    setCheck(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("screen", "vehicle_master");
      const res = await fetch("/api/import/detect", { method: "POST", body: form });
      const data = (await res.json().catch(() => null)) as
        | { contentHash?: string; verdict?: FileImportVerdict }
        | null;
      if (res.ok && data?.verdict) {
        setContentHash(data.contentHash ?? null);
        if (data.verdict.status !== "ok") {
          setCheck({ file, verdict: data.verdict });
          setBusy(false);
          return;
        }
      }
    } catch {
      // 下読みに失敗しても取込自体は続けられる。中身の不備は取込側が理由つきで返す。
    }
    await upload(file);
  }

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    setDone(null);
    setPreview(null);
    setCheck(null);
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
      setPreview({
        fileName: data.fileName,
        valid: data.valid,
        errors: data.errors,
        source: data.source,
      });
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
        body: JSON.stringify({
          records: preview.valid,
          yearMonth,
          // 取込の記録に残す情報。次に同じファイルを選んだときの照合に使う。
          fileName: preview.fileName,
          contentHash,
        }),
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
        `${(data.inserted ?? 0) + (data.updated ?? 0)}台を登録しました` +
          `(新規${data.inserted ?? 0}台・更新${data.updated ?? 0}台${towed})。` +
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
  const sourceText = describeImportSource(preview?.source, { fallbackNote: FALLBACK_NOTE });
  /**
   * けん引先が決まっていないトレーラ。放っておくと収支表に「売上ゼロ・費用だけの赤字行」として
   * 並び続けるが、一覧を最後まで見ないと気づけない。件数を上に出して気づけるようにする。
   */
  const trailersWithoutTractor = vehicles.filter(
    (v) => v.costCategory === "trailer" && !v.towedByVehicleNo,
  );

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-line bg-white p-5">
        <h2 className="text-sm font-bold text-ink">ファイルを取り込む</h2>
        <p className="mt-1 text-xs leading-relaxed text-ink-muted">
          社内Excel「★車両別収支計算用」をそのまま選んでください({yearMonth}
          の収支表シートから車番・車種名・所属・保険・税・リース費・割賦費を読み取ります)。
          CSVに書き出す必要はありません。CSVを選ぶ場合は、その9列を書き出したものにしてください。
          車種名から原価カテゴリ(修繕費・タイヤ費の標準単価)を自動判定します。
          ファイル名は変わっても構いません。中身を読んで判定します。
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void inspectThenUpload(file);
          }}
          className="mt-3 block w-full text-xs text-ink file:mr-3 file:rounded-md file:border file:border-line file:bg-subtle file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-ink"
        />
        {busy && !preview ? (
          <p className="mt-3 text-xs text-ink-muted">ファイルを読み取っています…</p>
        ) : null}

        {check ? (
          <ImportCheckPanel
            fileName={check.file.name}
            verdict={check.verdict}
            yearMonth={yearMonth}
            onYearMonthChange={() => undefined}
            onConfirm={() => void upload(check.file)}
            onCancel={() => {
              setCheck(null);
              if (fileInputRef.current) fileInputRef.current.value = "";
            }}
            busy={busy}
          />
        ) : null}

        {error ? (
          <div className="mt-3">
            <AlertPanel tone="danger" title="取り込めませんでした">
              <p>{error}</p>
              <p className="mt-1">
                直したファイルをもう一度選んでください。原因が分からないときは、この画面のまま
                スクリーンショットを送ってください。
              </p>
            </AlertPanel>
          </div>
        ) : null}

        {done ? (
          <div className="mt-3">
            <AlertPanel tone="success" title={done}>
              <p>
                続けて
                <Link href={`/admin/driver-master?ym=${yearMonth}`} className="underline">
                  運転者マスタ管理
                </Link>
                で社員Noと車番の対応も登録すると、収支表に人件費が乗ります。
              </p>
            </AlertPanel>
          </div>
        ) : null}
      </section>

      {preview ? (
        <section className="rounded-xl border border-line bg-white p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-bold text-ink">取込内容の確認({preview.fileName})</h2>
            <p className="num text-xs text-ink-muted">
              新規{newCount}台・更新{updateCount}台
              {preview.errors.length > 0 ? ` / 取り込めない行${preview.errors.length}件` : ""}
            </p>
          </div>
          {sourceText ? (
            <p className="mt-1 text-xs leading-relaxed text-ink-muted">{sourceText}</p>
          ) : null}
          <p className="mt-1 text-xs leading-relaxed text-ink-muted">
            この取込は、いま登録されている車両を消しません。同じ車番は内容を上書きし、
            初めての車番は追加します。一覧から消したい車両があるときはご連絡ください。
          </p>

          {towedCount > 0 ? (
            <p className="mt-1 text-xs leading-relaxed text-ink-muted">
              Excelの行の並び(トラクタの直下に被けん引車)から、けん引先を{towedCount}
              組復元しました。下の「けん引先」列で組み合わせを確かめてから取り込んでください
              (違っていれば取込後に一覧で選び直せます)。
            </p>
          ) : null}

          {preview.errors.length > 0 ? (
            <div className="mt-3">
              <AlertPanel
                tone="caution"
                title={`次の${preview.errors.length}件は取り込めません(元のExcel・CSVを直してから入れ直してください)`}
              >
                <ul className="space-y-1">
                  {preview.errors.map((e) => (
                    <li key={`${e.rowNumber}-${e.vehicleNo}`}>
                      {e.rowNumber}行目 車番{e.vehicleNo}: {e.reason}
                    </li>
                  ))}
                </ul>
              </AlertPanel>
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

        {vehicles.length === 0 ? (
          <div className="mt-3">
            <AlertPanel tone="caution" title="まだ1台も登録されていません">
              <p>
                このままだと、収支表は保険・税・リース料が0のまま(実際より黒字に見える状態)になります。
                上の「ファイルを取り込む」で社内Excel「★車両別収支計算用」を選んでください。
              </p>
              <p className="mt-1.5">
                車両を登録したら、
                <Link href={`/admin/driver-master?ym=${yearMonth}`} className="underline">
                  運転者マスタ管理
                </Link>
                →
                <Link href={`/import?ym=${yearMonth}`} className="underline">
                  データ取込
                </Link>
                の順に進むと収支表ができます。
              </p>
            </AlertPanel>
          </div>
        ) : null}

        {trailersWithoutTractor.length > 0 ? (
          <div className="mt-3">
            <AlertPanel
              tone="caution"
              title={`けん引先が決まっていないトレーラが${trailersWithoutTractor.length}台あります`}
            >
              <p>
                車番
                {trailersWithoutTractor.map((v) => v.vehicleNo).join("・")}
                。このままだと収支表に「売上ゼロ・費用だけの赤字行」として並びます。
                下の一覧の「けん引先」欄で、引くトラクタを選んでください。
              </p>
            </AlertPanel>
          </div>
        ) : null}

        <div className={`mt-3 overflow-x-auto ${vehicles.length === 0 ? "hidden" : ""}`}>
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
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
