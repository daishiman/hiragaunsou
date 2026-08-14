import { beforeEach, describe, expect, it } from "vitest";
import {
  consumeRateLimit,
  resetRateLimits,
  IMPROVEMENT_SUBMIT_RATE_LIMIT,
} from "../../src/infrastructure/security/rateLimit";
import {
  readJsonBodyWithinLimit,
  RequestBodyInvalidError,
  RequestBodyTooLargeError,
} from "../../src/infrastructure/security/readJsonBodyWithinLimit";

describe("連投の制限", () => {
  beforeEach(() => resetRateLimits());

  it("窓の中では決めた回数まで通し、超えたら断る", () => {
    const t = 1_000_000;
    for (let i = 0; i < IMPROVEMENT_SUBMIT_RATE_LIMIT.max; i += 1) {
      expect(consumeRateLimit("user-1", IMPROVEMENT_SUBMIT_RATE_LIMIT, t + i).allowed).toBe(true);
    }
    const blocked = consumeRateLimit("user-1", IMPROVEMENT_SUBMIT_RATE_LIMIT, t + 10);
    expect(blocked.allowed).toBe(false);
    // 「何秒後なら送れるか」を案内できる (だまって断らない)
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("別の人の投稿は巻き添えにしない", () => {
    const t = 1_000_000;
    for (let i = 0; i < IMPROVEMENT_SUBMIT_RATE_LIMIT.max; i += 1) {
      consumeRateLimit("user-1", IMPROVEMENT_SUBMIT_RATE_LIMIT, t + i);
    }
    expect(consumeRateLimit("user-2", IMPROVEMENT_SUBMIT_RATE_LIMIT, t + 10).allowed).toBe(true);
  });

  it("窓を過ぎればまた送れる", () => {
    const t = 1_000_000;
    for (let i = 0; i < IMPROVEMENT_SUBMIT_RATE_LIMIT.max; i += 1) {
      consumeRateLimit("user-1", IMPROVEMENT_SUBMIT_RATE_LIMIT, t + i);
    }
    const later = t + IMPROVEMENT_SUBMIT_RATE_LIMIT.windowMs + 1;
    expect(consumeRateLimit("user-1", IMPROVEMENT_SUBMIT_RATE_LIMIT, later).allowed).toBe(true);
  });
});

function jsonRequest(body: string, headers: Record<string, string> = {}): Request {
  return new Request("https://example.test/api/improvements", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
}

describe("受け取る本文の大きさの上限", () => {
  it("上限内の JSON はそのまま読める", async () => {
    await expect(readJsonBodyWithinLimit(jsonRequest('{"body":"使いにくい"}'), 1000)).resolves.toEqual(
      { body: "使いにくい" },
    );
  });

  it("名乗った大きさが上限を超えていれば、読まずに断る", async () => {
    const req = jsonRequest("{}", { "content-length": "999999" });
    await expect(readJsonBodyWithinLimit(req, 1000)).rejects.toBeInstanceOf(RequestBodyTooLargeError);
  });

  it("名乗りが無くても、実際のバイト数で断る", async () => {
    const big = JSON.stringify({ shot: "A".repeat(2000) });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(big));
        controller.close();
      },
    });
    const req = new Request("https://example.test/api/improvements", {
      method: "POST",
      body: stream,
      // @ts-expect-error Node の fetch はストリーム本文に duplex 指定を求める
      duplex: "half",
    });
    await expect(readJsonBodyWithinLimit(req, 1000)).rejects.toBeInstanceOf(RequestBodyTooLargeError);
  });

  it("JSON として読めないものは形の誤りとして断る", async () => {
    await expect(readJsonBodyWithinLimit(jsonRequest("これはJSONではない"), 1000)).rejects.toBeInstanceOf(
      RequestBodyInvalidError,
    );
  });
});
