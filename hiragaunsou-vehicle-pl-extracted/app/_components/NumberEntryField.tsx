"use client";

import type { ReactNode } from "react";
import { ENTRY_FIELD_ATTR, moveFocusOnEnter, parseAmountInput } from "../_lib/numberEntry";
import { CHANGED_FIELD_CLASS, ChangedFieldBadge, OriginalValueNote } from "./ChangedFieldMark";

/**
 * 手で数字を入れる欄。全画面共通。
 *
 * ■ なぜ1つにまとめるか
 * 以前は画面ごとに入力欄を書いていたため、同じ「金額を入れる」でも
 * 「自動計算の金額が欄の外に小さく出ているだけで欄は空欄」(高速料金・タイヤ代)、
 * 「いまの値が隣の列にあって欄は空欄」(車両1台の明細)、
 * 「値が最初から欄に入っている」(リース料) と、タブごとに作法が違っていた。
 * 使う人は毎回「この欄は空欄のままでいいのか」を考え直すことになる。
 *
 * ■ 決めた作法 (全ての欄で同じ)
 * 1. 自動で決まる金額は「欄の中に初期値として」入れる。欄の外に別表示しない。
 * 2. 自動のままの欄は薄い文字色 + 小さな印 (「自動」など) を付ける。
 * 3. 手で直すと通常の濃い文字色になり、印が「自動に戻す」ボタンに変わる。
 * 4. Enterで次の欄へ進む。IME確定中のEnterでは進まない。
 *
 * ■ 見た目だけの区別にしない
 * 薄い文字で出ているのは「表示しているだけ」で、value としては空文字のまま持つ。
 * 保存時に空文字を null として送れば、DB上も「自動のまま」と「人が入れた」が分かれる。
 * 見た目だけ薄くして数字を保存してしまうと、誰も見ていない数字が確定してしまう。
 */
export interface NumberEntryFieldProps {
  /** 人が入力した文字列。空文字なら「人はまだ触っていない」 */
  value: string;
  onChange: (raw: string) => void;
  /**
   * 人が触っていないときに欄へ初期表示する値。null なら空欄のまま。
   * 自動計算の金額・いまの値・取込値など、画面ごとに意味は違うが扱いは同じ。
   */
  autoValue?: number | null;
  /** 自動値の呼び名。画面の言葉に合わせる (「自動」「いまの値」「取込値」「先月の単価」) */
  autoLabel?: string;
  /** 読み上げ用の欄の名前。表の中では「24番の通行料金(円)」のように行と列が分かる名前にする */
  ariaLabel: string;
  disabled?: boolean;
  /** 表の中で使うときの列番号。Enterで同じ列の次の行へ進むために使う */
  col?: number;
  widthClass?: string;
  /** 数字として読めない文字が入っているときのメッセージ。既定は「数字と + だけで入力してください」 */
  invalidMessage?: string;
  /** 欄の下に添える補足 (先月いくらだったか、など) */
  hints?: ReactNode;
  /** 読み取り規則。既定は足し算式も受ける共通規則 */
  parse?: (raw: string) => number | null;
  /** 合計のこだまを出すか。既定は出す (桁を1つ間違えても数字だけでは気づけないため) */
  showEcho?: boolean;
  /**
   * 欄の下に「〜に戻す」を出すか。既定は出す。
   * 戻す入口が画面側に別にある場合 (人件費の行ごとの「取込値に戻す」) だけ false にする。
   * 同じ文言のボタンが2つ並ぶと、どちらがどこまで戻すのかが読み取れなくなる。
   */
  resettable?: boolean;
  inputMode?: "decimal" | "numeric";
}

export function NumberEntryField({
  value,
  onChange,
  autoValue = null,
  autoLabel = "自動",
  ariaLabel,
  disabled = false,
  col,
  widthClass = "w-32",
  invalidMessage = "数字と + だけで入力してください",
  hints,
  parse = parseAmountInput,
  showEcho = true,
  resettable = true,
  inputMode = "decimal",
}: NumberEntryFieldProps) {
  const touched = value.trim() !== "";
  const hasAuto = autoValue !== null && Number.isFinite(autoValue);
  /** 自動のまま = 人がまだ触っていない、かつ自動で決まる値がある */
  const isAuto = !touched && hasAuto;
  const display = isAuto ? String(autoValue) : value;
  const parsed = touched ? parse(value) : null;
  const isInvalid = touched && parsed === null;
  /**
   * 元の値から変えたか。
   * 「打った = 変えた」ではない。取込値と同じ数字を打ち直しただけの欄まで色が付くと、
   * 保存前に何件直したのかを数えられなくなる。読み取った数で比べる。
   */
  const isChanged = touched && hasAuto && parsed !== null && parsed !== autoValue;

  /*
    印(「自動」「自動に戻す」)は欄の左隣に置く。
    欄の下に置いていたときは、車番 → 運転者 → 金額と横に流れていた視線が
    行ごとに下へ折れ、しかも印の有無で行の高さが変わっていた。
  */
  const mark = isAuto ? (
    <span className="shrink-0 rounded bg-subtle px-1 text-[10px] font-semibold whitespace-nowrap text-ink-muted">
      {autoLabel}
    </span>
  ) : hasAuto && touched && resettable && !disabled ? (
    <button
      type="button"
      onClick={() => onChange("")}
      className="shrink-0 rounded px-1 text-[10px] font-semibold whitespace-nowrap text-brand-deep underline underline-offset-2 hover:bg-brand-soft"
    >
      {autoLabel}に戻す
    </button>
  ) : null;

  /*
    読めた金額・補足は1行にまとめ、その行の高さを常に確保する。
    出たり消えたりで行の高さが変わると、打っている最中に下の行が上下にずれる。
  */
  const echo =
    showEcho && parsed !== null && (value.includes("+") || value.includes("＋") || parsed >= 1000)
      ? parsed.toLocaleString("ja-JP")
      : null;

  return (
    <div className="inline-flex flex-col items-end gap-0.5">
      <div className="flex items-center justify-end gap-1.5">
        {/* 直した欄は、どの画面でも同じ札・同じ色にする (app/_components/ChangedFieldMark.tsx) */}
        {isChanged ? <ChangedFieldBadge /> : null}
        {mark}
        <input
        {...{ [ENTRY_FIELD_ATTR]: "" }}
        data-col={col}
        data-auto={isAuto ? "true" : undefined}
        type="text"
        inputMode={inputMode}
        disabled={disabled}
        /*
          読み上げでも「自動のまま」が分かるようにする。
          色の濃淡は目で見ている人にしか届かない。
        */
        aria-label={isAuto ? `${ariaLabel}(${autoLabel}の値です)` : ariaLabel}
        value={display}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={moveFocusOnEnter}
        /*
          自動のまま入った値は「消して打ち直す」ことが前提なので、
          触った瞬間に全選択しておく。カーソル位置に数字を挿し込んで桁が増える事故を防ぐ。
        */
        onFocus={(e) => {
          if (isAuto) e.currentTarget.select();
        }}
          className={[
            "num rounded-md border px-2 py-1 text-right",
            widthClass,
            isInvalid ? "border-danger" : isChanged ? CHANGED_FIELD_CLASS : "border-line",
            // 自動のままは薄い文字、人が入れた値は通常の濃い文字
            isAuto ? "text-ink-muted" : "text-ink",
            disabled ? "bg-subtle" : isChanged ? "" : "bg-white",
          ].join(" ")}
        />
      </div>

      {/*
        読めた金額(桁を1つ間違えても数字だけでは気づけない)と補足を1行に置く。
        中身が無くても高さを確保して、行がずれないようにする。
      */}
      <div className="flex min-h-[1.0625rem] items-center justify-end gap-1.5 text-[11px] leading-none whitespace-nowrap text-ink-muted">
        {hints}
        {/* 変えた欄には元の値を並べる。変更後の数字だけでは桁の間違いに気づけない */}
        {isChanged ? (
          <OriginalValueNote original={(autoValue as number).toLocaleString("ja-JP")} />
        ) : null}
        {echo !== null ? <span className="num">{echo}</span> : null}
      </div>

      {isInvalid ? (
        <p className="text-[11px] leading-tight text-danger">{invalidMessage}</p>
      ) : null}
    </div>
  );
}
