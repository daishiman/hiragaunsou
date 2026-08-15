/**
 * 同じ人が短い間に何度も送るのを止めるための、ごく軽い制限。
 *
 * Worker のメモリ (isolate) の中だけで数える。isolate は増えたり入れ替わったりするので
 * 「絶対に n 回まで」を保証するものではない。狙いは、押しっぱなし・スクリプトによる
 * 連投で D1 の書き込みが一気に消費されるのを防ぐこと。
 * 厳密な保証が要る用途 (課金・認証) には使わない。
 */

export interface RateLimitRule {
  /** 窓の長さ (ミリ秒) */
  windowMs: number;
  /** 窓の中で許す回数 */
  max: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** 断ったときに「何秒後なら送れるか」。案内文に使う。 */
  retryAfterSeconds: number;
}

/** 改善要望の投稿。書くのに数百KBかかるので、1分あたり5件までにする。 */
export const IMPROVEMENT_SUBMIT_RATE_LIMIT: RateLimitRule = { windowMs: 60_000, max: 5 };

const hits = new Map<string, number[]>();

/**
 * 1回ぶん使う。使えたら allowed=true。
 * 呼ぶたびに古い記録を捨てるので、放っておいても際限なく溜まらない。
 */
export function consumeRateLimit(
  key: string,
  rule: RateLimitRule,
  now: number = Date.now(),
): RateLimitResult {
  const since = now - rule.windowMs;
  const recent = (hits.get(key) ?? []).filter((t) => t > since);

  if (recent.length >= rule.max) {
    const oldest = recent[0] ?? now;
    hits.set(key, recent);
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((oldest + rule.windowMs - now) / 1000)),
    };
  }

  recent.push(now);
  hits.set(key, recent);
  return { allowed: true, retryAfterSeconds: 0 };
}

/** テスト用。数えた記録を捨てる。 */
export function resetRateLimits(): void {
  hits.clear();
}
