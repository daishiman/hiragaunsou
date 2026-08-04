import {
  buildImportFileKey,
  type FileStorageRepository,
  type StoredFileRef,
} from "../../domain/repositories/FileStorageRepository";

/**
 * Cloudflare R2 を使った FileStorageRepository の実装(Infrastructure層アダプタ)。
 * アップロードされたCSV/Excel元ファイルをパース前に保存し、監査証跡とする。
 * キー命名規則: imports/{yyyy-mm}/{fileType}/{timestamp}_{originalFileName}
 */
export class R2FileStorageRepository implements FileStorageRepository {
  constructor(private readonly bucket: R2Bucket) {}

  async save(
    yearMonth: string,
    fileType: string,
    originalFileName: string,
    content: ArrayBuffer | Uint8Array,
  ): Promise<StoredFileRef> {
    const timestamp = Date.now();
    const key = buildImportFileKey(yearMonth, fileType, timestamp, originalFileName);
    const body = content instanceof Uint8Array ? content : new Uint8Array(content);
    await this.bucket.put(key, body, {
      customMetadata: {
        yearMonth,
        fileType,
        originalFileName,
      },
    });
    return { key, size: body.byteLength, storedAt: timestamp };
  }

  async get(key: string): Promise<ArrayBuffer | null> {
    const obj = await this.bucket.get(key);
    if (!obj) return null;
    return obj.arrayBuffer();
  }
}
