export interface TodoCard {
  id: string;
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
  cards: TodoCard[];
  emptyMessage: string | null;
}

export interface GridRow {
  vehicleNo: string;
  values: Record<string, number | string | null>;
  highlightedFields: string[];
}

export interface GridResponse {
  yearMonth: string;
  fields: string[];
  rows: GridRow[];
  isEmpty: boolean;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    throw new Error(`${url} failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function fetchTodo(yearMonth: string): Promise<TodoResponse> {
  return getJson(`/api/todo?yearMonth=${encodeURIComponent(yearMonth)}`);
}

export function fetchGrid(yearMonth: string): Promise<GridResponse> {
  return getJson(`/api/vehicle-pl?yearMonth=${encodeURIComponent(yearMonth)}`);
}

export interface MeResponse {
  user: { id: string; name: string; email: string; role?: string } | null;
}

export function fetchMe(): Promise<MeResponse> {
  return getJson(`/api/me`);
}
