"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { AlertPanel } from "./AlertPanel";
import { routeIdentityOf } from "../_lib/routeIdentity";
import { collectDiagnostics } from "../_lib/diagnostics/recorder";
import {
  IMPROVEMENT_BODY_MAX,
  IMPROVEMENT_SHOT_MAX_BYTES,
  shotBytesOf,
} from "../../src/domain/rules/improvement";

/**
 * 控えてある診断情報を切り出す。取れなくても要望は送れるようにする。
 * 「環境が取れなかったから意見も届かなかった」が一番避けたい結末。
 */
function safeCollectDiagnostics(): unknown {
  try {
    return collectDiagnostics();
  } catch {
    return { notes: ["診断情報を集められませんでした。"] };
  }
}

/**
 * 全画面共通の「改善要望」。
 *
 * 右下の小さなボタンを押した時点で、いまの画面を撮って書き込める状態にする。
 * 「画面を撮ってから来てください」「コピーして貼り付けてください」のような
 * 中間の操作を挟まない。挟んだ分だけ、気づいた不便は言われないまま消える。
 * どの画面から届いたかは開いている URL から自動で入れる (打たせない)。
 *
 * 撮り方は、いま表示している DOM を描き直す方式 (modern-screenshot、SVG の
 * foreignObject)。ブラウザの画面共有 (getDisplayMedia) は使わない。共有の許可を
 * 毎回聞かれると「押した次の瞬間に書き込める」体験が壊れるため。
 * このアプリの図は div と SVG で描いており canvas・iframe・外部画像を使っていないので、
 * 描き直し方式で忠実に写る。
 *
 * 差し込むのは AppShell の1箇所だけ。画面ごとに置くと、置き忘れた画面が
 * 「意見を出せない画面」になる。
 */

type Point = { x: number; y: number };

type Shape =
  | { kind: "pen"; color: string; points: Point[] }
  | { kind: "rect"; color: string; from: Point; to: Point }
  | { kind: "arrow"; color: string; from: Point; to: Point }
  | { kind: "mask"; color: string; from: Point; to: Point }
  | { kind: "text"; color: string; at: Point; text: string };

type Tool = Shape["kind"];

/** 撮った画像の長辺の上限。これ以上大きくしても読めるものは増えない。 */
const MAX_EDGE = 1600;

/** 印の色。値は globals.css の --mark-* が正本 (画像に焼き込むので明暗で変えない)。 */
const COLOR_KEYS = ["red", "amber", "blue", "ink"] as const;
type ColorKey = (typeof COLOR_KEYS)[number];

const COLOR_LABEL: Record<ColorKey, string> = {
  red: "赤",
  amber: "橙",
  blue: "青",
  ink: "黒",
};

const TOOL_OPTIONS: readonly { value: Tool; label: string }[] = [
  { value: "rect", label: "四角" },
  { value: "arrow", label: "矢印" },
  { value: "pen", label: "手書き" },
  { value: "text", label: "文字" },
  { value: "mask", label: "黒塗り" },
] as const;

/** 印の色を CSS から読む (色の値を画面側に書かないための決まり)。 */
function cssColor(key: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(`--mark-${key}`).trim();
  return v || "#16191d";
}

/** 画像を長辺 MAX_EDGE まで縮めて、書き込めるキャンバスに載る形にする。 */
function loadImage(dataUrl: string): Promise<{ dataUrl: string; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
      const width = Math.max(1, Math.round(img.naturalWidth * scale));
      const height = Math.max(1, Math.round(img.naturalHeight * scale));
      const c = document.createElement("canvas");
      c.width = width;
      c.height = height;
      const ctx = c.getContext("2d");
      if (!ctx) {
        reject(new Error("canvas"));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      resolve({ dataUrl: c.toDataURL("image/jpeg", 0.85), width, height });
    };
    img.onerror = () => reject(new Error("image"));
    img.src = dataUrl;
  });
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("read"));
    reader.readAsDataURL(file);
  });
}

/** 上限に収まるまで品質を落として書き出す。収まらなければ null。 */
function exportCanvas(canvas: HTMLCanvasElement): string | null {
  for (const quality of [0.85, 0.7, 0.55, 0.4, 0.3]) {
    const url = canvas.toDataURL("image/jpeg", quality);
    if (shotBytesOf(url) <= IMPROVEMENT_SHOT_MAX_BYTES) return url;
  }
  return null;
}

export function FeedbackWidget() {
  const pathname = usePathname();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const baseRef = useRef<HTMLImageElement | null>(null);
  const drawingRef = useRef<Shape | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  /** 撮り直し・貼り付けが行き違ったときに、古い方の結果を捨てるための版番号。 */
  const captureVersionRef = useRef(0);
  const submissionKeyRef = useRef("");

  const [open, setOpen] = useState(false);
  const [shot, setShot] = useState<{ dataUrl: string; width: number; height: number } | null>(null);
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [tool, setTool] = useState<Tool>("rect");
  const [color, setColor] = useState<ColorKey>("red");
  const [textDraft, setTextDraft] = useState("");
  const [body, setBody] = useState("");
  /** 窓を開けた時点の画面。開いたまま裏で遷移しても、送り先は撮ったときの画面のままにする。 */
  const [draftPath, setDraftPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bodyError, setBodyError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const screenLabel = routeIdentityOf(draftPath || pathname).label;

  /* ───── 窓の開け閉め ───── */

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  const reset = useCallback(() => {
    captureVersionRef.current += 1;
    setShot(null);
    setShapes([]);
    setBody("");
    setDraftPath(pathname);
    setTextDraft("");
    setError(null);
    setBodyError(null);
    setNotice(null);
    setSent(false);
    setCapturing(false);
    submissionKeyRef.current = crypto.randomUUID();
    baseRef.current = null;
  }, [pathname]);

  /**
   * 描き直しで写らない可能性があるものを、撮る前に数えておく。
   * いまのこのアプリには1つも無い。将来 canvas の図や外部の画像が入ったときに、
   * 黙って崩れた絵が届くのを防ぐための備え。
   */
  const riskyNodeCount = () => {
    const risky = document.querySelectorAll("canvas, iframe, embed, object");
    const foreignImages = [...document.images].filter(
      (img) => img.src.startsWith("http") && !img.src.startsWith(window.location.origin),
    );
    return risky.length + foreignImages.length;
  };

  /* ───── 画像を受け取る ───── */

  const acceptImage = useCallback(async (dataUrl: string, expectedVersion: number) => {
    try {
      const next = await loadImage(dataUrl);
      if (expectedVersion !== captureVersionRef.current) return;
      const img = new Image();
      img.src = next.dataUrl;
      await img.decode();
      if (expectedVersion !== captureVersionRef.current) return;
      baseRef.current = img;
      setShapes([]);
      setShot(next);
    } catch {
      setError("画像を読み込めませんでした。");
    }
  }, []);

  /**
   * いまの画面を撮る。
   *
   * 表示中の DOM を描き直して1枚の絵にする。共有の許可を聞かれないので、
   * 押した直後に書き込める状態まで進める。
   *
   * - この仕組み自体 (.feedback-root) は撮る対象から外す (写り込ませない)。
   * - 見えている範囲だけを切り出す (本文は translate でずらし、上の帯と
   *   左のメニューは貼り付いて見えている位置へ動かす)。
   * - 画面の細かさ (devicePixelRatio) を最大2倍まで見て、文字をぼやけさせない。
   */
  const capture = useCallback(async () => {
    const version = ++captureVersionRef.current;
    setError(null);
    setNotice(
      riskyNodeCount() > 0
        ? "この画面には、絵として写しにくい部品があります。撮れた画像を確かめてください。"
        : null,
    );
    setCapturing(true);
    try {
      const { domToCanvas } = await import("modern-screenshot");
      const scrollY = window.scrollY;
      const scrollX = window.scrollX;
      const canvas = await domToCanvas(document.body, {
        width: window.innerWidth,
        height: window.innerHeight,
        scale: Math.min(2, window.devicePixelRatio || 1),
        backgroundColor: getComputedStyle(document.body).backgroundColor,
        features: {
          // 画面では見えないスクロールバーを描き直しの側で足されると、
          // メニューなど中でスクロールする箱の下端が数ピクセル削られる。
          copyScrollbar: false,
          // 中でスクロールしている箱 (横に流れる表など) も、見えている位置のまま写す。
          restoreScrollPosition: true,
        },
        style: {
          // 描き直す先では body に既定の余白が付く。消さないと絵がずれる。
          margin: "0",
          transform: `translate(${-scrollX}px, ${-scrollY}px)`,
          transformOrigin: "top left",
        },
        filter: (node: Node) =>
          !(node instanceof Element && node.classList?.contains("feedback-root")),
        onCloneNode: (cloned: Node) => {
          if (!(cloned instanceof Element)) return;
          // 上の帯と左のメニューは「貼り付いて」見えている。描き直しにはスクロール量が
          // 無いので、見えている位置まで自分で下ろす。
          if (scrollY > 0) {
            for (const el of cloned.querySelectorAll<HTMLElement>(".app-header, .app-sidebar")) {
              el.style.transform = `translateY(${scrollY}px)`;
            }
          }
          // 中でスクロールする箱は、画面では棒が出ないのに描き直しの側では
          // 場所を取る棒が出る。そのぶん中身の下端・右端が切れるので「はみ出しは隠す」に置き換える。
          for (const el of cloned.querySelectorAll<HTMLElement>("*")) {
            for (const axis of ["overflowX", "overflowY"] as const) {
              if (/auto|scroll|overlay/.test(el.style[axis])) el.style[axis] = "hidden";
            }
          }
        },
      });
      if (version !== captureVersionRef.current) return;
      await acceptImage(canvas.toDataURL("image/png"), version);
    } catch {
      if (version !== captureVersionRef.current) return;
      setError("うまく撮れませんでした。画像を貼り付けるか、ファイルを選んでください。");
    } finally {
      if (version === captureVersionRef.current) setCapturing(false);
    }
  }, [acceptImage]);

  const onPaste = (e: React.ClipboardEvent) => {
    const file = [...e.clipboardData.items].find((i) => i.type.startsWith("image/"))?.getAsFile();
    if (!file) return;
    e.preventDefault();
    const version = ++captureVersionRef.current;
    setCapturing(false);
    void readFileAsDataUrl(file)
      .then((url) => acceptImage(url, version))
      .catch(() => setError("画像を読み込めませんでした。別の画像をお試しください。"));
  };

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const version = ++captureVersionRef.current;
    setCapturing(false);
    void readFileAsDataUrl(file)
      .then((url) => acceptImage(url, version))
      .catch(() => setError("画像を読み込めませんでした。別の画像をお試しください。"));
  };

  const removeShot = () => {
    captureVersionRef.current += 1;
    drawingRef.current = null;
    baseRef.current = null;
    setCapturing(false);
    setShot(null);
    setShapes([]);
    setNotice("画像を外しました。文章だけで送れます。");
  };

  /* ───── 印を描く ───── */

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const base = baseRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !base || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(base, 0, 0, canvas.width, canvas.height);

    const unit = Math.max(2, Math.round(canvas.width / 400));
    const all = drawingRef.current ? [...shapes, drawingRef.current] : shapes;
    for (const shape of all) {
      ctx.lineWidth = unit;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = shape.color;
      ctx.fillStyle = shape.color;
      if (shape.kind === "pen") {
        ctx.beginPath();
        shape.points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
        ctx.stroke();
      } else if (shape.kind === "rect") {
        ctx.strokeRect(
          shape.from.x,
          shape.from.y,
          shape.to.x - shape.from.x,
          shape.to.y - shape.from.y,
        );
      } else if (shape.kind === "mask") {
        ctx.fillRect(
          shape.from.x,
          shape.from.y,
          shape.to.x - shape.from.x,
          shape.to.y - shape.from.y,
        );
      } else if (shape.kind === "arrow") {
        const { from, to } = shape;
        const angle = Math.atan2(to.y - from.y, to.x - from.x);
        const head = unit * 5;
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(to.x, to.y);
        ctx.lineTo(to.x - head * Math.cos(angle - 0.4), to.y - head * Math.sin(angle - 0.4));
        ctx.lineTo(to.x - head * Math.cos(angle + 0.4), to.y - head * Math.sin(angle + 0.4));
        ctx.closePath();
        ctx.fill();
      } else {
        const size = unit * 7;
        ctx.font = `700 ${size}px sans-serif`;
        ctx.textBaseline = "top";
        // 濃い場所でも読めるよう、文字の周りを白で縁取る
        ctx.strokeStyle = cssColor("paper");
        ctx.lineWidth = unit;
        ctx.strokeText(shape.text, shape.at.x, shape.at.y);
        ctx.fillText(shape.text, shape.at.x, shape.at.y);
      }
    }
  }, [shapes]);

  useEffect(() => {
    redraw();
  }, [redraw, shot]);

  const pointOf = (e: React.PointerEvent<HTMLCanvasElement>): Point => {
    const canvas = e.currentTarget;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!shot) return;
    const at = pointOf(e);
    // 黒塗りは「隠す」ための道具なので、色は選ばせず必ず黒にする。
    const c = tool === "mask" ? cssColor("ink") : cssColor(color);
    if (tool === "text") {
      const text = textDraft.trim();
      if (!text) {
        setError("先に、上の欄へ入れる文字を打ってください。");
        return;
      }
      setError(null);
      setShapes((prev) => [...prev, { kind: "text", color: c, at, text }]);
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    drawingRef.current =
      tool === "pen"
        ? { kind: "pen", color: c, points: [at] }
        : { kind: tool, color: c, from: at, to: at };
    redraw();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const current = drawingRef.current;
    if (!current) return;
    const at = pointOf(e);
    if (current.kind === "pen") current.points.push(at);
    else if (current.kind !== "text") current.to = at;
    redraw();
  };

  const onPointerUp = () => {
    const current = drawingRef.current;
    drawingRef.current = null;
    if (!current) return;
    setShapes((prev) => [...prev, current]);
  };

  const undo = () => setShapes((prev) => prev.slice(0, -1));

  /* ───── 送る ───── */

  const submit = async () => {
    if (busy) return;
    if (!body.trim()) {
      setBodyError("改善したいことを入力してください。");
      bodyRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      let image: string | null = null;
      if (shot && canvasRef.current) {
        image = exportCanvas(canvasRef.current);
        if (!image) {
          setError("画像が大きすぎます。範囲を狭めて撮り直してください。");
          return;
        }
      }
      // 同じ鍵で送り直しても1件にまとまる。通信が切れたときに押し直せるようにするため、
      // 送れなかった間は鍵を作り直さない。
      const submissionKey = submissionKeyRef.current || crypto.randomUUID();
      submissionKeyRef.current = submissionKey;
      const res = await fetch("/api/improvements", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          path: draftPath || pathname,
          body: body.trim(),
          viewport: `${window.innerWidth}×${window.innerHeight}`,
          shot: image,
          submissionKey,
          // 送る人には書かせない。「どのブラウザで」「そのときエラーは出ていたか」を
          // 聞き直さずに済ませるため、控えてあった分をここで一緒に送る。
          // 集めそこねても要望自体は送れるように、失敗しても止めない。
          diagnostics: safeCollectDiagnostics(),
        }),
      });
      const json = (await res.json()) as { id?: string; message?: string };
      if (!res.ok) {
        setError(json.message ?? "送れませんでした。");
        return;
      }
      setSent(true);
      setBody("");
      setShot(null);
      setShapes([]);
      setTextDraft("");
      baseRef.current = null;
      submissionKeyRef.current = "";
    } catch {
      setError("通信できませんでした。入力内容はこの窓に残っています。");
    } finally {
      setBusy(false);
    }
  };

  /* ───── 見た目 ───── */

  return (
    <div className="feedback-root no-print">
      <div className="feedback-fab">
        <button
          type="button"
          className="btn btn-secondary pressable"
          onClick={() => {
            // 書きかけがあるときは、開き直しても消さない。
            // 消えると「もう一度書くほどでもない」で意見が止まる。
            const hasDraft = Boolean(body.trim() || shot || shapes.length > 0 || capturing);
            if (sent || !hasDraft) {
              reset();
              // 押した時点で撮る。窓が開いたときには、もう書き込める状態にする。
              void capture();
            } else {
              setNotice("閉じる前の未送信内容を復元しました。");
            }
            setOpen(true);
          }}
        >
          改善要望
        </button>
      </div>

      <dialog
        ref={dialogRef}
        className="feedback-dialog"
        aria-label="改善要望を送る"
        onClose={close}
        onPaste={onPaste}
      >
        <div className="feedback-dialog-body">
          <div className="feedback-dialog-main">
            <p className="text-xs text-ink-muted">この画面について送ります</p>
            <p className="mt-0.5 mb-3 text-sm font-bold text-ink">{screenLabel}</p>

            {sent ? (
              <>
                <AlertPanel tone="success" title="送りました。ありがとうございます。">
                  内容は管理者の一覧に届いています。
                </AlertPanel>
                {/*
                  気づいたことは続けて出てくる。「閉じて押し直す」を挟むと、
                  2件目は言われないまま消えることが多い。
                */}
                <button
                  type="button"
                  className="btn btn-quiet pressable mt-3"
                  onClick={() => {
                    reset();
                    void capture();
                  }}
                >
                  続けてもう1件送る
                </button>
              </>
            ) : (
              <>
                {error && <AlertPanel tone="danger" title={error} />}
                {notice && (
                  <div className={error ? "mt-2" : ""}>
                    <AlertPanel tone="info" title={notice} />
                  </div>
                )}

                <label className="mt-3 block text-xs font-semibold text-ink" htmlFor="feedback_body">
                  改善したいこと
                </label>
                <textarea
                  ref={bodyRef}
                  id="feedback_body"
                  className="mt-1 min-h-[80px] w-full rounded-[var(--radius-control)] border border-line px-3 py-2 text-sm"
                  autoFocus
                  maxLength={IMPROVEMENT_BODY_MAX}
                  value={body}
                  aria-invalid={Boolean(bodyError)}
                  aria-describedby={bodyError ? "feedback_body_error" : undefined}
                  onChange={(e) => {
                    setBody(e.target.value);
                    if (e.target.value.trim()) setBodyError(null);
                  }}
                  placeholder="例：この一覧を、車番で絞り込めると助かります。"
                />
                {bodyError && (
                  <p id="feedback_body_error" className="mt-1 text-xs text-danger" role="alert">
                    {bodyError}
                  </p>
                )}
                {/*
                  上限に近づいたときだけ残りを出す。常時出すと「何文字までか」を
                  気にしながら書かせることになる。逆に何も出さないと、上限に達した
                  瞬間から打った字が消え、理由の分からない不具合に見える。
                */}
                {IMPROVEMENT_BODY_MAX - body.length <= 100 && (
                  <p className="mt-1 text-xs text-ink-muted" aria-live="polite">
                    あと{IMPROVEMENT_BODY_MAX - body.length}文字書けます。
                  </p>
                )}

                {capturing && (
                  <div className="feedback-shooting mt-3" role="status">
                    <span>この画面を撮っています…</span>
                  </div>
                )}

                {shot && (
                  <div className="mt-3">
                    <div className="feedback-tools">
                      <div className="flex flex-wrap items-center gap-1" role="group" aria-label="書き込む道具">
                        {TOOL_OPTIONS.map((o) => (
                          <button
                            key={o.value}
                            type="button"
                            className="feedback-chip"
                            aria-pressed={tool === o.value}
                            onClick={() => setTool(o.value)}
                          >
                            {o.label}
                          </button>
                        ))}
                      </div>
                      {/* 黒塗りは隠すための道具なので、色は選ばせない */}
                      {tool !== "mask" && (
                        <div className="flex items-center gap-1" role="group" aria-label="印の色">
                          {COLOR_KEYS.map((key) => (
                            <button
                              key={key}
                              type="button"
                              className="feedback-chip"
                              aria-pressed={color === key}
                              aria-label={`${COLOR_LABEL[key]}で書く`}
                              onClick={() => setColor(key)}
                            >
                              <span className="feedback-swatch" data-mark={key} />
                            </button>
                          ))}
                        </div>
                      )}
                      <button
                        type="button"
                        className="btn btn-quiet"
                        onClick={undo}
                        disabled={shapes.length === 0}
                      >
                        元に戻す
                      </button>
                    </div>

                    {tool === "text" && (
                      <input
                        type="text"
                        className="mt-2 w-full rounded-[var(--radius-control)] border border-line px-3 py-2 text-sm"
                        value={textDraft}
                        maxLength={40}
                        onChange={(e) => setTextDraft(e.target.value)}
                        placeholder="入れる文字を打ってから、画像を押します"
                      />
                    )}

                    <canvas
                      ref={canvasRef}
                      className="feedback-canvas mt-2"
                      aria-label="画面の写し。選んだ道具で注釈を書き込めます"
                      width={shot.width}
                      height={shot.height}
                      onPointerDown={onPointerDown}
                      onPointerMove={onPointerMove}
                      onPointerUp={onPointerUp}
                      onPointerCancel={onPointerUp}
                    />
                    <p className="mt-1 text-xs text-ink-muted">
                      見られたくない部分は「黒塗り」で隠せます。黒塗りの色は変えられません。
                    </p>
                  </div>
                )}

                {/* 撮り直しと、撮れなかったときの逃げ道。主役ではないので下に小さく置く。 */}
                <div className="feedback-alt mt-3">
                  <button
                    type="button"
                    className="btn btn-quiet"
                    onClick={() => void capture()}
                    disabled={busy || capturing}
                  >
                    {shot ? "撮り直す" : "もう一度撮る"}
                  </button>
                  {(shot || capturing) && (
                    <button type="button" className="btn btn-quiet" onClick={removeShot} disabled={busy}>
                      画像を外す（文章だけで送る）
                    </button>
                  )}
                  <span className="text-xs text-ink-muted">
                    うまく撮れないときは、画像を貼り付け（Ctrl+V）するか
                    <button
                      type="button"
                      className="feedback-link"
                      onClick={() => fileRef.current?.click()}
                    >
                      ファイルを選ぶ
                    </button>
                    こともできます。
                  </span>
                  <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPickFile} />
                </div>

                {/*
                  黙って環境を集めない。入力は増やさないが、何が一緒に行くかは書いておく。
                  「勝手に取られていた」と後から知る方が、信頼を大きく損なう。
                */}
                <p className="mt-3 text-xs text-ink-muted">
                  送信時に、ご利用のブラウザ・画面の大きさ・直近のエラー記録も一緒に送られます
                  （パスワード・メールアドレスなどは自動で伏せられます）。
                </p>
              </>
            )}
          </div>

          <div className="feedback-dialog-foot">
            <button type="button" className="btn btn-quiet" onClick={close}>
              閉じる
            </button>
            {!sent && (
              <button
                type="button"
                className="btn btn-primary pressable"
                onClick={() => void submit()}
                disabled={busy || capturing}
              >
                {/* 押した後に何も変わらないと、届いていないと思って押し直される */}
                {busy ? "送っています…" : "送る"}
              </button>
            )}
          </div>
        </div>
      </dialog>
    </div>
  );
}
