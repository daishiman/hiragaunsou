import type { NextConfig } from "next";

// セキュリティヘッダー(CSP含む)は middleware.ts で nonce ベースで設定する。
// next.config.ts の headers() は静的な値しか返せず、リクエストごとに変わる
// nonce を埋め込めないためここでは設定しない。
const nextConfig: NextConfig = {};

export default nextConfig;

// OpenNext for Cloudflare 用: `next dev` 時にローカルCloudflare bindingを初期化する。
// ビルド/デプロイ本体には影響しない副作用インポート。
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();
