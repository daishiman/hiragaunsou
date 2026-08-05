"use client";

import { createContext, useContext } from "react";
import { useSearchParams } from "next/navigation";

/**
 * いま見ている対象年月 (URLの ym クエリ)。
 *
 * サイドバーは共通レイアウトから描画されるが、レイアウトはサーバー側で searchParams を
 * 受け取れない。かといってサイドバー自身が useSearchParams を呼ぶと、対象月の読み取りが
 * 描画部品の中に埋もれる。読み取り口をこのProviderに1箇所だけ置き、配下の部品は
 * useCurrentYm() で受け取る形にする。
 */
const YmContext = createContext<string | null>(null);

export function YmProvider({ children }: { children: React.ReactNode }) {
  const ym = useSearchParams()?.get("ym") ?? null;
  return <YmContext value={ym}>{children}</YmContext>;
}

/** Provider の外 (対象月を持たない文脈) では null を返す。 */
export function useCurrentYm(): string | null {
  return useContext(YmContext);
}
