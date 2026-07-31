#!/usr/bin/env python3
"""恵友会 medical slides — HTML(.h-ppt-page) → 編集可能な PPTX ビルダー.

html-to-pptx を Playwright(Chromium) の中で実行し、DOM の描画結果を解析して
ネイティブな PowerPoint 図形/テキスト/表/グラフに変換する。
さらにフォント(Noto Sans JP / Inter)を pptx に埋め込み、Windows / Mac の
どちらで開いても同じ表示になるようにする。

使い方:
    python3 build_pptx.py <input.html> <output.pptx> [page_class]
    python3 build_pptx.py <input.html> <output.pptx> --no-embed   # フォント埋め込みを無効化

- <input.html> 内の各スライドは <div class="h-ppt-page"> ... </div>
- HTML と同じディレクトリを簡易 HTTP サーバで配信するため、deck.css や
  assets/*.png などの相対パス参照はそのまま解決される。
- 同梱フォントが未インストールなら自動で導入し、文字幅計測を安定させる。
- ビルド後、framework/embed-fonts/ の静的フォントを pptx に埋め込む(既定で有効)。
"""
import sys, os, base64, pathlib, shutil, subprocess, threading, functools
import http.server, socketserver, contextlib

SKILL_ROOT = pathlib.Path(__file__).resolve().parent.parent
BUNDLE = SKILL_ROOT / "framework" / "html-to-pptx.browser.js"
FONTS_DIR = SKILL_ROOT / "fonts"
EMBED_FONTS_DIR = SKILL_ROOT / "framework" / "embed-fonts"


def ensure_fonts():
    """同梱の可変フォントを ~/.fonts に導入(未導入時のみ)。"""
    try:
        listed = subprocess.run(["fc-list"], capture_output=True, text=True).stdout
    except FileNotFoundError:
        return  # fontconfig 不在の環境ではスキップ
    need = []
    if "Noto Sans JP" not in listed:
        need.append("NotoSansJP.otf")
    if "Inter" not in listed:
        need.append("Inter.ttf")
    if not need:
        return
    dest = pathlib.Path.home() / ".fonts"
    dest.mkdir(parents=True, exist_ok=True)
    for f in need:
        src = FONTS_DIR / f
        if src.exists():
            shutil.copy(src, dest / f)
    subprocess.run(["fc-cache", "-f"], capture_output=True)
    print(f"installed fonts: {', '.join(need)}")


@contextlib.contextmanager
def serve(directory):
    handler = functools.partial(http.server.SimpleHTTPRequestHandler,
                                directory=str(directory))
    httpd = socketserver.TCPServer(("127.0.0.1", 0), handler)
    port = httpd.server_address[1]
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    try:
        yield port
    finally:
        httpd.shutdown()


def _launch(p):
    try:
        return p.chromium.launch(args=["--force-color-profile=srgb"])
    except Exception:
        # Chromium 未取得なら取得を試みる(ネットワーク必要)
        subprocess.run([sys.executable, "-m", "playwright", "install", "chromium"],
                       check=False)
        return p.chromium.launch(args=["--force-color-profile=srgb"])


def embed(out_path):
    """ビルド済み pptx にフォントを埋め込む(Win/Mac 共通表示)。"""
    try:
        sys.path.insert(0, str(SKILL_ROOT / "framework"))
        import embed_fonts
    except Exception as e:
        print(f"[warn] embed_fonts を読み込めず埋め込みをスキップ: {e}")
        return
    fm = embed_fonts.default_map(str(EMBED_FONTS_DIR))
    missing = [s for d in fm for s in (d.get("regular"), d.get("bold"))
               if s and not os.path.exists(s)]
    if missing:
        print(f"[warn] 埋め込み用フォントが見つからずスキップ: {missing}")
        return
    embed_fonts.embed_fonts(out_path, fm)
    print(f"embedded fonts into {out_path} (Windows/Mac 共通表示)")


def build(html_path, out_path, page_class="h-ppt-page", do_embed=True):
    from playwright.sync_api import sync_playwright
    ensure_fonts()
    html_path = pathlib.Path(html_path).resolve()
    root = html_path.parent
    with serve(root) as port:
        with sync_playwright() as p:
            browser = _launch(p)
            page = browser.new_page(viewport={"width": 1280, "height": 720},
                                    device_scale_factor=2)
            page.goto(f"http://127.0.0.1:{port}/{html_path.name}",
                      wait_until="networkidle")
            page.evaluate("document.fonts.ready")
            page.wait_for_timeout(450)  # フォント確定を待つ
            page.add_script_tag(path=str(BUNDLE))
            b64 = page.evaluate(
                "async (cls) => await window.HtmlToPptx.exportHtmlToPpt(cls, 'base64')",
                page_class,
            )
            browser.close()
    data = base64.b64decode(b64)
    pathlib.Path(out_path).write_bytes(data)
    print(f"wrote {out_path} ({len(data)} bytes)")
    if do_embed:
        embed(out_path)


if __name__ == "__main__":
    args = [a for a in sys.argv[1:]]
    do_embed = True
    if "--no-embed" in args:
        do_embed = False
        args.remove("--no-embed")
    if len(args) < 2:
        print(__doc__)
        sys.exit(1)
    pc = args[2] if len(args) > 2 else "h-ppt-page"
    build(args[0], args[1], pc, do_embed=do_embed)
