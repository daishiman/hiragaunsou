"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { DriverMasterRecord } from "../../../../src/domain/repositories/MasterRepository";
import type {
  DriverMasterImportRow,
  DriverMasterImportRowError,
} from "../../../../src/infrastructure/parsers/driverMasterParser";
import {
  describeImportSource,
  type ImportSourceInfo,
} from "../../../../src/infrastructure/parsers/importSource";
import type { FileImportVerdict } from "../../../../src/domain/rules/fileImportCheck";
import { AlertPanel } from "../../../_components/AlertPanel";
import { Disclosure } from "../../../_components/Disclosure";
import { ImportCheckPanel } from "../../../_components/ImportCheckPanel";
import { StepRail } from "../../../_components/StepRail";

/**
 * 取込の3段階。手入力画面と同じ「札で現在地を出す」作りに揃える。
 * 押して跳べる札にはしない — ファイルを選ぶ前に「取り込む」へは進めないため。
 */
const IMPORT_STEPS = [
  { label: "ファイルを選ぶ", badge: 1 },
  { label: "内容を確認する", badge: 2 },
  { label: "取り込む", badge: 3 },
] as const;

interface Preview {
  fileName: string;
  valid: DriverMasterImportRow[];
  errors: DriverMasterImportRowError[];
  source?: ImportSourceInfo;
}

/** 取込前の確認。中身の判定に問題があったときだけ出す。 */
interface CheckState {
  file: File;
  verdict: FileImportVerdict;
  contentHash: string | null;
}

interface SkippedRow {
  employeeCode: string;
  driverName: string;
  vehicleNo: string;
  reason: string;
}

/**
 * 「対象月のシートが無かったので別の月で代用した」ときに続けて出す一文。
 * 車両マスタは金額、運転者マスタは人事の対応と、代用してよい理由が違う。
 */
const FALLBACK_NOTE =
  "社員Noと車番の対応は月ごとの実績ではなく人事の状態なので、この月から読んでも同じ対応表になります。";

export function DriverMasterManager({
  initialDrivers,
  vehicleNos,
  yearMonth,
}: {
  initialDrivers: DriverMasterRecord[];
  /**
   * 現在の車両マスタの車番。運転者の車番がここに無いと確定時に取り込まれないため、
   * 確定を押す前に「この人は取り込まれない」と分かるようにする。
   */
  vehicleNos: string[];
  /** 社内Excelのどの月のシートを読むかの手掛かり (年度ブック対策) */
  yearMonth: string;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [drivers, setDrivers] = useState(initialDrivers);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [skipped, setSkipped] = useState<SkippedRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [check, setCheck] = useState<CheckState | null>(null);
  /** 取込の記録に残す中身の指紋。次に同じファイルを選んだときの照合に使う。 */
  const [contentHash, setContentHash] = useState<string | null>(null);

  const existingCodes = useMemo(() => new Set(drivers.map((d) => d.employeeCode)), [drivers]);
  const knownVehicleNos = useMemo(() => new Set(vehicleNos), [vehicleNos]);
  const unassigned = drivers.filter((d) => !d.vehicleNo).length;

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
    setSkipped([]);
    setCheck(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("screen", "driver_master");
      const res = await fetch("/api/import/detect", { method: "POST", body: form });
      const data = (await res.json().catch(() => null)) as
        | { contentHash?: string; verdict?: FileImportVerdict }
        | null;
      if (res.ok && data?.verdict) {
        setContentHash(data.contentHash ?? null);
        if (data.verdict.status !== "ok") {
          setCheck({ file, verdict: data.verdict, contentHash: data.contentHash ?? null });
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
    setSkipped([]);
    setCheck(null);
    try {
      const form = new FormData();
      form.append("file", file);
      // 年度ブック(12か月分のシート)を渡されたとき、どの月のシートを見るかの手掛かり。
      form.append("yearMonth", yearMonth);
      const res = await fetch("/api/admin/driver-master", { method: "POST", body: form });
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
      const res = await fetch("/api/admin/driver-master/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          records: preview.valid,
          // 取込の記録に残す情報。次に同じファイルを選んだときの照合に使う。
          fileName: preview.fileName,
          contentHash,
        }),
      });
      const data = (await res.json().catch(() => null)) as
        | { inserted?: number; updated?: number; skipped?: SkippedRow[]; error?: string }
        | null;
      if (!res.ok || !data) {
        setError(data?.error ?? "取込に失敗しました");
        return;
      }
      setDone(
        `${(data.inserted ?? 0) + (data.updated ?? 0)}名を登録しました` +
          `(新規${data.inserted ?? 0}名・更新${data.updated ?? 0}名)`,
      );
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
  /** 車両マスタに無い車番の人。確定しても取り込まれないので、押す前に見せる。 */
  const unknownVehicleRows =
    preview?.valid.filter((r) => r.vehicleNo !== null && !knownVehicleNos.has(r.vehicleNo)) ?? [];
  const sourceText = describeImportSource(preview?.source, { fallbackNote: FALLBACK_NOTE });

  return (
    <div className="space-y-6">
      <StepRail steps={IMPORT_STEPS} currentIndex={done ? 2 : preview ? 1 : 0} />

      <section className="rounded-xl border border-line bg-white p-5">
        <h2 className="text-sm font-bold text-ink">ファイルを取り込む</h2>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void inspectThenUpload(file);
          }}
          className="mt-3 block w-full text-xs text-ink file:mr-3 file:rounded-md file:border file:border-line file:bg-subtle file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-ink"
        />
        {/*
          どのファイルを選べばよいかの案内は、ボタンより上に置くと毎回読み飛ばされたうえ
          ボタンを画面の下へ押し出していた。文章はそのままに、ボタンの直下の折りたたみへ移す。
        */}
        <Disclosure tone="inline" summary="どのファイルを選べばよいですか?">
          社内Excel「★車両別収支計算用」をそのまま選んでください({yearMonth}
          の収支表シートの「コード」「運転者名」「車番」から読み取ります)。
          CSVに書き出す必要はありません。CSVを選ぶ場合は、社員No・氏名・車番の3列を書き出したものにしてください。
          車番が空の方(内勤・退職等)も登録できます。給与が乗らないだけで、エラーにはなりません。
          ファイル名は変わっても構いません。中身を読んで判定します。
        </Disclosure>
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
                このあと月次の収支表を作り直すと、人件費が各車両に乗ります(
                <Link href={`/import?ym=${yearMonth}`} className="underline">
                  データ取込
                </Link>
                )。
              </p>
            </AlertPanel>
          </div>
        ) : null}

        {skipped.length > 0 ? (
          <div className="mt-3">
            <AlertPanel
              tone="caution"
              title={`${skipped.length}名は車番が車両マスタに無いため登録していません`}
            >
              <ul className="space-y-1">
                {skipped.map((s) => (
                  <li key={s.employeeCode}>
                    社員No{s.employeeCode} {s.driverName}(車番{s.vehicleNo}): {s.reason}
                  </li>
                ))}
              </ul>
              <p className="mt-1.5">
                先に
                <Link href={`/admin/vehicle-master?ym=${yearMonth}`} className="underline">
                  車両マスタ管理
                </Link>
                でこの車番を登録してから、もう一度取り込んでください。
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
              新規{newCount}名・更新{updateCount}名
              {preview.errors.length > 0 ? ` / 取り込めない行${preview.errors.length}件` : ""}
            </p>
          </div>
          {sourceText ? (
            <p className="mt-1 text-xs leading-relaxed text-ink-muted">{sourceText}</p>
          ) : null}
          <p className="mt-1 text-xs leading-relaxed text-ink-muted">
            この取込は、いま登録されている運転者を消しません。同じ社員Noの方は車番を上書きし、
            初めての社員Noの方は追加します。一覧から消したい方がいるときはご連絡ください。
          </p>

          {preview.errors.length > 0 ? (
            <div className="mt-3">
              <AlertPanel
                tone="caution"
                title={`次の${preview.errors.length}件は取り込めません(元のExcel・CSVを直してから入れ直してください)`}
              >
                <ul className="space-y-1">
                  {preview.errors.map((e) => (
                    <li key={`${e.rowNumber}-${e.employeeCode}`}>
                      {e.rowNumber}行目
                      {e.employeeCode ? ` 社員No${e.employeeCode}` : ""}: {e.reason}
                    </li>
                  ))}
                </ul>
              </AlertPanel>
            </div>
          ) : null}

          {unknownVehicleRows.length > 0 ? (
            <div className="mt-3">
              <AlertPanel
                tone="caution"
                title={`${unknownVehicleRows.length}名の車番が車両マスタにありません`}
              >
                <ul className="space-y-1">
                  {unknownVehicleRows.map((r) => (
                    <li key={r.employeeCode}>
                      社員No{r.employeeCode} {r.driverName}: 車番{r.vehicleNo}
                    </li>
                  ))}
                </ul>
                <p className="mt-1.5">
                  このまま取り込むと、この方たちだけ登録されません(残りの方は登録されます)。先に
                  <Link href={`/admin/vehicle-master?ym=${yearMonth}`} className="underline">
                    車両マスタ管理
                  </Link>
                  でこの車両を登録してから取り込むと、全員がそろいます。
                </p>
              </AlertPanel>
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
                    <td className="num py-2 text-ink-muted">
                      {r.vehicleNo === null ? (
                        "未割当"
                      ) : knownVehicleNos.has(r.vehicleNo) ? (
                        r.vehicleNo
                      ) : (
                        <span className="text-danger">{r.vehicleNo}(車両マスタに無し)</span>
                      )}
                    </td>
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
            {busy ? "取り込んでいます…" : `${preview.valid.length}名を取り込む`}
          </button>
        </section>
      ) : null}

      <section className="rounded-xl border border-line bg-white p-5">
        <h2 className="text-sm font-bold text-ink">
          現在の運転者マスタ({drivers.length}名
          {unassigned > 0 ? ` / うち車番未割当${unassigned}名` : ""})
        </h2>
        {drivers.length === 0 ? (
          <div className="mt-3">
            <AlertPanel tone="caution" title="まだ1名も登録されていません">
              <p>
                このままだと、給与を取り込んでも収支表の人件費は全車両0のままになります。
                上の「ファイルを取り込む」で社内Excel「★車両別収支計算用」を選んでください。
              </p>
              <p className="mt-1.5">
                車両マスタが空の場合は、先に
                <Link href={`/admin/vehicle-master?ym=${yearMonth}`} className="underline">
                  車両マスタ管理
                </Link>
                を済ませると、車番付きで登録できます。
              </p>
            </AlertPanel>
          </div>
        ) : (
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
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
