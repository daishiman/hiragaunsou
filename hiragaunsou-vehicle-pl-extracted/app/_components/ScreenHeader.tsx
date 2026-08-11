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
 * 見出し・リード文・種別バッジ・必要な境界案内・業務フロー上の位置づけは、
 * すべて app/_lib/screens.ts の1行から描かれる。
 *
 * 「すること」はリード文と主要操作で伝え、同じ内容を説明カードで繰り返さない。
 * 境界が紛らわしい画面だけ notHere を短く出し、next は工程ナビに集約する。
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
      note={<ScreenContextNote def={def} ym={ym} />}
    />
  );
}

/**
 * 画面を見分けるために本当に必要な補足だけを出す。
 * does は lead と主要操作に集約し、next は説明行ではなく工程ナビとして出す。
 */
function ScreenContextNote({ def, ym }: { def: ScreenDef; ym: string | null }) {
  const flow = def.flowOrder !== undefined ? flowPositionOf(def.href) : null;
  const finalFlowNext = flow && !flow.next ? def.next : null;

  if (!flow && !def.notHere) return null;

  return (
    <div className="mt-3 space-y-2 text-xs leading-relaxed">
      {flow && (
        <nav
          aria-label="毎月の締めの進行"
          className="flex flex-wrap items-center gap-x-3 gap-y-1 text-ink-muted"
        >
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
          {finalFlowNext?.href && (
            <span>
              次:{" "}
              <Link
                href={withYm(finalFlowNext.href, ym)}
                className="font-semibold text-brand-deep hover:underline"
              >
                {finalFlowNext.linkLabel ??
                  getScreen(finalFlowNext.href)?.label ??
                  finalFlowNext.href}
              </Link>
            </span>
          )}
        </nav>
      )}

      {def.notHere && (
        <aside
          aria-label="この画面の範囲"
          className="border-l-2 border-line pl-3 text-ink-muted"
        >
          <PointerText pointer={def.notHere} ym={ym} />
        </aside>
      )}
    </div>
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
