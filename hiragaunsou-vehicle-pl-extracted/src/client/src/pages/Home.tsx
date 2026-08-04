import { useEffect, useState } from "react";
import { fetchTodo, type TodoResponse } from "../api";

const SEVERITY_LABEL: Record<string, string> = {
  critical: "重大",
  warning: "要確認",
  info: "参考",
};

export function Home({ yearMonth }: { yearMonth: string }) {
  const [data, setData] = useState<TodoResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchTodo(yearMonth)
      .then(setData)
      .catch((e) => setError(String(e)));
  }, [yearMonth]);

  return (
    <section className="card">
      <h2>今月のToDo ({yearMonth})</h2>
      {error && <p className="empty-state">取込に失敗しました: {error}</p>}
      {!data && !error && <p className="empty-state">読み込み中...</p>}
      {data && data.emptyMessage && (
        <p className="empty-state">{data.emptyMessage}</p>
      )}
      {data && data.cards.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>優先度</th>
              <th>車番</th>
              <th>項目</th>
              <th>内容</th>
              <th>例月目安</th>
            </tr>
          </thead>
          <tbody>
            {data.cards.map((c) => (
              <tr key={c.id}>
                <td>
                  <span className={`badge badge-${c.severity}`}>
                    {SEVERITY_LABEL[c.severity] ?? c.severity}
                  </span>
                </td>
                <td>{c.vehicleNo ?? "-"}</td>
                <td>{c.field ?? "-"}</td>
                <td style={{ textAlign: "left" }}>{c.message}</td>
                <td className="tnum">
                  {c.monthlyReference != null
                    ? c.monthlyReference.toLocaleString()
                    : "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
