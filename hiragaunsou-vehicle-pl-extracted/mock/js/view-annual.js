/* S8 年間集計・対前年: 推移 → 明細 → 前年比の順。突合の詳細は段階的開示 */
(function () {
  'use strict'
  const C = window.Core
  window.Views = window.Views || {}

  function computed() {
    return C.D.months.map((m) => {
      const t = C.monthTotals(m.rows)
      return { ym: m.ym, label: m.label, ...t,
        costPerKm: t.km ? t.expense / t.km : null,
        salesPerKm: t.km ? t.sales / t.km : null }
    })
  }

  window.Views.annual = function () {
    const rows = computed()
    const total = rows.reduce((a, r) => ({
      sales: a.sales + r.sales, expense: a.expense + r.expense, profit: a.profit + r.profit,
      km: a.km + r.km, tollNet: a.tollNet + r.tollNet, fuelTotal: a.fuelTotal + r.fuelTotal,
      repairTotal: a.repairTotal + r.repairTotal, laborTotal: a.laborTotal + r.laborTotal,
      insTotal: a.insTotal + r.insTotal, taxTotal: a.taxTotal + r.taxTotal,
      transportTotal: a.transportTotal + r.transportTotal, adminTotal: a.adminTotal + r.adminTotal,
    }), { sales: 0, expense: 0, profit: 0, km: 0, tollNet: 0, fuelTotal: 0, repairTotal: 0, laborTotal: 0, insTotal: 0, taxTotal: 0, transportTotal: 0, adminTotal: 0 })

    /* 12ヶ月推移(視覚サマリー) */
    const mMax = Math.max(...rows.map((r) => r.sales), 1)
    const trend = rows.map((r) =>
      C.barRow(`${r.ym.slice(0, 4)}年${r.label}`, r.sales, mMax,
        `${C.man(r.sales)} / 損益${C.man(r.profit)}`,
        r.ym === '2026-05' ? '' : 'gray')).join('')

    /* 明細表 */
    const cols = [
      ['運行費', 'tollNet'], ['燃料費', 'fuelTotal'], ['修繕費', 'repairTotal'], ['人件費', 'laborTotal'],
      ['保険料', 'insTotal'], ['賦課税', 'taxTotal'], ['運送費', 'transportTotal'], ['一般管理費', 'adminTotal'],
    ]
    const body = rows.map((r) => `<tr class="no-hover">
      <td class="sticky-col">${r.ym.slice(0, 4)}年${r.label}</td>
      ${cols.map(([, k]) => `<td class="tnum">${C.yen(r[k])}</td>`).join('')}
      <td class="tnum" style="font-weight:600">${C.yen(r.expense)}</td>
      <td class="tnum" style="font-weight:600">${C.yen(r.sales)}</td>
      <td class="tnum ${r.profit < 0 ? 'neg' : ''}" style="font-weight:600">${C.yen(r.profit)}</td>
      <td class="tnum">${C.num(r.km, 0)}</td>
      <td class="tnum">${C.num(r.costPerKm, 1)}</td>
      <td class="tnum">${C.num(r.salesPerKm, 1)}</td>
    </tr>`).join('')

    const totalRow = `<tr class="total-row no-hover">
      <td class="sticky-col">年間合計</td>
      ${cols.map(([, k]) => `<td class="tnum">${C.yen(total[k])}</td>`).join('')}
      <td class="tnum">${C.yen(total.expense)}</td>
      <td class="tnum">${C.yen(total.sales)}</td>
      <td class="tnum ${total.profit < 0 ? 'neg' : ''}">${C.yen(total.profit)}</td>
      <td class="tnum">${C.num(total.km, 0)}</td>
      <td class="tnum">${C.num(total.expense / total.km, 1)}</td>
      <td class="tnum">${C.num(total.sales / total.km, 1)}</td>
    </tr>`

    /* 対前年 */
    const prev = C.D.annual2024
    const yoyBody = rows.map((r, i) => {
      const p = prev[i]
      if (!p) return ''
      const dSales = p.sales != null ? r.sales - p.sales : null
      const dTotal = p.total != null ? r.expense - p.total : null
      return `<tr class="no-hover">
        <td class="sticky-col">${r.label}</td>
        <td class="tnum">${C.yen(r.sales)}</td><td class="tnum">${C.yen(p.sales)}</td>
        <td class="tnum ${dSales < 0 ? 'neg' : ''}">${C.yen(dSales)}</td>
        <td class="tnum">${C.yen(r.expense)}</td><td class="tnum">${C.yen(p.total)}</td>
        <td class="tnum ${dTotal > 0 ? 'neg' : ''}">${dTotal > 0 ? '+' : ''}${C.yen(dTotal)}</td>
      </tr>`
    }).join('')

    /* 現行Excelとの自動突合 */
    const gaps = []
    rows.forEach((r, i) => {
      const ex = C.D.annual2025Sheet[i]
      if (!ex || !ex.sales) return
      const dExp = Math.round(r.expense - (ex.total || 0))
      const dSales = Math.round(r.sales - (ex.sales || 0))
      if (Math.abs(dExp) > 1000 || Math.abs(dSales) > 1000) {
        gaps.push({ label: r.label, dSales, dExp })
      }
    })

    return `
      <div class="card rise-in">
        <div class="card-head"><h2>売上と損益の12ヶ月推移(2025年6月〜2026年5月)</h2>
          <span class="sub">年間損益 ${C.man(total.profit)} / 売上 ${C.man(total.sales)}</span></div>
        <div class="bar-wide">${trend}</div>
      </div>

      <div class="note-caution rise-in" style="--stagger:40ms;margin-bottom:1.25rem">
        <strong>自動チェック:</strong> 現行Excelの年間集計シートは、月次収支表の合計と${gaps.length + 1}ヶ月分ズレています
        (5月行が0のままの転記漏れを含む)。この画面の数字は月次データから直接計算しているため、転記ズレは起きません。
        <details class="disclosure" style="border-top:0;margin-top:0.2rem;padding-top:0">
          <summary>ズレの内訳を見る</summary>
          <div class="disclosure-body">
            ${gaps.map((g) => `${g.label}: 売上差 ${C.yen(g.dSales)}円・経費差 ${C.yen(g.dExp)}円`).join('<br>')}
            <br>5月: 年間集計シートが0のまま(月次は完成済み)
          </div>
        </details>
      </div>

      <div class="card rise-in" style="--stagger:80ms;padding:1rem">
        <div class="card-head" style="padding:0 0.3rem"><h2>月次の明細(自動集計)</h2></div>
        <div class="table-scroll" style="border-radius:8px">
          <table class="data">
            <thead><tr><th class="sticky-col">月</th>
              ${cols.map(([l]) => `<th>${l}</th>`).join('')}
              <th class="cell-sep">経費計</th><th>売上</th><th>損益</th>
              <th class="cell-sep">走行距離</th><th>1km原価</th><th>1km売上</th></tr></thead>
            <tbody>${body}${totalRow}</tbody>
          </table>
        </div>
      </div>

      <div class="card rise-in" style="--stagger:120ms;padding:1rem">
        <div class="card-head" style="padding:0 0.3rem">
          <h2>対前年(2024年度実績との比較)</h2>
          <span class="sub">経費の増加(+)を赤で表示</span>
        </div>
        <div class="table-scroll" style="border-radius:8px">
          <table class="data">
            <thead><tr><th class="sticky-col">月</th>
              <th>売上(今年度)</th><th>売上(前年)</th><th>差</th>
              <th class="cell-sep">経費(今年度)</th><th>経費(前年)</th><th>差</th></tr></thead>
            <tbody>${yoyBody}</tbody>
          </table>
        </div>
      </div>`
  }
})()
