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
import { yearMonthLabel, yen } from "../../../_lib/format";

/** 取込の3手順。手入力画面と同じ札を出し、いまどこにいるかを一目で分かるようにする。 */
const IMPORT_STEPS = [
  { label: "ファイルを選ぶ", badge: 1 },
  { label: "内容を確認する", badge: 2 },
  { label: "取り込む", badge: 3 },
] as const;

const COST_CATEGORY_LABELS: Record<string, string> = {
  "6.5t": "6.5t",
  large: "大型",
  semiTrailer: "セミトレーラ",
  unic: "ユニック",
  medium: "中型",
  trailer: "被けん引車（トレーラ）",
};

/**
 * 直せる金額の項目。
 * 原価区分は決まった語しか受け付けられず、自由入力にすると収支表の標準原価が黙って外れるため
 * ここには出さない (直したいときはファイルの入れ直しで行う)。
 */
const VEHICLE_MONEY_FIELDS = [
  { field: "insCompulsory", label: "自賠責" },
  { field: "insVoluntary", label: "任意保険" },
  { field: "taxAuto", label: "自動車税" },
  { field: "taxWeight", label: "重量税" },
  { field: "lease", label: "リース" },
  { field: "installment", label: "割賦" },
] as const;

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

/**
 * 車両マスタ管理。
 *
 * ■ 表か否か（T7 §4-1 の質問への答え）
 * 取込内容の確認も現在のマスタも「106台を行をまたいで見比べ、違う行だけを直す」ための
 * 画面なので、器は表のままでよい。1台を読んで判断する画面（/vehicle/[車番]）とは別。
 *
 * ■ 列見出しの固定（T7 §2-1）
 * 読むだけの表（取込内容の確認）は共通部品 DataTable に載せ、maxHeight で見出しを固定する。
 * 現在のマスタは1行が入力欄（TextEntryField / NumberEntryField）でできており、DataTable の
 * 「1列 = 1セル」の作りに載せると入力欄の作法（Enterで次の行・変更の札）が壊れる。
 * そこで表そのものは残し、「overflow の箱では sticky が効かないので高さの上限を与えて
 * 縦スクロールにする」という同じ理屈だけを当てて、列見出しを固定する。
 */
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

  /**
   * 直せる項目の宣言。入力欄・変更の色分け・未保存件数・まとめて保存・離れるときの確認は
   * 共通の土台 (app/_components/editForm) が受け持つので、画面はこの宣言だけを持つ。
   *
   * けん引先は「トレーラの行だけ直せる」。トラクタの行に出すと、選べてしまった時点で
   * 収支表の合算先が二重になり、どこで足されたのかを追えなくなる。
   */
  const vehicleFields = useMemo<EditableFieldDef<VehicleMasterRecord>[]>(
    () => [
      {
        field: "vehicleType",
        label: "車種名",
        kind: "text",
        widthClass: "w-32",
        emptyText: "未入力",
        read: (v) => v.vehicleType,
      },
      {
        field: "towedByVehicleNo",
        label: "けん引先",
        kind: "select",
        widthClass: "w-44",
        emptyText: "単独で表に出す",
        enabled: (v) => v.costCategory === "trailer",
        read: (v) => v.towedByVehicleNo ?? null,
        options: (v) => [
          { value: "", label: "単独で表に出す" },
          ...tractorCandidates(vehicles, v).map((t) => ({
            value: t.vehicleNo,
            label: `${t.vehicleNo}(${t.vehicleType})`,
          })),
        ],
      },
      {
        field: "depot",
        label: "所属",
        kind: "text",
        widthClass: "w-24",
        emptyText: "未入力",
        read: (v) => v.depot,
      },
      ...VEHICLE_MONEY_FIELDS.map(
        (c): EditableFieldDef<VehicleMasterRecord> => ({
          field: c.field,
          label: c.label,
          kind: "yen",
          unit: "円",
          widthClass: "w-28",
          read: (v) => {
            const raw = (v as unknown as Record<string, unknown>)[c.field];
            return raw === null || raw === undefined ? null : String(raw);
          },
        }),
      ),
    ],
    [vehicles],
  );

  async function reloadVehicles() {
    const listRes = await fetch("/api/admin/vehicle-master");
    const listData = (await listRes.json().catch(() => null)) as {
      vehicles?: VehicleMasterRecord[];
    } | null;
    if (listRes.ok && listData?.vehicles) setVehicles(listData.vehicles);
  }

  const form = useEditableRecords<VehicleMasterRecord>({
    records: vehicles,
    rowKey: (v) => v.vehicleNo,
    fields: vehicleFields,
    submit: async (changes) => {
      const result = await saveMasterChanges<VehicleMasterRecord>("vehicle")(changes);
      if (!result.error) {
        await reloadVehicles();
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
          `（新規${data.inserted ?? 0}台・更新${data.updated ?? 0}台${towed}）。` +
          (data.recalculated
            ? `${yearMonthLabel(yearMonth)}の収支表も作り直しました。`
            : `${yearMonthLabel(yearMonth)}の収支表はまだ作り直していません（データ取込が済んでから収支表を作成してください）。`),
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

  /** 取込内容の確認。読むだけの表なので共通部品に載せ、maxHeight で見出しを固定する。 */
  const previewColumns: DataTableColumn<VehicleMasterImportRow>[] = [
    {
      key: "kind",
      header: "区分",
      cell: (r) =>
        existingNos.has(r.vehicleNo) ? (
          <Badge tone="neutral">更新</Badge>
        ) : (
          <Badge tone="brand">新規</Badge>
        ),
    },
    { key: "vehicleNo", header: "車番", align: "right", cell: (r) => r.vehicleNo },
    { key: "vehicleType", header: "車種名", cell: (r) => r.vehicleType },
    {
      key: "costCategory",
      header: "原価区分",
      cellClassName: "text-ink-muted",
      cell: (r) => COST_CATEGORY_LABELS[r.costCategory] ?? r.costCategory,
    },
    {
      key: "towedBy",
      header: "けん引先",
      align: "right",
      cell: (r) => (r.towedByVehicleNo ? `→ ${r.towedByVehicleNo}` : "—"),
    },
    { key: "depot", header: "所属", priority: "low", cell: (r) => r.depot },
    { key: "insCompulsory", header: "自賠責", unit: "円", align: "right", cell: (r) => yen(r.insCompulsory) },
    { key: "insVoluntary", header: "任意保険", unit: "円", align: "right", cell: (r) => yen(r.insVoluntary) },
    { key: "taxAuto", header: "自動車税", unit: "円", align: "right", priority: "low", cell: (r) => yen(r.taxAuto) },
    { key: "taxWeight", header: "重量税", unit: "円", align: "right", priority: "low", cell: (r) => yen(r.taxWeight) },
    { key: "lease", header: "リース", unit: "円", align: "right", cell: (r) => yen(r.lease) },
    { key: "installment", header: "割賦", unit: "円", align: "right", priority: "low", cell: (r) => yen(r.installment) },
  ];

  return (
    <div className="space-y-6">
      <StickyStepHeader steps={IMPORT_STEPS} currentIndex={done ? 2 : check || preview ? 1 : 0} />

      {/*
        「どの月のシートを読むのか」「いま何台登録されているのか」は、一覧を下まで見ても
        要る前提なので上に貼り付ける（T7 §2-3）。この画面に工程タブはあるが、それは
        StickyStepHeader ではなく取込の3手順の札なので below は既定の "header" のまま。
      */}
      <StickyFilterBar
        summary={`登録${vehicles.length}台（けん引先が未設定のトレーラ${trailersWithoutTractor.length}台）`}
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
          accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          disabled={busy}
          aria-label="車両マスタのファイルを選ぶ"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void inspectThenUpload(file);
          }}
          className={`mt-3 ${FILE_FIELD_CLASS}`}
        />
        {/*
          どのファイルを選べばよいかの案内。ボタンより上に置くとボタンを画面外へ押し出すため、
          文章はそのままにボタン直下の折りたたみへ移した。
        */}
        <Disclosure tone="inline" summary="どのファイルを選べばよいですか?">
          社内Excel「★車両別収支計算用」をそのまま選んでください（{yearMonthLabel(yearMonth)}
          の収支表シートから車番・車種名・所属・保険・税・リース費・割賦費を読み取ります）。
          CSVに書き出す必要はありません。CSVを選ぶ場合は、その9列を書き出したものにしてください。
          車種名から原価カテゴリ（修繕費・タイヤ費の標準単価）を自動判定します。
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
        <section className="card p-5">
          <SectionHeading
            divider={false}
            action={
              <span className="num">
                新規{newCount}台・更新{updateCount}台
                {preview.errors.length > 0 ? ` / 取り込めない行${preview.errors.length}件` : ""}
              </span>
            }
          >
            取込内容の確認（{preview.fileName}）
          </SectionHeading>
          {sourceText ? <Prose className="mt-1">{sourceText}</Prose> : null}
          <Prose className="mt-1">
            この取込は、いま登録されている車両を削除しません。同じ車番は内容を上書きし、
            初めての車番は追加します。一覧から消したい車両があるときはご連絡ください。
          </Prose>

          {towedCount > 0 ? (
            <Prose className="mt-1">
              Excelの行の並び（トラクタの直下に被けん引車）から、けん引先を{towedCount}
              組復元しました。下の「けん引先」列で組み合わせを確かめてから取り込んでください
              （違っていれば取込後に一覧で選び直せます）。
            </Prose>
          ) : null}

          {preview.errors.length > 0 ? (
            <div className="mt-3">
              <AlertPanel
                tone="caution"
                title={`次の${preview.errors.length}件は取り込めません（元のExcel・CSVを直してから入れ直してください）`}
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

          <div className="mt-4">
            <DataTable
              caption="取り込む車両の一覧。区分・車番・保険・税・リース費を行ごとに見比べる。"
              columns={previewColumns}
              rows={preview.valid}
              rowKey={(r) => r.vehicleNo}
              maxHeight="26rem"
              empty={
                <p className="rounded-lg bg-subtle px-4 py-3 text-xs text-ink-muted">
                  取り込める行がありません。選んだファイルに車番の列が無いか、すべての行が
                  上の理由で取り込めない行です。元のExcel・CSVを直してから選び直してください。
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
              {/* 数える対象は車両なので、押す前も押した後も単位は「台」でそろえる（T7 §1-2） */}
              {busy ? "取り込んでいます…" : `${preview.valid.length}台を取り込む`}
            </button>
          </StickyActionBar>
        </section>
      ) : null}

      <section className="card p-5">
        <h2 className="text-sm font-bold text-ink">現在の車両マスタ({vehicles.length}台)</h2>
        {/*
          けん引先の仕組みの説明は、一覧を見るたびに読むものではない。常時出すと一覧より先に
          説明が目に入るので、折りたたみへ移す(文章はそのまま)。けん引先が決まっていない
          トレーラがあるときは、下の注意パネルが開かなくても出るので気づける。
        */}
        <Disclosure tone="inline" summary="けん引先を決めるとどうなりますか?">
          トレーラ（被けん引車）は運賃も運転者も付かないのに保険・税・リース料だけが付くため、
          けん引先を決めないと「売上ゼロ・費用だけの赤字行」として収支表に並びます。
          けん引先を選ぶとその行に合算され、車番は「129/1113」のようにまとめて表示されます
          （収支表は{yearMonthLabel(yearMonth)}分を作り直します）。
        </Disclosure>

        {vehicles.length === 0 ? (
          <div className="mt-3">
            <AlertPanel tone="caution" title="まだ1台も登録されていません">
              <p>
                このままだと、収支表は保険・税・リース料が0のまま（実際より黒字に見える状態）になります。
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

        <div className={vehicles.length === 0 ? "hidden" : ""}>
          <p className="mt-1 text-xs leading-relaxed text-ink-muted">
            直したいところを打ち替えて、画面の下の「保存する」を押してください。打ち替えた欄には
            「変更」の札と元の値が出ます。Enterを押すと同じ列の次の行へ進みます。
          </p>
          {/*
            入力欄の作法を壊さないため DataTable には載せず、表のままで列見出しだけを固定する。
            横スクロールできる箱を作った時点でその箱がスクロールの担当になり、ページの
            スクロールでは sticky が効かない。高さの上限を与えて縦にもスクロールさせるのが
            唯一確実な方法（T7 §2-1）。
          */}
          <div className="mt-3 max-h-[32rem] overflow-auto">
            <table className="data-table min-w-full text-sm">
              <thead className="sticky top-0 z-10 bg-white">
                <tr className="border-b border-line bg-subtle text-left text-xs text-ink-muted">
                  <th className="py-2 pr-3">車番</th>
                  <th className="py-2 pr-3">原価区分</th>
                  <th className="py-2 pr-3">車種名</th>
                  <th className="py-2 pr-3">けん引先</th>
                  <th className="py-2 pr-3">所属</th>
                  <th className="py-2 pr-3">自賠責</th>
                  <th className="py-2 pr-3">任意保険</th>
                  <th className="py-2 pr-3">自動車税</th>
                  <th className="py-2 pr-3">重量税</th>
                  <th className="py-2 pr-3">リース</th>
                  <th className="py-2 pr-3">割賦</th>
                </tr>
              </thead>
              <tbody>
                {vehicles.map((v) => (
                  <tr key={v.vehicleNo} className="border-b border-line last:border-b-0">
                    <td className="num py-2 pr-3 align-top">{v.vehicleNo}</td>
                    {/* 原価区分は直せない (決まった語しか受け付けられないため) ので読むだけの欄 */}
                    <td className="py-2 pr-3 align-top text-ink-muted">
                      {COST_CATEGORY_LABELS[v.costCategory] ?? v.costCategory}
                    </td>
                    <EditableRowCells
                      record={v}
                      rowKey={v.vehicleNo}
                      fields={vehicleFields}
                      draft={form.draftOf(v.vehicleNo)}
                      onChange={form.setField}
                      fieldErrorOf={form.fieldErrorOf}
                      rowLabel={`車番${v.vehicleNo}`}
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
            saveLabel="車両マスタを保存する"
            notice={
              form.changedCount > 0 ? (
                <p className="text-xs text-ink-muted">
                  保存すると、まだ締めていない月の収支表にその場で反映されます（締めた月はそのままです）。
                </p>
              ) : null
            }
          />
        </div>
      </section>
    </div>
  );
}
