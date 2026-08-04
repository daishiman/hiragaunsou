import { useEffect, useState } from "react";
import { fetchGrid, type GridResponse } from "../api";

const KEY_FIELDS = [
  "no",
  "type",
  "depot",
  "driver",
  "km",
  "sales",
  "expense",
  "profit",
  "margin",
] as const;

const FIELD_LABEL: Record<string, string> = {
  no: "車番",
  type: "車種",
  depot: "所属",
  driver: "運転者",
  km: "稼働Km",
  sales: "運送収入",
  expense: "経費計",
  profit: "損益",
  margin: "利益率",
};

export function Grid({ yearMonth }: { yearMonth: string }) {
  const [data, setData] = useState<GridResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchGrid(yearMonth)
      .then(setData)
      .catch((e) => setError(String(e)));
  }, [yearMonth]);

  return (
    <section className="card">
      <h2>月次収支グリッド ({yearMonth})</h2>
      {error && <p className="empty-state">取込に失敗しました: {error}</p>}
      {!data && !error && <p className="empty-state">読み込み中...</p>}
      {data && data.isEmpty && (
        <p className="empty-state">データ取込を開始してください</p>
      )}
      {data && !data.isEmpty && (
        <table>
          <thead>
            <tr>
              {KEY_FIELDS.map((f) => (
                <th key={f}>{FIELD_LABEL[f]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <tr key={row.vehicleNo}>
                {KEY_FIELDS.map((f) => {
                  const value = row.values[f];
                  const isHighlighted = row.highlightedFields.includes(f);
                  return (
                    <td
                      key={f}
                      className={isHighlighted ? "highlight tnum" : "tnum"}
                    >
                      {typeof value === "number"
                        ? value.toLocaleString()
                        : (value ?? "-")}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
