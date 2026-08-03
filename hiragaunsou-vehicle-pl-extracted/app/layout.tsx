import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "車両別収支表 | 平賀運送",
  description: "車両別収支表(月次P&L)自動化システム",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
