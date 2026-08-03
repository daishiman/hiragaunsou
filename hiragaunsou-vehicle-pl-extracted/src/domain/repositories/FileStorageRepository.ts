/**
 * アップロードされた元ファイル(CSV/Excel)を監査証跡として保存するリポジトリ。
 * Domain層のインターフェースのみを定義し、実装(R2)は Infrastructure層に置く(依存性逆転)。
 *
 * キー命名規則: imports/{yyyy-mm}/{fileType}/{timestamp}_{originalFileName}
 */
export interface StoredFileRef {
  /** R2オブジェクトキー */
  key: string;
  /** バイト数 */
  size: number;
  /** 保存日時 (epoch ms) */
  storedAt: number;
}

export interface FileStorageRepository {
  /**
   * 元ファイルを保存し、監査証跡用のキーを返す。
   * @param yearMonth YYYY-MM
   * @param fileType 取込元ファイル種別 (vehicle_operation / sales_monitor / payroll)
   * @param originalFileName アップロード時のファイル名
   * @param content ファイル本体
   */
  save(
    yearMonth: string,
    fileType: string,
    originalFileName: string,
    content: ArrayBuffer | Uint8Array,
  ): Promise<StoredFileRef>;

  /** 保存済み元ファイルを取得する(監査・再パース用) */
  get(key: string): Promise<ArrayBuffer | null>;
}

/** R2キー命名規則を組み立てる。フォーマット判定はここで一元化する(Domain層で完結) */
export function buildImportFileKey(
  yearMonth: string,
  fileType: string,
  timestamp: number,
  originalFileName: string,
): string {
  return `imports/${yearMonth}/${fileType}/${timestamp}_${originalFileName}`;
}
