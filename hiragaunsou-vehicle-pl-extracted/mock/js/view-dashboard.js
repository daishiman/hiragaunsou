/* S7 経営ダッシュボード: 1画面1目的 — 「今月はどうだったか」を4つの数字と2つの構造だけで */
(function () {
  'use strict'
  const C = window.Core
  window.Views = window.Views || {}

  window.Views.dashboard = function () {
    const m = C.month()
    const t = C.monthTotals(m.rows)
    const margin = t.sales ? t.profit / t.sales : null
    const costPerKm = t.km ? t.expense / t.km : null
    const salesPerKm = t.km ? t.sales / t.km : null

    /* km単価の分布(稼働車のみ) */
    const buckets = [
      { label: '130円未満', min: 0, max: 130 },
      { label: '130〜150円', min: 130, max: 150 },
      { label: '150〜170円', min: 150, max: 170 },
      { label: '170〜190円', min: 170, max: 190 },
      { label: '190〜210円', min: 190, max: 210 },
      { label: '210円以上', min: 210, max: Infinity },
    ].map((b) => ({ ...b, count: 0, deficit: 0 }))
    m.rows.forEach((r) => {
      const p = C.kmPrice(r)
      if (p === null) return
      const b = buckets.find((x) => p >= x.min && p < x.max)
      if (b) { b.count++; if (C.numval(r, 'profit') < 0) b.deficit++ }
    })
    const bMax = Math.max(...buckets.map((b) => b.count), 1)
    const kmBars = buckets.map((b, i) => {
      const below = b.max <= C.DEFICIT_RULES.breakEvenKmPrice
      return C.barRow(
        b.label, b.count, bMax,
        `${b.count}台(赤字${b.deficit})`,
        below ? 'danger' : '')
        .replace('class="bar-row"', `class="bar-row" style="${i === 3 ? 'border-top:2px solid var(--ink);padding-top:0.45rem' : ''}"`)
    }).join('')

    /* 構造バー: 黒字車 vs 赤字車 */
    const structMax = Math.max(t.profitPos, Math.abs(t.profitNeg), 1)
    const struct = [
      C.barRow('黒字車の利益合計', t.profitPos, structMax, C.man(t.profitPos), ''),
      C.barRow('赤字車の損失合計', t.profitNeg, structMax, C.man(t.profitNeg), 'danger'),
      C.barRow('全社損益(相殺後)', t.profit, structMax, C.man(t.profit), t.profit < 0 ? 'danger' : 'gray'),
    ].join('')

    return `
      ${C.monthTabs()}
      <div class="kpi-strip rise-in">
        <div class="kpi"><div class="label">売上(${m.ym.slice(0, 4)}年${m.label}・${t.cars}台)</div>
          <div class="value tnum">${C.man(t.sales)}</div></div>
        <div class="kpi"><div class="label">全社損益</div>
          <div class="value tnum ${t.profit < 0 ? 'negative' : 'accent'}">${C.man(t.profit)}</div>
          <div class="note">利益率 ${C.pct(margin, 2)}</div></div>
        <div class="kpi"><div class="label">赤字車両</div>
          <div class="value tnum">${t.deficitCars}<span class="small muted">台 / ${t.cars}台</span></div>
          <div class="note"><a href="#" data-go="deficit">理由を見る</a></div></div>
        <div class="kpi"><div class="label">1kmあたり 原価 / 売上</div>
          <div class="value tnum">${C.num(costPerKm, 1)}<span class="small muted"> / </span>${C.num(salesPerKm, 1)}<span class="small muted">円</span></div>
          <div class="note">損益分岐の目安 ${C.DEFICIT_RULES.breakEvenKmPrice}円/km</div></div>
      </div>

      <div class="grid-2">
        <div class="card rise-in" style="--stagger:40ms">
          <div class="card-head"><h2>利益の構造</h2>
            <span class="sub">黒字車の稼ぎを赤字車が相殺している</span></div>
          ${struct}
          <p class="small muted" style="margin:0.8rem 0 0">
            赤字${t.deficitCars}台への手当てが、そのまま利益改善の余地(最大${C.man(Math.abs(t.profitNeg))})です。
            <a href="#" data-go="deficit">赤字の理由(3分類)へ</a></p>
        </div>

        <div class="card rise-in" style="--stagger:80ms">
          <div class="card-head"><h2>km単価の分布(稼働車)</h2>
            <span class="sub">太線 = 損益分岐${C.DEFICIT_RULES.breakEvenKmPrice}円ライン</span></div>
          ${kmBars}
          <p class="small muted" style="margin:0.8rem 0 0">
            ${C.DEFICIT_RULES.breakEvenKmPrice}円/kmを下回る仕事は構造的に赤字になります。単価交渉・配車見直しの対象です。</p>
        </div>
      </div>

      <p class="small muted rise-in" style="--stagger:120ms">
        月ごとの推移と前年比較は <a href="#" data-go="annual">年間集計・対前年</a> にあります。</p>`
  }
})()
