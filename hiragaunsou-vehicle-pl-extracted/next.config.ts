import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Content-Security-Policy",
            value: "default-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'",
          },
        ],
      },
    ];
  },
};

export default nextConfig;

// OpenNext for Cloudflare 用: `next dev` 時にローカルCloudflare bindingを初期化する。
// ビルド/デプロイ本体には影響しない副作用インポート。
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();
