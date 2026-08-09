"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { IMPORT_SOURCES, type ImportSourceType } from "../../../src/domain/rules/importSources";
import { MONTHLY_PL_WORKBOOK_SOURCE_TYPE } from "../../../src/usecase/steps/importMonthlyPlWorkbook";
import { Disclosure } from "../../_components/Disclosure";
import { StickyActionBar } from "../../_components/StickyActionBar";
import { StickyStepHeader } from "../../_components/StickyStepHeader";
import type { FileImportVerdict } from "../../../src/domain/rules/fileImportCheck";
import { ImportCheckPanel } from "../../_components/ImportCheckPanel";
import { selectableYearMonths } from "../../_lib/yearMonth";

type Batch = { fileName: string; rowCount: number; importedAt: number };

type Result = {
  ok: boolean;
  fileName: string;
  message: string;
  basis?: string;
  /** 取り込めたが先に進めない理由があるときの、直しに行く先。 */
  fix?: { href: string; label: string };
};

type Conflict = {
  sourceType: ImportSourceType;
  file: File;
  yearMonth: string;
  sameFileName: boolean;
  superseded: Batch[];
};

/** 下読み(/api/import/detect)の応答。判定結果と、その判定に使った中身の指紋。 */
type Detection = {
  yearMonth: string | null;
  basis: string;
  candidates: string[];
  contentHash?: string;
  verdict?: FileImportVerdict;
};

/** 取込前の確認。中身の判定に問題があったときだけ出す(問題なしならそのまま取り込む)。 */
type CheckState = {
  sourceType: ImportSourceType;
  file: File;
  verdict: FileImportVerdict;
  contentHash: string | null;
  chosen: string;
};

/** YYYY-MM を「2026年5月」の業務の言葉にする。 */
function describeYearMonth(yearMonth: string): string {
  const [year, month] = yearMonth.split("-");
  return `${year}年${Number(month)}月`;
}

function formatDateTime(epochMs: number): string {
  return new Date(epochMs).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** 取込成功時、帳票ごとに意味のある件数だけを一行にまとめる。 */
function describeResult(data: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof data.sourceSheet === "string") parts.push(`シート「${data.sourceSheet}」`);
  if (typeof data.vehicleCount === "number") parts.push(`車両 ${data.vehicleCount} 台`);
  else if (typeof data.totalRows === "number") parts.push(`${data.totalRows} 件`);
  if (typeof data.charteredExcluded === "number" && data.charteredExcluded > 0) {
    parts.push(`傭車 ${data.charteredExcluded} 件を除外`);
  }
  if (typeof data.needsReviewCount === "number" && data.needsReviewCount > 0) {
    parts.push(`要確認 ${data.needsReviewCount} 件`);
  }
  return parts.join(" ／ ") || "取り込みました";
}

/**
 * 取込のあとに収支表の下地を作れたかどうかを、業務の言葉で1行にする。
 *
 * 取込は成功しているのに手入力の自動計算値・月次収支表・年間集計が空のまま、という状態が
 * 起きていた。取込のたびに下地を作り直すようにしたので、その結果まで画面に出して
 * 「取り込んだのに何も変わらない」という見え方を残さない。
 */
export function describePlRebuild(value: unknown): {
  text: string;
  fix?: { href: string; label: string };
} {
  if (typeof value !== "object" || value === null) return { text: "" };
  const r = value as { status?: string; vehicleCount?: number; reason?: string };
  if (r.status === "built") {
    return { text: `。収支表の下地を ${r.vehicleCount ?? 0} 台分作りました` };
  }
  if (r.status !== "skipped") return { text: "" };
  if (r.reason === "imports_incomplete") {
    return { text: "。収支表は運行実績と売上の両方が揃うと作られます" };
  }
  if (r.reason === "confirmed") {
    return { text: "。この月は確定済みのため収支表は作り直していません" };
  }
  if (r.reason === "no_vehicle_master") {
    /*
      収支表の行は車両マスタの車両から作られるので、マスタが空だと何度取り込んでも0台のまま。
      ここで「0台分作りました」と言うと、利用者は取込をやり直す以外に打つ手が無くなる。
      真因(車両マスタが空)を名指しし、直しに行く先まで出す。
    */
    return {
      text: "。ただし車両マスタに車両が1台も登録されていないため、収支表はまだ作れません",
      fix: { href: "/admin/vehicle-master", label: "車両マスタを登録する" },
    };
  }
  return { text: "。収支表の作り直しに失敗しました(手入力画面から作り直せます)" };
}

/**
 * 業務フローのSTEPごとに投入口を分けた取込画面。
 * 種別を利用者に選ばせるのではなく「どのSTEPの帳票か」を投入口で固定し、
 * サーバー側の自動判定は取り違え検知に使う。送信は1件ずつ直列に行う。
 */
/** ?step=1 のような業務フロー番号を、その帳票のsourceTypeへ読み替える */
function sourceTypeFromWorkflowStep(step: string | null): ImportSourceType | null {
  if (!step) return null;
  const stepLabel = `STEP${step}`;
  return IMPORT_SOURCES.find((s) => s.step === stepLabel)?.sourceType ?? null;
}

export function ImportForm({
  yearMonth,
  imported,
  initialWorkflowStep = null,
}: {
  yearMonth: string;
  imported: Record<string, Batch[]>;
  initialWorkflowStep?: string | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<ImportSourceType | null>(null);
  // 「中身を確認中」と「取込中」は待たされる理由が違うので、画面の文言を分ける。
  const [phase, setPhase] = useState<"inspecting" | "uploading">("uploading");
  const [results, setResults] = useState<Partial<Record<ImportSourceType, Result>>>({});
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [check, setCheck] = useState<CheckState | null>(null);

  const doneCount = IMPORT_SOURCES.filter((source) => (imported[source.sourceType] ?? []).length > 0).length;

  // 収支表の下地は運行実績と売上の2つで作られる。この2つが揃った時点で先へ進めるので、
  // 4つ全部を待たずに次の手順を案内する。
  const importsReady =
    (imported["vehicle_operation"] ?? []).length > 0 && (imported["sales_monitor"] ?? []).length > 0;

  // ホームの各STEPカード「この手順を開く」から来たときは、その帳票を主役にする。
  // サイドバー「データ取込」から来たとき(指定なし)は、まだ取り込んでいない最初の帳票を
  // 自動で主役にする。取り込むたびに imported が更新され、次の帳票へ自動で主役が移る
  // ("STEP1が終わったらSTEP2が出てくる"という進行を、押し進めるボタンなしで実現する)。
  const explicitFocusSourceType = sourceTypeFromWorkflowStep(initialWorkflowStep);
  const nextIncompleteSource = IMPORT_SOURCES.find(
    (source) => (imported[source.sourceType] ?? []).length === 0,
  );
  /*
    全部取り込み終えたときの主役。一覧の最後は「答え合わせ用Excel」で、これは業務ステップでは
    無い(取り込んでも収支表の数値は1つも変わらない)。そこへ主役が落ちると、締め作業が
    終わっていないのに「次は答え合わせ」に見えてしまうので、最後の業務帳票(給与集計表)に留める。
  */
  const lastWorkflowSource =
    [...IMPORT_SOURCES].reverse().find((s) => s.sourceType !== MONTHLY_PL_WORKBOOK_SOURCE_TYPE) ??
    IMPORT_SOURCES[0]!;
  const focusSourceType =
    explicitFocusSourceType ?? nextIncompleteSource?.sourceType ?? lastWorkflowSource.sourceType;

  /**
   * ファイルを選んだ直後の下読み。ファイル名ではなく中身から
   * 「何の帳票か」「何年何月分か」「必要な列が揃っているか」「前に取り込んでいないか」を聞きに行く。
   *
   * 問題が無ければ確認を挟まずそのまま取り込む(毎月何度も通る操作に摩擦を足すと、
   * 本当に止めたいときの確認まで読み飛ばされる)。問題があれば必ず止めて利用者に確定させる。
   * 判定と文言のルールは docs/product/file-import-common-spec.md。
   */
  async function inspectThenUpload(sourceType: ImportSourceType, file: File) {
    setPhase("inspecting");
    setPending(sourceType);
    setConflict(null);
    setCheck(null);
    setResults((prev) => ({ ...prev, [sourceType]: undefined }));

    let detection: Detection = {
      yearMonth: null,
      basis: "ファイルの中身を確認できませんでした。何年何月分として取り込むかを選んでください。",
      candidates: [],
    };
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("screen", "import");
      form.append("expectedSourceType", sourceType);
      form.append("expectedYearMonth", yearMonth);
      const res = await fetch("/api/import/detect", { method: "POST", body: form });
      if (res.ok) detection = (await res.json()) as Detection;
    } catch {
      // 下読みに失敗しても取込自体は続けられる。年月は利用者に選んでもらう。
    }
    setPending(null);

    const verdict = detection.verdict;
    if (verdict && verdict.status === "ok") {
      void upload(sourceType, file, yearMonth, false, false, detection.basis, detection.contentHash);
      return;
    }
    if (verdict) {
      setCheck({
        sourceType,
        file,
        verdict,
        contentHash: detection.contentHash ?? null,
        chosen: verdict.suggestedYearMonth ?? yearMonth,
      });
      return;
    }
    // 下読み自体に到達できなかったとき。年月だけは必ず人に確定させる。
    setCheck({
      sourceType,
      file,
      contentHash: null,
      verdict: {
        summary: "中身を確認できませんでした",
        basis: detection.basis,
        status: "confirm",
        issues: [
          {
            kind: "yearMonthUnknown",
            title: "この取込は何年何月分ですか?",
            body: "ファイルの中身を確認できませんでした。取り込む年月を選んでください。",
            link: null,
          },
        ],
        confirmLabel: "この内容で取り込む",
        needsYearMonthChoice: true,
        suggestedYearMonth: yearMonth,
      },
      chosen: yearMonth,
    });
  }

  async function upload(
    sourceType: ImportSourceType,
    file: File,
    targetYearMonth: string,
    replace: boolean,
    confirmYearMonth = false,
    basis?: string,
    contentHash?: string | null,
  ) {
    setPhase("uploading");
    setPending(sourceType);
    setConflict(null);
    setCheck(null);
    const form = new FormData();
    form.append("file", file);
    form.append("yearMonth", targetYearMonth);
    if (replace) form.append("replace", "true");
    if (confirmYearMonth) form.append("confirmYearMonth", "true");
    // 取込の記録に残す中身の指紋。次に同じファイルを選んだときの照合に使う。
    if (contentHash) form.append("contentHash", contentHash);

    try {
      // サーバーに全く到達できなかった場合(オフライン・DNS失敗等)と、サーバーが
      // 応答した場合とで、利用者に伝えるべき対処が違うため区別する。
      let res: Response;
      try {
        res = await fetch(`/api/import/${sourceType}`, { method: "POST", body: form });
      } catch {
        setResults((prev) => ({
          ...prev,
          [sourceType]: {
            ok: false,
            fileName: file.name,
            message: "サーバーに接続できませんでした(通信エラー)。ネットワーク環境を確認し、再度お試しください。",
          },
        }));
        return;
      }

      // サーバーには到達したが、想定外の異常(未処理例外でJSONを返せなかった等)でレスポンス本文が
      // JSONとして読めない場合。「通信エラー」と混同すると調査対象を誤るため、別文言にする。
      let data: Record<string, unknown>;
      try {
        data = (await res.json()) as Record<string, unknown>;
      } catch {
        setResults((prev) => ({
          ...prev,
          [sourceType]: {
            ok: false,
            fileName: file.name,
            message: `サーバー側で問題が発生し、結果を読み取れませんでした(HTTP ${res.status})。時間をおいて再度お試しいただくか、解決しない場合は管理者にご連絡ください。`,
          },
        }));
        return;
      }

      if (res.status === 409 && data.error === "yearMonthMismatch") {
        // 下読みをすり抜けた取り違え(サーバー側の最終チェック)。同じ確認画面に集約する。
        const m = data.yearMonthMismatch as {
          detectedYearMonth: string;
          matchedRows: number;
          dominantCount: number;
        };
        setCheck({
          sourceType,
          file,
          contentHash: contentHash ?? null,
          verdict: {
            summary: `「${IMPORT_SOURCES.find((s) => s.sourceType === sourceType)?.label ?? "この帳票"}」 / ${describeYearMonth(m.detectedYearMonth)}分`,
            basis: `日付を読み取れた${m.matchedRows}件のうち${m.dominantCount}件が${describeYearMonth(m.detectedYearMonth)}でした。`,
            status: "confirm",
            issues: [
              {
                kind: "yearMonthMismatch",
                title: "この取込は何年何月分ですか?",
                body: `選ばれたファイルは${describeYearMonth(m.detectedYearMonth)}分ですが、いま作成中なのは${describeYearMonth(targetYearMonth)}分です。どちらの月として取り込むか選んでください。`,
                link: null,
              },
            ],
            confirmLabel: `${describeYearMonth(m.detectedYearMonth)}分として取り込む`,
            needsYearMonthChoice: true,
            suggestedYearMonth: m.detectedYearMonth,
          },
          chosen: m.detectedYearMonth,
        });
        return;
      }
      if (res.status === 409) {
        const c = data.conflict as { sameFileName: boolean; superseded: Batch[] };
        setConflict({
          sourceType,
          file,
          yearMonth: targetYearMonth,
          sameFileName: c.sameFileName,
          superseded: c.superseded,
        });
        return;
      }
      if (!res.ok) {
        setResults((prev) => ({
          ...prev,
          [sourceType]: {
            ok: false,
            fileName: file.name,
            message: String(data.error ?? `取込に失敗しました(HTTP ${res.status})`),
          },
        }));
        return;
      }
      const rebuild = describePlRebuild(data.plRebuild);
      setResults((prev) => ({
        ...prev,
        [sourceType]: {
          ok: true,
          fileName: file.name,
          message: `${describeYearMonth(targetYearMonth)}分として取り込みました（${describeResult(data)}）${rebuild.text}`,
          basis,
          fix: rebuild.fix,
        },
      }));
      // 画面で見ている月と違う月に取り込んだときは、その月の取込状況へ切り替える。
      // 取り込んだはずのファイルが一覧に出てこない、という食い違いを残さない。
      if (targetYearMonth !== yearMonth) {
        router.replace(`/import?ym=${targetYearMonth}`);
        return;
      }
      router.refresh();
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand bg-brand-soft px-5 py-4">
        <label className="flex items-center gap-2 text-sm font-semibold text-ink">
          対象年月
          <select
            value={yearMonth}
            disabled={pending !== null}
            onChange={(e) => {
              setResults({});
              setConflict(null);
              setCheck(null);
              router.replace(`/import?ym=${e.target.value}`);
            }}
            className="rounded-md border border-line bg-white px-2 py-1 text-sm font-normal text-ink"
          >
            {selectableYearMonths(25).map((ym) => (
              <option key={ym} value={ym}>{ym}</option>
            ))}
          </select>
        </label>
        {/*
          「4 / 4 完了」とだけ出すと、締め作業そのものが終わったように読める。
          ここで数えているのは取り込むファイルの数だけなので、そう書く。
        */}
        <p className="text-sm font-semibold text-brand-deep">
          取り込むファイル {doneCount} / {IMPORT_SOURCES.length} 件
        </p>
        {/*
          取込のときに何が起きるかの説明。毎月同じ文章を読む必要は無いので、
          文章はそのままに、知りたい人だけが開く折りたたみへ移した。
        */}
        <div className="w-full">
          <Disclosure tone="inline" summary="ファイルを選ぶと何が起きますか?">
            ファイルを選ぶと中身を読んで何年何月分かを確認します。ここで選んだ月と違っていたときや、
            中身に日付が無い帳票のときは、取り込む前にお尋ねします。
          </Disclosure>
        </div>
      </section>

      {/* どの帳票まで進んだかを、手入力画面と同じステップ札で示す */}
      <StickyStepHeader
        steps={IMPORT_SOURCES.map((s) => ({ label: s.label, badge: s.step }))}
        currentIndex={
          nextIncompleteSource
            ? IMPORT_SOURCES.findIndex((s) => s.sourceType === nextIncompleteSource.sourceType)
            : IMPORT_SOURCES.length
        }
      />

      <p className="text-xs font-semibold text-ink-muted">
        {nextIncompleteSource
          ? "取り込み終えた帳票と、まだの帳票は畳んでいます。他の帳票が必要なときはタップして開けます。"
          : "すべて取込済みです。内容を直したいときはタップして開けます。"}
      </p>

      {[...IMPORT_SOURCES].sort((a, b) => {
        if (!focusSourceType) return 0;
        if (a.sourceType === focusSourceType) return -1;
        if (b.sourceType === focusSourceType) return 1;
        return 0;
      }).map((source) => {
        const batches = imported[source.sourceType] ?? [];
        const result = results[source.sourceType];
        const isPending = pending === source.sourceType;
        const isConflicting = conflict?.sourceType === source.sourceType;
        const isChecking = check?.sourceType === source.sourceType;
        // ホームの特定STEPカードから来たときは、その帳票だけを主役にして他を畳む。
        // フォーカス無し(サイドバー「データ取込」から直接来た)ときは全部を並列に見せる。
        const isFocused = !focusSourceType || source.sourceType === focusSourceType;

        const body = (
          <>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-xs font-semibold text-brand-deep">{source.step}</p>
                <h2 className="text-base font-bold text-ink">{source.label}</h2>
                <p className="mt-0.5 text-xs text-ink-muted">{source.system}</p>
              </div>
              <span
                className={
                  batches.length > 0
                    ? "rounded-full bg-brand-soft px-3 py-1 text-xs font-semibold text-brand-deep"
                    : "rounded-full border border-dashed border-line bg-white px-3 py-1 text-xs font-semibold text-ink-muted"
                }
              >
                {batches.length > 0 ? `✓ 取込済み ${batches.length}件` : "未取込"}
              </span>
            </div>

            <p className="mt-2 text-xs text-ink-muted">{source.hint}</p>

            {batches.length > 0 ? (
              <ul className="mt-3 space-y-1 border-l-2 border-line pl-3">
                {batches.map((batch) => (
                  <li key={`${batch.fileName}-${batch.importedAt}`} className="text-xs text-ink-muted">
                    {batch.fileName}（{batch.rowCount}件・{formatDateTime(batch.importedAt)} 取込）
                  </li>
                ))}
              </ul>
            ) : null}

            {isChecking ? (
              <ImportCheckPanel
                fileName={check.file.name}
                verdict={check.verdict}
                yearMonth={check.chosen}
                onYearMonthChange={(ym) => setCheck({ ...check, chosen: ym })}
                onConfirm={() =>
                  void upload(
                    check.sourceType,
                    check.file,
                    check.chosen,
                    false,
                    true,
                    check.verdict.basis,
                    check.contentHash,
                  )
                }
                onCancel={() => setCheck(null)}
              />
            ) : null}

            {isConflicting ? (
              // border-warning / bg-amber-50 は本プロジェクトのトークンに存在せず
              // 枠線が消えていた。注意の面は caution トークンで描く。
              <div className="mt-4 rounded-lg border border-caution-border bg-caution-soft p-4">
                <p className="text-sm font-bold text-ink">
                  {conflict.sameFileName
                    ? `「${conflict.file.name}」は既に取り込み済みです。入れ直しますか?`
                    : `${describeYearMonth(conflict.yearMonth)}の${source.label}は既に取り込み済みです。入れ直しますか?`}
                </p>
                <p className="mt-2 text-xs leading-5 text-ink">
                  入れ直すと、下記の既存データは<strong>削除</strong>されてから新しいファイルの内容に置き換わります。削除したデータは元に戻せません。
                </p>
                <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-ink-muted">
                  {conflict.superseded.map((batch) => (
                    <li key={`${batch.fileName}-${batch.importedAt}`}>
                      {batch.fileName}（{batch.rowCount}件・{formatDateTime(batch.importedAt)} 取込）
                    </li>
                  ))}
                </ul>
                {conflict.sourceType === "sales_monitor" ? (
                  // 整形判断は伝票の自然キー(管理№-行№)に紐づくため、取込をやり直しても残る。
                  // 「全部やり直しになる」と誤解して入れ直しを避けるのを防ぐ。
                  <p className="mt-2 text-xs leading-5 text-ink-muted">
                    データ整形(STEP2)で下した判断は伝票ごとに保存されているため、入れ直しても引き継がれます。
                  </p>
                ) : null}
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => void upload(conflict.sourceType, conflict.file, conflict.yearMonth, true, true)}
                    className="rounded-md bg-brand-deep px-4 py-2 text-sm font-semibold text-white"
                  >
                    削除して入れ直す
                  </button>
                  <button
                    type="button"
                    onClick={() => setConflict(null)}
                    className="rounded-md border border-line px-4 py-2 text-sm font-semibold text-ink"
                  >
                    キャンセル
                  </button>
                </div>
              </div>
            ) : isChecking ? null : (
              <input
                type="file"
                accept={source.accept}
                // 投入口が4つ並ぶので、読み上げでも「どの帳票の欄か」が分かる名前を付ける
                aria-label={`${source.label}のファイルを選ぶ`}
                disabled={pending !== null}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void inspectThenUpload(source.sourceType, file);
                }}
                className="mt-3 block max-w-full text-sm text-ink file:mr-3 file:rounded-md file:border file:border-brand file:bg-white file:px-4 file:py-2 file:text-sm file:font-semibold file:text-brand-deep hover:file:bg-brand-soft disabled:opacity-50"
              />
            )}

            {isPending ? (
              <p className="mt-2 text-xs text-ink-muted">
                {phase === "inspecting" ? "ファイルの中身を確認しています…" : "取り込んでいます…"}
              </p>
            ) : null}
            {result && !isConflicting && !isChecking ? (
              <div className="mt-2">
                <p className={`text-xs leading-5 ${result.ok ? "text-ink-muted" : "text-danger"}`}>
                  {result.fileName}: {result.message}
                </p>
                {/* どの根拠でその月と判定したかを残す。あとから「なぜこの月に入ったのか」を追える。 */}
                {result.ok && result.basis ? (
                  <p className="text-xs leading-5 text-ink-muted">{result.basis}</p>
                ) : null}
                {result.fix ? (
                  <Link
                    href={result.fix.href}
                    className="mt-1 inline-block text-xs font-semibold text-brand-deep underline"
                  >
                    {result.fix.label}
                  </Link>
                ) : null}
              </div>
            ) : null}
          </>
        );

        if (isFocused) {
          return (
            <section key={source.sourceType} className="card p-5">
              {body}
            </section>
          );
        }

        return (
          <details
            key={source.sourceType}
            className="group rounded-lg border border-line border-dashed bg-white px-4 py-2"
          >
            <summary className="flex cursor-pointer list-none items-center gap-2 text-xs">
              <span className="shrink-0 rounded bg-subtle px-1.5 py-0.5 font-semibold text-ink-muted">
                {source.step}
              </span>
              <span className="min-w-0 flex-1 truncate text-ink-muted">{source.label}</span>
              <span className="shrink-0 font-medium text-ink-muted">
                {batches.length > 0 ? `✓ 取込済み ${batches.length}件` : "未取込"}
              </span>
            </summary>
            <div className="mt-3 border-t border-line pt-3">{body}</div>
          </details>
        );
      })}

      {/* 毎回は読まない前提の説明。畳んで初見の情報量を下げる */}
      <details className="card px-5 py-4">
        <summary className="cursor-pointer text-sm font-bold text-ink">取込の扱い</summary>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-xs leading-5 text-ink-muted">
          <li>車番「88888」は傭車として自動除外します。</li>
          <li>「諸口」と、10・888・5000番の重複候補は削除せず要確認として原本とともに保存します。</li>
          <li>同じ年月の同じ帳票を取り込むと、確認のうえ既存データを削除して入れ直します。</li>
          <li>
            ファイル名は変わっても構いません。どの帳票かは列の見出しで、何年何月分かはファイルの中身
            (Excelの見出し・CSVの日付)で判定します。中身に日付が無い帳票(給与集計表・車両別運行実績表)は、
            取込のときに何年何月分かをお尋ねします。
          </li>
          <li>キリン配賦、燃料・修繕・高速の原票PDF取込は次段階で追加します。</li>
        </ul>
      </details>

      {(imported.monthly_pl_workbook ?? []).length > 0 ? (
        <Link href={`/grid?ym=${yearMonth}`} className="text-sm font-semibold text-brand-deep underline">
          {yearMonth} の車両別収支表を見る
        </Link>
      ) : null}

      {/*
        取込のあとに何をすればよいかの案内。
        以前は売上モニタリストのカードの中にしか置いておらず、4つとも取り込むとそのカードが
        畳まれて案内ごと消えていた(「全部入れたのに次が分からない」の直接の原因)。
        帳票の一覧は縦に長く、下まで見るころには上の案内が画面外に出てしまうので、
        他の画面と同じ固定の操作バーに置いて、どこまでスクロールしても見える状態にする。
      */}
      {importsReady ? (
        <StickyActionBar
          notice={
            <p className="text-sm font-bold text-ink">
              この月の取込はここまでで大丈夫です。次は
              <span className="num">{describeYearMonth(yearMonth)}</span>
              分のデータ整形(STEP2)です
            </p>
          }
        >
          <Link href={`/cleansing?ym=${yearMonth}`} className="btn btn-primary pressable">
            データ整形(STEP2)へ進む
          </Link>
          <Link href="/" className="btn btn-quiet pressable">
            残りの手順をホームで確認する
          </Link>
          <span className="text-xs text-ink-muted">
            傭車・2重計上・諸口を判断すると、月次収支表と年間集計に反映されます。
          </span>
        </StickyActionBar>
      ) : null}
    </div>
  );
}
