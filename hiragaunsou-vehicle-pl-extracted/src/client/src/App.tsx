import { useEffect, useState } from "react";
import { Home } from "./pages/Home";
import { Grid } from "./pages/Grid";
import { fetchMe, type MeResponse } from "./api";
import { signInWithGoogle, signOut } from "./authClient";

function currentYearMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function App() {
  const [view, setView] = useState<"home" | "grid">("home");
  const [me, setMe] = useState<MeResponse["user"] | null | undefined>(
    undefined,
  );
  const yearMonth = currentYearMonth();

  useEffect(() => {
    fetchMe()
      .then((r) => setMe(r.user))
      .catch(() => setMe(null));
  }, []);

  return (
    <div className="layout">
      <aside className="sidebar">
        <p className="app-name">車両収支管理システム</p>
        <p className="app-sub">平賀運送</p>
        <button
          className="nav-item"
          aria-current={view === "home"}
          onClick={() => setView("home")}
        >
          ホーム(今月のToDo)
        </button>
        <button
          className="nav-item"
          aria-current={view === "grid"}
          onClick={() => setView("grid")}
        >
          月次収支グリッド
        </button>
      </aside>
      <div className="main">
        {me === null && (
          <div className="empty-state">
            <p>
              サインインが必要です。Google Workspace アカウントでログインしてください。
            </p>
            <button className="nav-item" onClick={() => signInWithGoogle()}>
              Googleでサインイン
            </button>
          </div>
        )}
        {me && (
          <div className="user-bar">
            <span>{me.name} ({me.email})</span>
            <button
              className="nav-item"
              onClick={() => signOut().then(() => setMe(null))}
            >
              サインアウト
            </button>
          </div>
        )}
        {view === "home" && <Home yearMonth={yearMonth} />}
        {view === "grid" && <Grid yearMonth={yearMonth} />}
      </div>
    </div>
  );
}
