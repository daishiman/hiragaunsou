import type { NextConfig } from "next";
import { execSync } from "node:child_process";

// セキュリティヘッダー(CSP含む)は middleware.ts で nonce ベースで設定する。
// next.config.ts の headers() は静的な値しか返せず、リクエストごとに変わる
// nonce を埋め込めないためここでは設定しない。

/**
 * ビルドの目印。改善要望に付く診断情報へ埋め込み、
 * 「どの版で起きたか」を後から特定できるようにする。
 *
 * CI では GitHub が渡すコミット、手元では git から引く。
 * どちらも取れない環境 (git の無いコンテナ等) でもビルドを止めない。
 */
function commitHash(): string {
  const fromCi = process.env.GITHUB_SHA;
  if (fromCi) return fromCi.slice(0, 12);
  try {
    return execSync("git rev-parse --short=12 HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "unknown";
  }
}

const commit = commitHash();

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_COMMIT: commit,
    // 版と作った時刻。同じコミットを2回出したときの区別に使う。
    NEXT_PUBLIC_APP_BUILD: `${commit}@${new Date().toISOString()}`,
  },
};

export default nextConfig;

// OpenNext for Cloudflare 用: `next dev` 時にローカルCloudflare bindingを初期化する。
// ビルド/デプロイ本体には影響しない副作用インポート。
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();
