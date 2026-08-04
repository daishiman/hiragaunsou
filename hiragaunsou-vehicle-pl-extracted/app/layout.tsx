import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export const metadata: Metadata = {
  title: "車両別収支表 | 平賀運送",
  description: "車両別収支表(月次P&L)自動化システム",
};

// headers() を呼ぶことで動的レンダリングが強制され、Next.js が
// middleware.ts で発行した nonce を検出して自身のインラインスクリプトに
// 自動付与する(CSP の script-src 'nonce-...' との整合に必須)。
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  await headers();
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
