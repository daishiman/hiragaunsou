import { describe, expect, it, vi } from "vitest";
import { R2FileStorageRepository } from "../../../src/infrastructure/storage/R2FileStorageRepository";

function makeBucketMock() {
  return {
    put: vi.fn().mockResolvedValue(undefined),
    get: vi.fn(),
  } as unknown as R2Bucket & { put: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> };
}

describe("R2FileStorageRepository", () => {
  describe("save", () => {
    it("Uint8Arrayをそのままbucket.putへ渡し、キー・サイズ・保存日時を返す", async () => {
      const bucket = makeBucketMock();
      vi.spyOn(Date, "now").mockReturnValue(1700000000000);
      const repo = new R2FileStorageRepository(bucket);
      const content = new Uint8Array([1, 2, 3]);

      const ref = await repo.save("2026-05", "payroll", "給与.csv", content);

      expect(bucket.put).toHaveBeenCalledTimes(1);
      const [key, body, options] = bucket.put.mock.calls[0]!;
      expect(key).toBe("imports/2026-05/payroll/1700000000000_給与.csv");
      expect(body).toBe(content);
      expect(options).toEqual({
        customMetadata: { yearMonth: "2026-05", fileType: "payroll", originalFileName: "給与.csv" },
      });
      expect(ref).toEqual({ key, size: 3, storedAt: 1700000000000 });
      vi.restoreAllMocks();
    });

    it("ArrayBufferはUint8Arrayへ変換してからbucket.putへ渡す", async () => {
      const bucket = makeBucketMock();
      const repo = new R2FileStorageRepository(bucket);
      const buf = new Uint8Array([9, 8, 7, 6]).buffer;

      const ref = await repo.save("2026-05", "sales_monitor", "a.csv", buf);

      const [, body] = bucket.put.mock.calls[0]!;
      expect(body).toBeInstanceOf(Uint8Array);
      expect(Array.from(body as Uint8Array)).toEqual([9, 8, 7, 6]);
      expect(ref.size).toBe(4);
    });

    it("危険な文字を含むファイル名・年月はbuildImportFileKeyでサニタイズされる(境界値)", async () => {
      const bucket = makeBucketMock();
      const repo = new R2FileStorageRepository(bucket);
      await repo.save("invalid-ym", "vehicle_operation", "../../etc/passwd", new Uint8Array());
      const [key] = bucket.put.mock.calls[0]!;
      expect(key).toContain("imports/unknown-month/vehicle_operation/");
      expect(key).not.toContain("../");
    });
  });

  describe("get", () => {
    it("オブジェクトが無ければnullを返す", async () => {
      const bucket = makeBucketMock();
      bucket.get.mockResolvedValue(null);
      const repo = new R2FileStorageRepository(bucket);
      expect(await repo.get("imports/2026-05/payroll/x")).toBeNull();
    });

    it("オブジェクトがあればarrayBuffer()の結果を返す", async () => {
      const bucket = makeBucketMock();
      const arrayBuffer = new Uint8Array([1, 2]).buffer;
      bucket.get.mockResolvedValue({ arrayBuffer: vi.fn().mockResolvedValue(arrayBuffer) });
      const repo = new R2FileStorageRepository(bucket);
      const result = await repo.get("imports/2026-05/payroll/x");
      expect(result).toBe(arrayBuffer);
    });
  });
});
