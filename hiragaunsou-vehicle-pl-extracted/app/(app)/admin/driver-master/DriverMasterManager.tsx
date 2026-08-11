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
import { StickyActionBar } from "../../../_components/StickyActionBar";
import { StickyFilterBar } from "../../../_components/StickyFilterBar";
import { StickyStepHeader } from "../../../_components/StickyStepHeader";
import { DataTable, type DataTableColumn } from "../../../_components/DataTable";
import { SectionHeading } from "../../../_components/SectionHeading";
import { Badge } from "../../../_components/Badge";
import { Prose } from "../../../_components/Card";
import { FILE_FIELD_CLASS } from "../../../_components/formStyles";
import {
  EditableRowCells,
  EditFormActionBar,
  saveMasterChanges,
  useEditableRecords,
  type EditableFieldDef,
} from "../../../_components/editForm";
import { yearMonthLabel } from "../../../_lib/format";

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

/**
 * 運転者マスタ管理。
 *
 * ■ 表か否か（T7 §4-1 の質問への答え）
 * 取込内容の確認も現在のマスタも「何十名かを行をまたいで見比べ、車番の違う人だけを直す」
 * ための画面なので、器は表のままでよい。1名を読んで判断する画面ではない。
 *
 * ■ 列見出しの固定（T7 §2-1）
 * 読むだけの表（取込内容の確認）は共通部品 DataTable に載せ、maxHeight で見出しを固定する。
 * 現在のマスタは1行が入力欄（editForm の EditableRowCells）でできており、DataTable の
 * 「1列 = 1セル」の作りに載せると入力欄の作法（Enterで次の行・変更の札）が壊れる。
 * そこで表そのものは残し、「overflow の箱では sticky が効かないので高さの上限を与えて
 * 縦スクロールにする」という同じ理屈だけを当てて、列見出しを固定する。
 */
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
   * 直せる項目の宣言。入力欄・変更の色分け・未保存件数・まとめて保存は
   * 共通の土台 (app/_components/editForm) が受け持つので、画面はこの宣言だけを持つ。
   *
   * 車番は自由入力ではなく選択にする。車両マスタに無い車番を打つと、
   * 「登録したのに給与が乗らない」という一番追いにくい壊れ方になるため、打てないようにする。
   */
  const driverFields = useMemo<EditableFieldDef<DriverMasterRecord>[]>(
    () => [
      {
        field: "driverName",
        label: "氏名",
        kind: "text",
        required: true,
        emptyText: "氏名なし",
        widthClass: "w-40",
        read: (d) => d.driverName,
      },
      {
        field: "vehicleNo",
        label: "車番",
        kind: "select",
        emptyText: "未割当",
        widthClass: "w-44",
        read: (d) => d.vehicleNo,
        options: (d) => [
          { value: "", label: "未割当（給与は乗りません）" },
          ...vehicleNos.map((no) => ({ value: no, label: no })),
          // いまの車番が車両マスタから消えている場合でも、選び直すまでは表示できるようにする
          ...(d.vehicleNo && !knownVehicleNos.has(d.vehicleNo)
            ? [{ value: d.vehicleNo, label: `${d.vehicleNo}（車両マスタに無し）` }]
            : []),
        ],
      },
    ],
    [vehicleNos, knownVehicleNos],
  );

  async function reloadDrivers() {
    const listRes = await fetch("/api/admin/driver-master");
    const listData = (await listRes.json().catch(() => null)) as {
      drivers?: DriverMasterRecord[];
    } | null;
    if (listRes.ok && listData?.drivers) setDrivers(listData.drivers);
  }

  const form = useEditableRecords<DriverMasterRecord>({
    records: drivers,
    rowKey: (d) => d.employeeCode,
    fields: driverFields,
    submit: async (changes) => {
      const result = await saveMasterChanges<DriverMasterRecord>("driver")(changes);
      if (!result.error) {
        await reloadDrivers();
        router.refresh();
      }
      return result;
    },
  });

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
          `（新規${data.inserted ?? 0}名・更新${data.updated ?? 0}名）`,
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

  /** 取込内容の確認。読むだけの表なので共通部品に載せ、見出しを固定する。 */
  const previewColumns: DataTableColumn<DriverMasterImportRow>[] = [
    {
      key: "kind",
      header: "区分",
      cell: (r) =>
        existingCodes.has(r.employeeCode) ? (
          <Badge tone="neutral">更新</Badge>
        ) : (
          <Badge tone="brand">新規</Badge>
        ),
    },
    {
      key: "employeeCode",
      header: "社員No",
      align: "right",
      cell: (r) => r.employeeCode,
    },
    { key: "driverName", header: "氏名", cell: (r) => r.driverName },
    {
      key: "vehicleNo",
      header: "車番",
      align: "right",
      cell: (r) =>
        r.vehicleNo === null ? (
          "未割当"
        ) : knownVehicleNos.has(r.vehicleNo) ? (
          r.vehicleNo
        ) : (
          <span className="text-danger">{r.vehicleNo}（車両マスタに無し）</span>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <StickyStepHeader steps={IMPORT_STEPS} currentIndex={done ? 2 : preview ? 1 : 0} />

      {/*
        「どの月のシートを読むのか」「いま何名登録されているのか」は一覧を下まで見ても要る
        前提なので上に貼り付ける（T7 §2-3）。取込の3手順も StickyStepHeader なので、
        その直下へ積み重ねる。
      */}
      <StickyFilterBar
        below="stepHeader"
        summary={`登録${drivers.length}名（うち車番未割当${unassigned}名）`}
      >
        <span className="text-xs font-semibold text-ink">
          読み取る対象年月：{yearMonthLabel(yearMonth)}
        </span>
      </StickyFilterBar>

      <section className="card p-5">
        <h2 className="text-sm font-bold text-ink">ファイルを取り込む</h2>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          disabled={busy}
          aria-label="運転者マスタのファイルを選ぶ"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void inspectThenUpload(file);
          }}
          className={`mt-3 ${FILE_FIELD_CLASS}`}
        />
        {/*
          どのファイルを選べばよいかの案内は、ボタンより上に置くと毎回読み飛ばされたうえ
          ボタンを画面の下へ押し出していた。文章はそのままに、ボタンの直下の折りたたみへ移す。
        */}
        <Disclosure tone="inline" summary="どのファイルを選べばよいですか?">
          社内Excel「★車両別収支計算用」をそのまま選んでください（{yearMonthLabel(yearMonth)}
          の収支表シートの「コード」「運転者名」「車番」から読み取ります）。
          CSVに書き出す必要はありません。CSVを選ぶ場合は、社員No・氏名・車番の3列を書き出したものにしてください。
          車番が空の方（内勤・退職等）も登録できます。給与が乗らないだけで、エラーにはなりません。
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
                このあと月次の収支表を作り直すと、人件費が各車両に乗ります（
                <Link href={`/import?ym=${yearMonth}`} className="underline">
                  データ取込
                </Link>
                ）。
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
                    社員No{s.employeeCode} {s.driverName}（車番{s.vehicleNo}）: {s.reason}
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
        <section className="card p-5">
          <SectionHeading
            divider={false}
            action={
              <span className="num">
                新規{newCount}名・更新{updateCount}名
                {preview.errors.length > 0 ? ` / 取り込めない行${preview.errors.length}件` : ""}
              </span>
            }
          >
            取込内容の確認（{preview.fileName}）
          </SectionHeading>
          {sourceText ? <Prose className="mt-1">{sourceText}</Prose> : null}
          <Prose className="mt-1">
            この取込は、いま登録されている運転者を削除しません。同じ社員Noの方は車番を上書きし、
            初めての社員Noの方は追加します。一覧から消したい方がいるときはご連絡ください。
          </Prose>

          {preview.errors.length > 0 ? (
            <div className="mt-3">
              <AlertPanel
                tone="caution"
                title={`次の${preview.errors.length}件は取り込めません（元のExcel・CSVを直してから入れ直してください）`}
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
                  このまま取り込むと、この方たちだけ登録されません（残りの方は登録されます）。先に
                  <Link href={`/admin/vehicle-master?ym=${yearMonth}`} className="underline">
                    車両マスタ管理
                  </Link>
                  でこの車両を登録してから取り込むと、全員がそろいます。
                </p>
              </AlertPanel>
            </div>
          ) : null}

          <div className="mt-4">
            <DataTable
              caption="取り込む運転者の一覧。区分・社員No・氏名・車番。"
              columns={previewColumns}
              rows={preview.valid}
              rowKey={(r) => r.employeeCode}
              maxHeight="26rem"
              empty={
                <p className="rounded-lg bg-subtle px-4 py-3 text-sm text-ink-muted">
                  取り込める行がありませんでした。上の取り込めない行の理由を直してから、
                  もう一度ファイルを選んでください。
                </p>
              }
            />
          </div>

          {/* 一覧が長くても取り込みの入口が画面外に出ないよう、カードの下端に貼り付ける */}
          <StickyActionBar variant="card">
            <button
              type="button"
              disabled={busy || preview.valid.length === 0}
              onClick={() => void confirm()}
              className="btn btn-primary pressable"
            >
              {busy ? "取り込んでいます…" : `${preview.valid.length}名を取り込む`}
            </button>
          </StickyActionBar>
        </section>
      ) : null}

      <section className="card p-5">
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
          <>
            <Prose className="mt-1">
              直したいところを打ち替えて、画面の下の「保存する」を押してください。打ち替えた欄には
              「変更」の札と元の値が出ます。Enterを押すと同じ列の次の行へ進みます。
            </Prose>
            {/*
              1行が入力欄なので DataTable には載せられない（EditableRowCells が複数の td を出す）。
              代わりに T7 §2-1 の理屈だけを当てる: overflow の箱がスクロールを引き受けると
              sticky は画面ではなく箱を基準にするので、箱に高さの上限を与えて縦にもスクロール
              させ、その中で列見出しを貼り付ける。
            */}
            <div className="mt-3 max-h-[32rem] overflow-auto">
              <table className="data-table min-w-full text-sm">
                <thead className="sticky top-0 z-10 bg-white">
                  <tr className="border-b border-line bg-subtle text-left text-xs text-ink-muted">
                    <th className="py-2 pr-3">社員No</th>
                    <th className="py-2 pr-3">氏名</th>
                    <th className="py-2">車番</th>
                  </tr>
                </thead>
                <tbody>
                  {drivers.map((d) => (
                    <tr key={d.employeeCode} className="border-b border-line last:border-b-0">
                      <td className="num py-2 pr-3 align-top">{d.employeeCode}</td>
                      <EditableRowCells
                        record={d}
                        rowKey={d.employeeCode}
                        fields={driverFields}
                        draft={form.draftOf(d.employeeCode)}
                        onChange={form.setField}
                        fieldErrorOf={form.fieldErrorOf}
                        rowLabel={`社員No${d.employeeCode} ${d.driverName}`}
                        cellClassName="py-2 pr-3 align-top"
                      />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* 保存の入口・未保存件数・離れるときの確認は共通の帯に任せる */}
            <EditFormActionBar
              form={form}
              variant="card"
              saveLabel="運転者マスタを保存する"
              notice={
                form.changedCount > 0 ? (
                  <p className="text-xs text-ink-muted">
                    保存すると、まだ締めていない月の収支表にその場で反映されます（締めた月はそのままです）。
                  </p>
                ) : null
              }
            />
          </>
        )}
      </section>
    </div>
  );
}
