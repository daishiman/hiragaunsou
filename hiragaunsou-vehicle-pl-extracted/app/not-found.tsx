import Link from "next/link";
import { AuthShell } from "./_components/AuthShell";

/**
 * 見つからないURLを開いたときの画面。
 *
 * これが無いと Next.js の既定(英語の "404 This page could not be found")が出る。
 * 業務中に出るのは打ち間違いか、消したデータのURLを開いたときなので、
 * 責める言葉を使わず「戻る先」だけを出す。
 *
 * 枠組みはアプリの枠(AppShell)の外にある他の画面と同じ AuthShell に揃える。
 * フッターが出ないと、同じアプリの中にいるのかが名前だけの手がかりになってしまう。
 *
 * 表かカードかの判定 (T7 §4-1): 見比べる値が1つも無いので表は使わない。
 */
export default function NotFound() {
  return (
    <AuthShell>
      <div className="w-full card px-6 py-10 text-center">
        <p className="text-sm font-semibold text-ink">このページは見つかりませんでした</p>
        <p className="mt-1 text-sm text-ink-muted">
          URLが変わったか、削除された可能性があります。
        </p>
        <Link href="/" className="btn btn-primary pressable mt-5 inline-block">
          ホームに戻る
        </Link>
      </div>
    </AuthShell>
  );
}
