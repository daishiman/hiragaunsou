/* ホーム: 今月の3ステップをタイルで。1タイル=1アクション、押せば次の画面へ */
(function () {
  'use strict'
  const C = window.Core
  window.Views = window.Views || {}

  window.Views.home = function () {
    const m = C.month('2026-05')
    const t = C.monthTotals(m.rows)
    const regRemaining = window.Views.regMissingCount ? window.Views.regMissingCount() : 0
    const checkRemaining = C.D.anomalies.filter((a) => !C.state.resolved[a.no + a.item]).length

    const regTile = regRemaining > 0
      ? `<div class="tile rise-in" data-go="import">
          <div class="tile-step">STEP 1 — データ登録(毎日)</div>
          <div class="tile-value accent tnum">残り${regRemaining}セル</div>
          <div class="tile-note">デジタコを都度追加し、黄色いセルを埋めるだけ。損益まで自動計算されます。</div>
          <div class="tile-cta">登録を続ける →</div>
        </div>`
      : `<div class="tile rise-in" data-go="import">
          <div class="tile-step">STEP 1 — データ登録</div>
          <div class="tile-value quiet">完了</div>
          <div class="tile-note">101台 × 全項目が揃っています。</div>
          <div class="tile-cta">登録内容を見る →</div>
        </div>`

    const checkTile = checkRemaining > 0
      ? `<div class="tile rise-in" style="--stagger:60ms" data-go="anomaly">
          <div class="tile-step">STEP 2 — 異常値チェック</div>
          <div class="tile-value tnum">${checkRemaining}件</div>
          <div class="tile-note">いつもの月と大きく違う値が見つかっています。入力ミスか実績かを判定してください。</div>
          <div class="tile-cta">チェックする →</div>
        </div>`
      : `<div class="tile rise-in" style="--stagger:60ms" data-go="anomaly">
          <div class="tile-step">STEP 2 — 異常値チェック</div>
          <div class="tile-value quiet">完了</div>
          <div class="tile-note">すべて判定済みです。締め確定に進めます。</div>
          <div class="tile-cta">判定内容を見る →</div>
        </div>`

    const resultTile = `<div class="tile rise-in" style="--stagger:120ms" data-go="dashboard">
        <div class="tile-step">STEP 3 — 結果を見る</div>
        <div class="tile-value tnum ${t.profit < 0 ? 'negative' : ''}">${C.man(t.profit)}</div>
        <div class="tile-note">5月の全社損益(速報)。売上 ${C.man(t.sales)}・赤字車両 ${t.deficitCars}台。</div>
        <div class="tile-cta">ダッシュボードへ →</div>
      </div>`

    return `
      <div class="page-head rise-in">
        <div class="page-kind ops">毎月の運用</div>
        <h1>2026年5月度の締め</h1>
        <p class="page-lead">上から順に進めれば締めが終わります。いま必要な操作は色の付いた数字のタイルです。</p>
      </div>
      <div class="grid-3">
        ${regTile}
        ${checkTile}
        ${resultTile}
      </div>
      <p class="xs muted rise-in" style="--stagger:160ms;margin-top:1.2rem">
        1と2が終わると締め確定ができます(モックでは動作しません)。</p>`
  }
})()
