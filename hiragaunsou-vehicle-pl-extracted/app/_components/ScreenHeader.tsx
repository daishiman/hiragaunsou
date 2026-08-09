"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { flowPositionOf, getScreen, type ScreenDef, type ScreenPointer } from "../_lib/screens";
import { withYm } from "../_lib/withYm";
import { useCurrentYm } from "./YmProvider";
import { PageHead } from "./PageHead";

/**
 * 全画面共通のページヘッダ。
 *
 * ページ側は <ScreenHeader screen="/cleansing" action={...} /> と書くだけでよい。
 * 見出し・リード文・種別バッジ・「この画面ですること / ここでは見ないこと / 次にどこへ行くか」・
 * 業務フロー上の位置づけは、すべて app/_lib/screens.ts の1行から描かれる。
 *
 * なぜ役割ノートを全画面に常時出すか:
 * データ取込・データ整形・手入力・チェックは、どれも「今月の数字を整える画面」に見えるため、
 * 開いた人が「ここで何をすればよいのか」「隣の画面と何が違うのか」を毎回考え直していた。
 * 見出しだけでは足りず、かといって画面ごとに説明文を書き足すと言い回しがばらつく。
 * 3行を同じ位置・同じ順序で必ず出すことで、どの画面でも同じ読み方ができるようにする。
 */
export function ScreenHeader({
  screen,
  title,
  lead,
  action,
  help,
}: {
  /** app/_lib/screens.ts に登録した画面のパス (例: "/cleansing") */
  screen: string;
  /** 対象月や車番を含む見出しにしたいときだけ上書きする。省略時は定義の title */
  title?: string;
  /** 件数など実データを含めたいときだけ上書きする。省略時は定義の lead */
  lead?: string;
  /** 見出しの右に置く操作 (対象月の切替など) */
  action?: ReactNode;
  /** 見出しの横の「?」(長い説明の引き出し) */
  help?: ReactNode;
}) {
  const def = getScreen(screen);
  const ym = useCurrentYm();

  // 定義漏れの画面でも落とさない。文言が出ないことで気づけるよう見出しだけは描く。
  if (!def) {
    return <PageHead kind="tool" title={title ?? screen} lead={lead} action={action} help={help} />;
  }

  return (
    <PageHead
      kind={def.kind}
      title={title ?? def.title}
      lead={lead ?? def.lead}
      action={action}
      help={help}
      showHomeLink={def.flowOrder !== undefined || def.group === "monthly"}
      note={<ScreenRoleNote def={def} ym={ym} />}
    />
  );
}

/**
 * 画面の役割3点セット + 業務フロー上の位置。
 * 見た目を1つに固定するため、ページから直接呼ばない (ScreenHeader 経由でのみ使う)。
 */
function ScreenRoleNote({ def, ym }: { def: ScreenDef; ym: string | null }) {
  const flow = def.flowOrder !== undefined ? flowPositionOf(def.href) : null;

  return (
    <section
      aria-label="この画面の役割"
      className="mt-4 rounded-xl border border-line bg-white px-4 py-3"
    >
      {flow && (
        <p className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line pb-2 text-xs text-ink-muted">
          <span className="font-semibold text-ink">
            毎月の締め <span className="num">{flow.index}</span> /{" "}
            <span className="num">{flow.total}</span>
          </span>
          {flow.prev && (
            <span>
              前:{" "}
              <Link
                href={withYm(flow.prev.href, ym)}
                className="font-semibold text-brand-deep hover:underline"
              >
                {flow.prev.label}
              </Link>
            </span>
          )}
          {flow.next && (
            <span>
              次:{" "}
              <Link
                href={withYm(flow.next.href, ym)}
                className="font-semibold text-brand-deep hover:underline"
              >
                {flow.next.label}
              </Link>
            </span>
          )}
        </p>
      )}

      <dl className="grid gap-x-3 gap-y-1.5 text-xs leading-relaxed sm:grid-cols-[8.5rem_1fr]">
        <dt className="font-semibold text-ink">この画面ですること</dt>
        <dd className="text-ink">{def.does}</dd>

        {def.notHere && (
          <>
            <dt className="font-semibold text-ink-muted">ここでは見ないこと</dt>
            <dd className="text-ink-muted">
              <PointerText pointer={def.notHere} ym={ym} />
            </dd>
          </>
        )}

        {def.next && (
          <>
            <dt className="font-semibold text-ink-muted">終わったら次に</dt>
            <dd className="text-ink-muted">
              <PointerText pointer={def.next} ym={ym} />
            </dd>
          </>
        )}
      </dl>
    </section>
  );
}

function PointerText({ pointer, ym }: { pointer: ScreenPointer; ym: string | null }) {
  const target = pointer.href ? getScreen(pointer.href) : null;
  return (
    <>
      {pointer.text}
      {pointer.href && (
        <>
          {" "}
          <Link
            href={withYm(pointer.href, ym)}
            className="font-semibold whitespace-nowrap text-brand-deep hover:underline"
          >
            {pointer.linkLabel ?? target?.label ?? pointer.href} →
          </Link>
        </>
      )}
    </>
  );
}
