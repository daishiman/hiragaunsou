/**
 * F2 今月のToDoボード用のレスポンス整形 (S1画面)。
 * 未入力・要確認カードを優先度順(critical > warning > info)に並べる。
 */
export interface ReviewFlagRecord {
  id: string;
  yearMonth: string;
  vehicleNo: string | null;
  field: string | null;
  type: string;
  severity: "info" | "warning" | "critical";
  message: string;
  monthlyReference: number | null;
  status: string;
}

export interface TodoResponse {
  yearMonth: string;
  totalOpen: number;
  cards: ReviewFlagRecord[];
  /** ToDoがゼロの場合の空状態メッセージ (要件定義 S1: 「今月の入力は完了しています」) */
  emptyMessage: string | null;
}

const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

export function buildTodoResponse(
  yearMonth: string,
  flags: ReviewFlagRecord[],
): TodoResponse {
  const open = flags.filter((f) => f.status === "open");
  const sorted = [...open].sort(
    (a, b) =>
      (SEVERITY_ORDER[a.severity] ?? 99) - (SEVERITY_ORDER[b.severity] ?? 99),
  );

  return {
    yearMonth,
    totalOpen: sorted.length,
    cards: sorted,
    emptyMessage:
      sorted.length === 0 ? "今月の入力は完了しています" : null,
  };
}
