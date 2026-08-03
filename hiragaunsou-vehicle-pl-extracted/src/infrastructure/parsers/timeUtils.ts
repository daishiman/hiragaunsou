/**
 * デジタコ/ITP-WEBServiceV3 出力の時間文字列を10進時間(hours)へ正規化する。
 * 例: "174:59" (H:MM) / "158:08:58" (H:MM:SS) / "0:00:00" のように桁数・コロン数が揺れる。
 */
export function parseDurationToHours(value: string | null | undefined): number {
  if (value == null) return 0;
  const trimmed = value.trim();
  if (trimmed === "") return 0;

  const parts = trimmed.split(":").map((p) => Number(p));
  if (parts.some((p) => Number.isNaN(p))) return 0;

  if (parts.length === 2) {
    const h = parts[0] ?? 0;
    const m = parts[1] ?? 0;
    return round4(h + m / 60);
  }
  if (parts.length === 3) {
    const h = parts[0] ?? 0;
    const m = parts[1] ?? 0;
    const s = parts[2] ?? 0;
    return round4(h + m / 60 + s / 3600);
  }
  // コロンなし(既に数値のみ)の場合はそのまま数値として扱う
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : 0;
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}
