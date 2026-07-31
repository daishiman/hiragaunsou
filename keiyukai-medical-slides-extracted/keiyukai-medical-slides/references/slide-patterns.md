# スライドパターン集（コピペ用テンプレート）

各スライドは `<div class="h-ppt-page">…</div>`。中身ページは `pad`（セーフマージン）を付ける。
文言・数値を差し替えて使う。`deck.css` を `<link>` で読み込む前提。共通の HTML 雛形：

```html
<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8">
<link rel="stylesheet" href="deck.css"></head><body>
  <!-- ここに各スライドの <div class="h-ppt-page"> を並べる -->
</body></html>
```

**フッター部品**（中身ページの末尾に置く。ページ番号だけ変える）:
```html
<div class="foot">
  <div class="foot-logo"><img src="assets/logo-green.png" class="logo-mark"><span class="foot-name">恵友会</span><span class="foot-sub">医療法人</span></div>
  <div class="pageno">04</div>
</div>
```

---

## P1. 表紙（白・主役は下三分の一＋抽象グラフィック＋タグ）

```html
<div class="h-ppt-page">
  <!-- ロゴ -->
  <div style="position:absolute;left:90px;top:64px;display:flex;align-items:center;gap:14px;">
    <img src="assets/logo-green.png" style="width:42px;height:42px;">
    <div style="display:flex;flex-direction:column;gap:2px;">
      <div style="font-size:22px;font-weight:700;color:var(--ink-1);letter-spacing:1px;">恵友会</div>
      <div style="font-size:15px;font-weight:500;color:var(--ink-3);letter-spacing:2px;">医療法人</div>
    </div>
  </div>
  <!-- 右上：メタ（学会名など） -->
  <div style="position:absolute;right:90px;top:66px;text-align:right;">
    <div style="font-size:16px;font-weight:700;color:var(--ink-2);letter-spacing:1px;">第12回 日本地域医療連携学会</div>
    <div style="font-size:15px;font-weight:500;color:var(--ink-4);letter-spacing:1px;margin-top:5px;">学術集会 ／ 一般演題</div>
  </div>
  <!-- 右側グラフィック：伸びゆくバーの抽象モチーフ（情報過多にしない範囲で） -->
  <div style="position:absolute;right:96px;top:47%;transform:translateY(-50%);display:flex;flex-direction:column;gap:15px;align-items:flex-end;">
    <div style="width:118px;height:17px;border-radius:9999px;background:var(--primary-tint);"></div>
    <div style="width:182px;height:17px;border-radius:9999px;background:var(--primary-soft);"></div>
    <div style="width:248px;height:17px;border-radius:9999px;background:var(--primary);"></div>
    <div style="width:320px;height:17px;border-radius:9999px;background:var(--primary-deep);"></div>
  </div>
  <!-- 主役組み＋トピックタグ -->
  <div style="position:absolute;left:90px;bottom:164px;">
    <div class="eyebrow" style="margin-bottom:22px;">KEIYUKAI MEDICAL CORPORATION</div>
    <div class="t-hero" style="margin-bottom:26px;">地域とともに、<br>健やかな暮らしを支える</div>
    <div class="lead" style="max-width:720px;margin-bottom:30px;">恵友病院における地域包括ケアの取り組みと、これからの医療連携について</div>
    <div style="display:flex;gap:12px;">
      <div class="tag" style="padding:9px 20px;">地域包括ケア</div>
      <div class="tag" style="padding:9px 20px;">医療連携</div>
      <div class="tag" style="padding:9px 20px;">在宅医療</div>
    </div>
  </div>
  <!-- 区切り＋メタ -->
  <div style="position:absolute;left:90px;right:90px;bottom:60px;">
    <div class="rule-soft" style="margin-bottom:18px;"></div>
    <div style="display:flex;justify-content:space-between;align-items:flex-end;">
      <div class="meta">和歌山県海南市　恵友病院 大会議室</div>
      <div class="meta num">2026.07.18　医療法人恵友会　恵友病院</div>
    </div>
  </div>
</div>
```

## P2. 目次（連番＋区切り線）

```html
<div class="h-ppt-page pad">
  <div class="eyebrow" style="margin-bottom:14px;">AGENDA</div>
  <div class="t-title" style="margin-bottom:54px;">本日お話しすること</div>
  <div style="display:flex;flex-direction:column;gap:0;">
    <!-- 行を必要数。最終行だけ border-bottom も付ける -->
    <div style="display:flex;align-items:center;gap:36px;padding:24px 4px;border-top:2px solid var(--border-soft);">
      <div class="num" style="font-size:34px;font-weight:600;color:var(--primary);width:64px;">01</div>
      <div class="t-card" style="flex:1;">当院の概要と地域での役割</div>
      <div class="body-sm" style="color:var(--ink-4);">背景</div>
    </div>
    <div style="display:flex;align-items:center;gap:36px;padding:24px 4px;border-top:2px solid var(--border-soft);border-bottom:2px solid var(--border-soft);">
      <div class="num" style="font-size:34px;font-weight:600;color:var(--primary);width:64px;">02</div>
      <div class="t-card" style="flex:1;">地域医療が直面する課題</div>
      <div class="body-sm" style="color:var(--ink-4);">課題</div>
    </div>
  </div>
</div>
```

## P3. 中扉（ロゴ緑・巨大連番）

```html
<div class="h-ppt-page page-brand pad">
  <img src="assets/logo-white.png" style="position:absolute;left:90px;top:72px;width:36px;height:36px;opacity:0.95;">
  <div style="position:absolute;left:90px;top:50%;transform:translateY(-50%);">
    <div class="num" style="font-size:128px;font-weight:600;line-height:0.9;color:rgba(255,255,255,0.85);letter-spacing:-2px;margin-bottom:10px;">01</div>
    <div class="eyebrow" style="color:#fff;margin-bottom:16px;">SECTION 01</div>
    <div class="t-section">当院の概要と<br>地域での役割</div>
  </div>
  <div class="meta" style="position:absolute;left:90px;bottom:56px;color:rgba(255,255,255,0.8);">恵友病院 ／ 地域包括ケアの取り組み</div>
</div>
```
<!-- 地色はロゴ緑（.page-brand）。深緑は使わない。巨大数字と見出しは白でOK（大きいので可読）。
     小さなラベルも白でよいが不安なら省略する。 -->

## P4. 課題カード（縦バー＋番号、3カラム）

```html
<div class="h-ppt-page pad">
  <div class="eyebrow" style="margin-bottom:14px;">CHALLENGES</div>
  <div class="t-title" style="margin-bottom:18px;">地域医療が直面する3つの課題</div>
  <div class="lead" style="max-width:880px;margin-bottom:50px;">高齢化が進む地域では、医療と生活の両面で新しい支え方が求められています。</div>
  <div style="display:flex;gap:30px;">
    <!-- カードを3つ。番号だけ変える -->
    <div class="card-soft" style="flex:1;padding:38px 34px;">
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:22px;">
        <div class="bar-tall"></div>
        <div class="num" style="font-size:24px;font-weight:600;color:var(--primary);">01</div>
      </div>
      <div class="t-card-sm" style="margin-bottom:14px;">通院の負担</div>
      <div class="body">移動が難しい高齢の患者さんが増え、通院そのものが大きな負担になっています。</div>
    </div>
    <!-- …02, 03 … -->
  </div>
  <!-- フッター -->
</div>
```

## P5. 取り組みカード（大番号＋カラーバー、3カラム）

```html
<div class="h-ppt-page pad">
  <div class="eyebrow" style="margin-bottom:14px;">OUR APPROACH</div>
  <div class="t-title" style="margin-bottom:50px;">私たちの3つの取り組み</div>
  <div style="display:flex;gap:30px;">
    <div class="card" style="flex:1;padding:40px 34px;">
      <div class="num" style="font-size:46px;font-weight:600;color:var(--primary);line-height:1;margin-bottom:18px;">01</div>
      <div class="bar" style="margin-bottom:26px;"></div>
      <div class="t-card" style="margin-bottom:16px;">在宅医療チーム</div>
      <div class="body">医師・看護師・管理栄養士が連携し、ご自宅での療養を一体で支えます。</div>
    </div>
    <!-- …02, 03 … -->
  </div>
  <!-- フッター -->
</div>
```

## P6. ドットリスト＋朱の差し色（左説明／右リスト）

朱（accent＝差し色）を **1スライド1箇所**、最重要の1点または注意喚起に効かせる例。

```html
<div class="h-ppt-page pad">
  <div style="display:flex;gap:56px;">
    <div style="width:430px;flex:none;">
      <div class="eyebrow" style="margin-bottom:14px;">WHAT WE DO</div>
      <div class="t-title" style="margin-bottom:22px;">対応できること</div>
      <div class="body" style="margin-bottom:34px;">外来から在宅まで、地域の暮らしに寄り添う診療体制を整えています。</div>
      <div style="background:var(--accent-tint);border-radius:12px;padding:22px 24px;">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;">
          <div style="width:22px;height:22px;border-radius:9999px;background:var(--accent);"></div>
          <div style="font-size:18px;font-weight:700;color:var(--accent);">ご注意</div>
        </div>
        <div class="body-sm" style="color:var(--ink-2);">緊急性の高い症状がある場合は、フォームではなくお電話でご連絡ください。</div>
      </div>
    </div>
    <div class="card-soft" style="flex:1;padding:44px 46px;">
      <div style="display:flex;align-items:center;gap:18px;padding-bottom:22px;border-bottom:2px solid var(--border-soft);margin-bottom:8px;">
        <div class="dot"></div><div class="body" style="color:var(--ink-1);font-weight:700;">内科・外科・整形外科の総合診療</div>
      </div>
      <!-- 行を必要数。最後の行は border-bottom 無し・padding-top のみ -->
      <div style="display:flex;align-items:center;gap:18px;padding-top:22px;">
        <div class="dot"></div><div class="body" style="color:var(--ink-1);font-weight:700;">退院後のご自宅への訪問看護</div>
      </div>
    </div>
  </div>
  <!-- フッター -->
</div>
```

## P7. KPIダッシュボード（大数値カード、4カラム）

数値は Inter。良い変化なら緑（`--primary-deep`）、中立は `--ink-1`。増減は符号付き数値で。

```html
<div class="h-ppt-page pad">
  <div class="eyebrow" style="margin-bottom:14px;">KEY RESULTS</div>
  <div class="t-title" style="margin-bottom:14px;">導入後の主な成果</div>
  <div class="lead" style="max-width:900px;margin-bottom:48px;">地域連携の仕組みを整えたことで、患者さんの暮らしと医療の質に確かな変化が生まれました。</div>
  <div style="display:flex;gap:26px;">
    <div class="card" style="flex:1;padding:34px 30px;">
      <div class="meta" style="margin-bottom:18px;">在宅患者数</div>
      <div style="display:flex;align-items:baseline;gap:6px;margin-bottom:18px;">
        <div class="num" style="font-size:74px;font-weight:600;color:var(--primary-deep);line-height:0.9;letter-spacing:-1px;">318</div>
        <div class="kpi-unit">人</div>
      </div>
      <div class="bar" style="margin-bottom:16px;"></div>
      <div class="body-sm">3年間で約2.6倍に増加</div>
    </div>
    <!-- …他のKPIを3つ。減少が良い指標は値を緑にして「−32」のように符号付きで … -->
  </div>
  <!-- フッター -->
</div>
```

## P8. 横ステップ（番号丸、流れ）— 接続線は引かない

番号丸を横に並べるだけで「流れ」は十分伝わる。**接続線は描かない**（Chromium と PPT の
差で線がテキスト位置に割れて崩れるため。番号の連続が流れを語る）。

```html
<div class="h-ppt-page pad">
  <div class="eyebrow" style="margin-bottom:14px;">CARE FLOW</div>
  <div class="t-title" style="margin-bottom:60px;">受診から在宅までの流れ</div>
  <div style="display:flex;gap:24px;position:relative;">
    <div style="flex:1;display:flex;flex-direction:column;align-items:flex-start;">
      <div style="width:72px;height:72px;border-radius:9999px;background:var(--primary);display:flex;align-items:center;justify-content:center;margin-bottom:26px;">
        <div class="num white" style="font-size:30px;font-weight:600;">01</div>
      </div>
      <div class="t-card-sm" style="margin-bottom:12px;">ご相談・予約</div>
      <div class="body-sm">電話・窓口・連携先からのご紹介で受け付けます。</div>
    </div>
    <!-- …02〜05。最後の丸だけ background:var(--primary-deep) にして到達点を示す … -->
  </div>
  <!-- フッター -->
</div>
```

## P9. Before / After（2カラム比較）

導入前＝グレー（`card-soft`＋グレーのドット）、導入後＝緑（`card`＋緑枠＋`.dot`）。
色の対比で変化を語る。

```html
<div class="h-ppt-page pad">
  <div class="eyebrow" style="margin-bottom:14px;">BEFORE &amp; AFTER</div>
  <div class="t-title" style="margin-bottom:50px;">連携体制の導入による変化</div>
  <div style="display:flex;gap:30px;align-items:stretch;">
    <div class="card-soft" style="flex:1;padding:40px 38px;">
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:28px;">
        <div class="pill meta" style="background:#EEF1EA;color:var(--ink-3);padding:7px 18px;font-weight:700;letter-spacing:1px;">導入前</div>
      </div>
      <div style="display:flex;align-items:flex-start;gap:16px;padding-bottom:20px;border-bottom:2px solid var(--border-soft);margin-bottom:20px;">
        <div style="width:10px;height:10px;border-radius:9999px;background:var(--ink-4);flex:none;margin-top:9px;"></div>
        <div class="body" style="color:var(--ink-2);">退院後の経過が見えず、再入院が起こりやすい</div>
      </div>
      <!-- …行を追加。最後は border-bottom 無し … -->
    </div>
    <div class="card" style="flex:1;padding:40px 38px;border-color:var(--primary-soft);">
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:28px;">
        <div class="pill meta" style="background:var(--primary-tint);color:var(--primary-ink);padding:7px 18px;font-weight:700;letter-spacing:1px;">導入後</div>
      </div>
      <div style="display:flex;align-items:flex-start;gap:16px;padding-bottom:20px;border-bottom:2px solid var(--border-soft);margin-bottom:20px;">
        <div class="dot" style="margin-top:9px;"></div>
        <div class="body" style="color:var(--ink-1);">記録を共有し、退院後も切れ目なく経過を把握</div>
      </div>
      <!-- …行を追加 … -->
    </div>
  </div>
  <!-- フッター -->
</div>
```

## P10. ネイティブグラフ（棒＋折れ線）— 学会データに最適

詳細は `library-notes.md` §9。色は必ず緑系。div の幅高さがグラフの配置になる。

```html
<div class="h-ppt-page pad">
  <div class="eyebrow" style="margin-bottom:14px;">DATA</div>
  <div class="t-title" style="margin-bottom:14px;">在宅患者数と満足度の推移</div>
  <div class="lead" style="max-width:920px;margin-bottom:30px;">取り組みの定着とともに、支える患者数と満足度がともに伸びています。</div>
  <div style="display:flex;gap:36px;">
    <div style="flex:1;">
      <div class="meta" style="margin-bottom:6px;">在宅患者数（人）　2021–2025</div>
      <div style="position:relative;width:540px;height:300px;"
        data-pptx-chart-config='{"type":"bar","data":[{"name":"在宅患者数","labels":["2021","2022","2023","2024","2025"],"values":[120,168,205,262,318]}],"options":{"barDir":"col","chartColors":["7DBE2A"],"showValue":true,"showLegend":false,"showTitle":false,"catAxisLabelColor":"5F6A5C","valAxisLabelColor":"8A9485","catAxisLabelFontFace":"Noto Sans JP","valAxisLabelFontFace":"Inter","catAxisLabelFontSize":12,"valAxisLabelFontSize":11,"dataLabelColor":"3A4438","dataLabelFontFace":"Inter","dataLabelFontSize":11,"valGridLine":{"color":"E8ECE3","size":1},"catGridLine":{"style":"none"},"barGapWidthPct":55}}'></div>
    </div>
    <div style="flex:1;">
      <div class="meta" style="margin-bottom:6px;">患者満足度（%）　月次推移</div>
      <div style="position:relative;width:520px;height:300px;"
        data-pptx-chart-config='{"type":"line","data":[{"name":"満足度","labels":["1月","2月","3月","4月","5月","6月"],"values":[78,81,83,86,88,91]}],"options":{"chartColors":["65A018"],"lineSize":3,"showValue":false,"showLegend":false,"showTitle":false,"lineDataSymbol":"circle","lineDataSymbolSize":7,"catAxisLabelColor":"5F6A5C","valAxisLabelColor":"8A9485","catAxisLabelFontFace":"Noto Sans JP","valAxisLabelFontFace":"Inter","catAxisLabelFontSize":12,"valAxisLabelFontSize":11,"valAxisMinVal":70,"valAxisMaxVal":100,"valGridLine":{"color":"E8ECE3","size":1},"catGridLine":{"style":"none"}}}'></div>
    </div>
  </div>
  <!-- フッター -->
</div>
```

## P11. ネイティブ表（診療科別データ等）

詳細は `library-notes.md` §10。ヘッダ＝深緑地に白・700。本文＝500、数値は Inter・中央寄せ。
行を白／`--surface-soft` で交互にする。`前年比` は緑で。

```html
<div class="h-ppt-page pad">
  <div class="eyebrow" style="margin-bottom:14px;">STATISTICS</div>
  <div class="t-title" style="margin-bottom:14px;">診療科別の患者数推移</div>
  <div class="lead" style="max-width:920px;margin-bottom:30px;">主要な診療科のいずれも、地域からの受診が着実に増えています。</div>
  <table style="width:1100px;border-collapse:collapse;table-layout:fixed;">
    <tr>
      <td style="width:300px;background:var(--primary-deep);color:#fff;font-weight:700;font-size:18px;padding:18px 24px;text-align:left;">診療科</td>
      <td style="background:var(--primary-deep);color:#fff;font-weight:700;font-size:18px;padding:18px 20px;text-align:center;font-family:Inter;">2023年</td>
      <td style="background:var(--primary-deep);color:#fff;font-weight:700;font-size:18px;padding:18px 20px;text-align:center;font-family:Inter;">2024年</td>
      <td style="background:var(--primary-deep);color:#fff;font-weight:700;font-size:18px;padding:18px 20px;text-align:center;font-family:Inter;">2025年</td>
      <td style="background:var(--primary-deep);color:#fff;font-weight:700;font-size:18px;padding:18px 20px;text-align:center;">前年比</td>
    </tr>
    <tr>
      <td style="background:#fff;color:var(--ink-1);font-weight:700;font-size:18px;padding:17px 24px;text-align:left;border-bottom:1px solid var(--border-1);">内科・総合診療</td>
      <td style="background:#fff;color:var(--ink-2);font-size:18px;padding:17px 20px;text-align:center;font-family:Inter;border-bottom:1px solid var(--border-1);">4,820</td>
      <td style="background:#fff;color:var(--ink-2);font-size:18px;padding:17px 20px;text-align:center;font-family:Inter;border-bottom:1px solid var(--border-1);">5,140</td>
      <td style="background:#fff;color:var(--ink-1);font-weight:700;font-size:18px;padding:17px 20px;text-align:center;font-family:Inter;border-bottom:1px solid var(--border-1);">5,610</td>
      <td style="background:#fff;color:var(--primary-deep);font-weight:700;font-size:17px;padding:17px 20px;text-align:center;font-family:Inter;border-bottom:1px solid var(--border-1);">+9.1%</td>
    </tr>
    <!-- 行を交互に background:var(--surface-soft) / #fff で追加。最終行は border-bottom 無し -->
  </table>
  <!-- フッター -->
</div>
```

## P12. 図解（地域連携図・概念図）

中心（ハブ）＋上下左右の箱を、縦横の直線で結ぶ。斜め線は不可。座標は実測で合わせる。
コネクタを先に、箱を後に置くと線端が隠れて綺麗（重なり順）。

```html
<div class="h-ppt-page pad">
  <div class="eyebrow" style="margin-bottom:14px;">NETWORK</div>
  <div class="t-title" style="margin-bottom:8px;">地域連携の全体像</div>
  <div class="lead" style="max-width:940px;margin-bottom:6px;">恵友病院を中核に、各機関が連携し暮らしを切れ目なく支えます。</div>

  <div class="dgm" style="width:1000px;height:404px;">
    <!-- コネクタ（直線：背面に先に描画） -->
    <div class="dgm-line-v" style="left:498px;top:72px;height:68px;"></div>
    <div class="dgm-line-v" style="left:498px;top:264px;height:68px;"></div>
    <div class="dgm-line-h" style="left:240px;top:200px;width:120px;"></div>
    <div class="dgm-line-h" style="left:640px;top:200px;width:120px;"></div>
    <!-- 中核（ハブ） -->
    <div class="dgm-hub" style="left:360px;top:140px;width:280px;height:124px;">
      <div class="t">恵友病院</div><div class="s">地域包括ケアの中核</div>
    </div>
    <!-- 連携先（上下左右、ハブと中心線を揃える） -->
    <div class="dgm-box" style="left:375px;top:0;width:250px;height:72px;">
      <div class="t">かかりつけ診療所</div><div class="s">紹介・逆紹介</div>
    </div>
    <div class="dgm-box" style="left:375px;top:332px;width:250px;height:72px;">
      <div class="t">地域包括支援センター</div><div class="s">行政・制度との連携</div>
    </div>
    <div class="dgm-box" style="left:0;top:154px;width:240px;height:96px;">
      <div class="t">介護・福祉施設</div><div class="s">日々の生活を支援</div>
    </div>
    <div class="dgm-box" style="left:760px;top:154px;width:240px;height:96px;">
      <div class="t">訪問看護・薬局</div><div class="s">在宅療養の継続</div>
    </div>
  </div>
  <!-- フッター -->
</div>
```
<!-- 方向を示す流れ図にしたいときは、箱の間に「→」を text で置く（例）：
     <div style="display:flex;align-items:center;gap:18px;">
       <div class="dgm-box" style="position:relative;width:200px;height:84px;">…</div>
       <div class="arrow" style="font-size:30px;">→</div>
       <div class="dgm-box" style="position:relative;width:200px;height:84px;">…</div>
     </div>
     ※ flex 内に置くなら position:relative に戻し、left/top 指定は外す。 -->

## P13. 結び（ロゴ緑・謝辞＋連絡先カード）

連絡先は**白カード＋濃インク**で可読性を確保（明るいロゴ緑の上に小さな白文字を置かない）。

```html
<div class="h-ppt-page page-brand pad">
  <img src="assets/logo-white.png" style="position:absolute;left:90px;top:72px;width:36px;height:36px;opacity:0.95;">
  <div style="position:absolute;left:90px;top:182px;">
    <div class="eyebrow" style="color:#fff;margin-bottom:22px;">THANK YOU</div>
    <div class="t-section" style="margin-bottom:26px;">ご清聴ありがとう<br>ございました</div>
    <div class="body" style="color:rgba(255,255,255,0.92);max-width:680px;">地域の皆さまが安心して暮らせるよう、これからも医療と暮らしをつないでまいります。</div>
  </div>
  <!-- 連絡先：白カード -->
  <div style="position:absolute;left:90px;right:90px;bottom:54px;background:#fff;border-radius:16px;padding:26px 36px;display:flex;justify-content:space-between;align-items:center;">
    <div>
      <div style="font-size:19px;font-weight:700;color:var(--ink-1);margin-bottom:9px;">医療法人 恵友会　恵友病院</div>
      <div class="meta" style="color:var(--ink-3);">〒642-0001　和歌山県海南市船尾264-2　／　理事長　川嶋 寛昭</div>
    </div>
    <div style="text-align:right;">
      <div style="display:flex;align-items:baseline;gap:10px;justify-content:flex-end;">
        <div class="meta" style="color:var(--ink-4);">TEL</div>
        <div class="num" style="font-size:26px;font-weight:600;color:var(--primary-deep);letter-spacing:0.5px;">073-483-1033</div>
      </div>
      <div class="meta" style="color:var(--ink-4);margin-top:5px;">FAX 073-483-1855　／　www.keiyukai.com</div>
    </div>
  </div>
</div>
```

---

## 場面別の構成例

**学会発表（地域医療・症例研究など）**
P1 表紙 → P3 中扉(背景/目的) → P4 課題 → P5 方法/取り組み → P10 グラフ(結果) →
P11 表(詳細データ) → P9 考察(Before/After) → P12 図解(連携の全体像) → P13 結び

**事例・症例報告**
P1 表紙 → P2 目次 → P6 概要 → P8 経過(時系列) → P9 介入前後 → P7 アウトカム(KPI) → P13 結び

**院内・地域向け説明**
P1 表紙 → P2 目次 → P3 中扉 → P5 取り組み → P12 図解(連携図) → P6 対応内容＋注意 → P7 実績 → P13 結び

> 色面（ロゴ緑 `.page-brand`：中扉 P3／結び P13）は節目だけ。中身は白基調で、
> 1スライド1メッセージ・余白優先を徹底する。深緑は使わない。
