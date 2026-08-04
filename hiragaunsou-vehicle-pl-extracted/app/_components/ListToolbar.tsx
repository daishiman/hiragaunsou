"use client";

export interface SortOption {
  value: string;
  label: string;
}

export interface FilterChip {
  key: string;
  label: string;
  active: boolean;
}

/**
 * 一覧画面(データ整形・チェック等)で共通して使う「検索・並べ替え・絞り込み」のツールバー。
 * データの持ち方はページごとに違うので、このコンポーネントは見た目と入力操作だけを持ち、
 * 実際の絞り込み・並べ替えロジックは呼び出し側(各ページ)が行う。
 */
export function ListToolbar({
  searchValue,
  onSearchChange,
  searchPlaceholder = "車番・荷主・運転者などで検索",
  sortOptions,
  sortValue,
  onSortChange,
  filterChips,
  onToggleFilter,
}: {
  searchValue: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  sortOptions?: SortOption[];
  sortValue?: string;
  onSortChange?: (value: string) => void;
  filterChips?: FilterChip[];
  onToggleFilter?: (key: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-white p-3">
      <input
        type="search"
        value={searchValue}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder={searchPlaceholder}
        className="min-w-48 flex-1 rounded border border-line px-2 py-1.5 text-sm text-ink"
      />

      {sortOptions && sortOptions.length > 0 && (
        <label className="flex items-center gap-1.5 text-xs text-ink-muted">
          並び替え
          <select
            value={sortValue}
            onChange={(e) => onSortChange?.(e.target.value)}
            className="rounded border border-line px-2 py-1.5 text-sm text-ink"
          >
            {sortOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      )}

      {filterChips && filterChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {filterChips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={() => onToggleFilter?.(chip.key)}
              aria-pressed={chip.active}
              className={`pressable rounded-full border px-2.5 py-1 text-xs font-semibold ${
                chip.active
                  ? "border-brand bg-brand-soft text-brand-deep"
                  : "border-line text-ink-muted"
              }`}
            >
              {chip.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
