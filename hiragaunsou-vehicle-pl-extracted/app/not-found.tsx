import Link from "next/link";

/**
 * 見つからないURLを開いたときの画面。
 *
 * これが無いと Next.js の既定(英語の "404 This page could not be found")が出る。
 * 業務中に出るのは打ち間違いか、消したデータのURLを開いたときなので、
 * 責める言葉を使わず「戻る先」だけを出す。
 */
export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-subtle px-6">
      <div className="w-full max-w-md rounded-xl border border-line bg-white px-6 py-10 text-center">
        <p className="text-sm font-semibold text-ink">このページは見つかりませんでした</p>
        <p className="mt-1 text-sm text-ink-muted">
          URLが変わったか、削除された可能性があります。
        </p>
        <Link
          href="/"
          className="btn btn-primary pressable mt-5 inline-block"
        >
          ホームに戻る
        </Link>
      </div>
    </div>
  );
}
