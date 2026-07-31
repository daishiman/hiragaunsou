#!/usr/bin/env python3
"""Embed TrueType fonts into a .pptx so it renders identically on Windows/Mac
regardless of installed fonts. Adds full-character embedding (editable).

Usage (CLI): python3 embed_fonts.py deck.pptx [fonts_dir]
  fonts_dir must contain: NotoSansJP-Medium.ttf, NotoSansJP-Bold.ttf,
                          Inter-Medium.ttf, Inter-SemiBold.ttf
Or import embed_fonts(pptx_path, font_map) for custom maps.
"""
import sys, os, re, zipfile, shutil

REL_FONT = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/font"

def _next_rids(rels_xml, count):
    ids = [int(m) for m in re.findall(r'Id="rId(\d+)"', rels_xml)]
    start = (max(ids) + 1) if ids else 1
    return [f"rId{start+i}" for i in range(count)]

def embed_fonts(pptx_path, font_map):
    """font_map: list of dicts {typeface, regular, bold, italic, boldItalic} (paths or None)."""
    tmp = pptx_path + ".tmp.zip"
    zin = zipfile.ZipFile(pptx_path, "r")
    parts = {n: zin.read(n) for n in zin.namelist()}
    infos = {n: zin.getinfo(n) for n in zin.namelist()}
    zin.close()

    # 1) collect font files -> part names
    font_parts = {}  # path -> ppt/fonts/fontN.fntdata
    n = 1
    for fm in font_map:
        for slot in ("regular", "bold", "italic", "boldItalic"):
            p = fm.get(slot)
            if p and p not in font_parts:
                font_parts[p] = f"ppt/fonts/font{n}.fntdata"
                n += 1

    # 2) [Content_Types].xml : add Default for fntdata
    ct = parts["[Content_Types].xml"].decode("utf-8")
    if "Extension=\"fntdata\"" not in ct:
        ct = ct.replace("<Default Extension=\"xml\"",
                        "<Default Extension=\"fntdata\" ContentType=\"application/x-fontdata\"/><Default Extension=\"xml\"", 1)
        if "Extension=\"fntdata\"" not in ct:  # fallback if no xml default
            ct = ct.replace("</Types>", "<Default Extension=\"fntdata\" ContentType=\"application/x-fontdata\"/></Types>", 1)
    parts["[Content_Types].xml"] = ct.encode("utf-8")

    # 3) presentation rels : add font relationships
    rels = parts["ppt/_rels/presentation.xml.rels"].decode("utf-8")
    path_to_rid = {}
    new_rids = _next_rids(rels, len(font_parts))
    add = []
    for (path, part), rid in zip(font_parts.items(), new_rids):
        path_to_rid[path] = rid
        target = part.split("ppt/", 1)[1]  # relative to ppt/
        add.append(f'<Relationship Id="{rid}" Type="{REL_FONT}" Target="{target}"/>')
    rels = rels.replace("</Relationships>", "".join(add) + "</Relationships>", 1)
    parts["ppt/_rels/presentation.xml.rels"] = rels.encode("utf-8")

    # 4) presentation.xml : flags + embeddedFontLst
    pres = parts["ppt/presentation.xml"].decode("utf-8")
    # flags on root tag
    if "saveSubsetFonts=" in pres:
        pres = re.sub(r'saveSubsetFonts="\d"', 'saveSubsetFonts="0"', pres, count=1)
    else:
        pres = pres.replace("<p:presentation ", '<p:presentation saveSubsetFonts="0" ', 1)
    if "embedTrueTypeFonts=" not in pres:
        pres = pres.replace("<p:presentation ", '<p:presentation embedTrueTypeFonts="1" ', 1)
    # build embeddedFontLst
    blocks = []
    for fm in font_map:
        tf = fm["typeface"]
        slots = ""
        for slot, tag in (("regular","regular"),("bold","bold"),("italic","italic"),("boldItalic","boldItalic")):
            p = fm.get(slot)
            if p:
                slots += f'<p:{tag} r:id="{path_to_rid[p]}"/>'
        blocks.append(f'<p:embeddedFont><p:font typeface="{tf}"/>{slots}</p:embeddedFont>')
    efl = "<p:embeddedFontLst>" + "".join(blocks) + "</p:embeddedFontLst>"
    # insert after notesSz (schema: before custShowLst/defaultTextStyle)
    m = re.search(r'<p:notesSz[^/]*/>', pres)
    if m:
        pres = pres[:m.end()] + efl + pres[m.end():]
    else:
        # fallback: before defaultTextStyle or sldIdLst close
        if "<p:defaultTextStyle" in pres:
            pres = pres.replace("<p:defaultTextStyle", efl + "<p:defaultTextStyle", 1)
        else:
            pres = pres.replace("</p:presentation>", efl + "</p:presentation>", 1)
    parts["ppt/presentation.xml"] = pres.encode("utf-8")

    # 5) write new zip
    zout = zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED)
    for name, data in parts.items():
        zi = infos.get(name)
        if zi is not None:
            zout.writestr(zi, data)
        else:
            zout.writestr(name, data)
    for path, part in font_parts.items():
        with open(path, "rb") as fh:
            zout.writestr(part, fh.read())
    zout.close()
    shutil.move(tmp, pptx_path)
    return pptx_path

def default_map(fonts_dir):
    j = lambda f: os.path.join(fonts_dir, f)
    return [
        {"typeface":"Noto Sans JP","regular":j("NotoSansJP-Medium.ttf"),"bold":j("NotoSansJP-Bold.ttf")},
        {"typeface":"Inter","regular":j("Inter-Medium.ttf"),"bold":j("Inter-SemiBold.ttf")},
    ]

if __name__ == "__main__":
    pptx = sys.argv[1]
    fonts_dir = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "embed-fonts")
    fm = default_map(fonts_dir)
    missing = [s for d in fm for s in (d.get("regular"),d.get("bold")) if s and not os.path.exists(s)]
    if missing:
        print("MISSING FONT FILES:", missing); sys.exit(1)
    embed_fonts(pptx, fm)
    print("embedded fonts into", pptx)
