"use client";

import { useEffect } from "react";
import { installDiagnostics } from "../_lib/diagnostics/recorder";

/**
 * 診断情報の控えを始めるためだけの部品。見た目は持たない。
 *
 * 改善要望のウィジェットと分けてあるのは、控えを始める時点が違うため。
 * 控えは「アプリを開いた瞬間」から要る (エラーは要望を送る前に起きている)。
 * ウィジェットの都合で描かれなくなっても、控えだけは続くようにしておく。
 */
export function DiagnosticsRecorder() {
  useEffect(() => {
    installDiagnostics();
  }, []);
  return null;
}
