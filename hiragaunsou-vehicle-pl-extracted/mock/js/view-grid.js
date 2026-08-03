/* S2 月次収支グリッド: デフォルトは要約15列(認知負荷優先)。Excel互換の全列はトグルで開示 */
(function () {
  'use strict'
  const C = window.Core
  window.Views = window.Views || {}

  const GROUPS_FULL = [
    { label: '車両情報', cols: ['no', 'type', 'depot', 'reg', 'driver'] },
    { label: '稼働', cols: ['trips', 'slips', 'hours', 'km'] },
    { label: '売上', cols: ['fare', 'fee', 'sales'] },
    { label: '運行費', cols: ['toll', 'tollDisc', 'tollNet'] },
    { label: '燃料費', cols: ['fuelIn', 'fuelInQty', 'fuelOut', 'fuelOutQty', 'fuelQty', 'nempi', 'fuelTotal'] },
    { label: '修繕費', cols: ['repair', 'tire', 'equip', 'mainte', 'repairTotal'] },
    { label: '人件費', cols: ['salary', 'bonus', 'welfare', 'laborTotal'] },
    { label: '保険料', cols: ['insCompulsory', 'insVoluntary', 'insTotal'] },
    { label: '賦課税', cols: ['taxAuto', 'taxWeight', 'taxTotal'] },
    { label: '運送費', cols: ['lease', 'installment', 'transportTotal'] },
    { label: '管理費', cols: ['adminFee'] },
    { label: '合計', cols: ['fixed', 'variable', 'expense'] },
    { label: '指標', cols: ['profit', 'margin', '_kmPrice'] },
  ]

  const GROUPS_SUMMARY = [
    { label: '車両情報', cols: ['no', 'type', 'depot', 'driver'] },
    { label: '稼働', cols: ['trips', 'km'] },
    { label: '売上', cols: ['sales'] },
    { label: '主な経費(計)', cols: ['tollNet', 'fuelTotal', 'repairTotal', 'laborTotal'] },
    { label: '合計', cols: ['expense'] },
    { label: '指標', cols: ['profit', 'margin', '_kmPrice'] },
  ]

  // 要約表示で、詳細列の疑義をどの列に代表させるか
  const PARENT = {
    fuelIn: 'fuelTotal', fuelInQty: 'fuelTotal', fuelOut: 'fuelTotal', fuelOutQty: 'fuelTotal', fuelQty: 'fuelTotal',
    repair: 'repairTotal', tire: 'repairTotal',
    salary: 'laborTotal', bonus: 'laborTotal', welfare: 'laborTotal',
    toll: 'tollNet', tollDisc: 'tollNet',
    slips: 'km', hours: 'km',
  }

  const LABELS = {
    no: '車番', type: '車種', depot: '所属', reg: '初年度', driver: '運転者',
    trips: '運行回数', slips: '伝票件数', hours: '稼働時間', km: '稼働Km',
    fare: '運賃', fee: '附帯料金', sales: '運送収入',
    toll: '道路使用料', tollDisc: '高速割引', tollNet: '運行費',
    fuelIn: '軽油(インタンク)', fuelInQty: '給油量(内)', fuelOut: '軽油(外部)', fuelOutQty: '給油量(外)',
    fuelQty: '給油量計', nempi: '燃費', fuelTotal: '燃料費',
    repair: '修理費(実費)', tire: 'タイヤ費', equip: '備品費', mainte: 'メンテ委託', repairTotal: '修繕費',
    salary: '給与', bonus: '賞与', welfare: '福利厚生', laborTotal: '人件費',
    insCompulsory: '自賠責', insVoluntary: '任意保険', insTotal: '保険料計',
    taxAuto: '自動車税', taxWeight: '重量税', taxTotal: '賦課税計',
    lease: 'リース', installment: '割賦', transportTotal: '運送費計',
    adminFee: '一般管理費',
    fixed: '固定費', variable: '変動費', expense: '経費計',
    profit: '損益', margin: '利益率', _kmPrice: 'km単価',
  }

  const QTY_COLS = ['km', 'hours', 'trips', 'slips', 'fuelInQty', 'fuelOutQty', 'fuelQty']

  function fmt(key, row) {
    if (key === '_kmPrice') {
      const p = C.kmPrice(row)
      return p === null ? '—' : C.num(p, 0)
    }
    const v = C.val(row, key)
    if (v === null || v === undefined || v === '') return '—'
    switch (key) {
      case 'no': case 'type': case 'depot': case 'reg': case 'driver': return C.esc(v)
      case 'hours': case 'km': case 'trips': case 'slips': return C.num(v, 0)
      case 'nempi': return C.num(v, 2)
      case 'margin': return C.pct(v, 1)
      case 'fuelInQty': case 'fuelOutQty': case 'fuelQty': return C.num(v, 0)
      default: return C.yen(v)
    }
  }

  window.Views.grid = function () {
    const m = C.month()
    const f = C.state.filters
    const summary = C.state.gridMode !== 'full'
    const GROUPS = summary ? GROUPS_SUMMARY : GROUPS_FULL
    const rawAnomalyMap = C.state.ym === '2026-05' ? C.anomalyCellMap() : {}

    // 要約表示では詳細列の疑義を代表列(◯◯計)に写像する
    const anomalyMap = {}
    Object.entries(rawAnomalyMap).forEach(([no, fields]) => {
      anomalyMap[no] = {}
      Object.entries(fields).forEach(([field, a]) => {
        const key = summary ? (PARENT[field] || field) : field
        anomalyMap[no][key] = a
      })
    })

    const depots = [...new Set(m.rows.map((r) => C.val(r, 'depot')).filter(Boolean))]
    const types = [...new Set(m.rows.map((r) => C.val(r, 'type')).filter(Boolean))]

    let rows = m.rows
    if (f.depot) rows = rows.filter((r) => C.val(r, 'depot') === f.depot)
    if (f.vtype) rows = rows.filter((r) => C.val(r, 'type') === f.vtype)
    if (f.deficitOnly) rows = rows.filter((r) => C.numval(r, 'profit') < 0)

    const firstGroupCols = GROUPS[0].cols.length
    const groupRow = `<th class="sticky-col" style="z-index:20"></th>` +
      GROUPS.map((g, gi) =>
        `<th class="group" colspan="${gi === 0 ? g.cols.length - 1 : g.cols.length}">${g.label}</th>`).join('')
    const headRow = GROUPS.flatMap((g) => g.cols.map((k, i) =>
      `<th class="${i === 0 ? 'cell-sep' : ''} ${k === 'no' ? 'sticky-col' : ''}">${LABELS[k]}</th>`)).join('')

    const body = rows.map((r) => {
      const no = r[C.F.no]
      const cellAnoms = anomalyMap[no] || {}
      const tds = GROUPS.flatMap((g) => g.cols.map((k, i) => {
        const a = cellAnoms[k]
        const neg = (k === 'profit' || k === 'margin') && C.numval(r, k) < 0
        const kmp = k === '_kmPrice' ? C.kmPrice(r) : null
        const under = k === '_kmPrice' && kmp !== null && kmp < C.DEFICIT_RULES.breakEvenKmPrice
        const cls = [
          i === 0 ? 'cell-sep' : '',
          k === 'no' ? 'sticky-col' : '',
          ['type', 'depot', 'reg', 'driver'].includes(k) ? 'text' : '',
          neg || under ? 'neg' : '',
          a ? 'anomaly' : '',
        ].filter(Boolean).join(' ')
        const title = a ? `要確認: ${a.reason} / 例月目安: ${a.guide}` : ''
        return `<td class="${cls} tnum" ${title ? `title="${C.esc(title)}"` : ''}>${fmt(k, r)}</td>`
      })).join('')
      return `<tr data-vehicle="${C.esc(no)}">${tds}</tr>`
    }).join('')

    const totalSales = C.sum(rows, 'sales')
    const totalProfit = C.sum(rows, 'profit')
    const totalTds = GROUPS.flatMap((g) => g.cols.map((k, i) => {
      let v = '—'
      if (k === 'no') v = `合計 ${rows.length}台`
      else if (k === 'margin') v = totalSales ? C.pct(totalProfit / totalSales, 2) : '—'
      else if (k === '_kmPrice') {
        const km = C.sum(rows, 'km')
        v = km ? C.num(totalSales / km, 0) : '—'
      } else if (!['type', 'depot', 'reg', 'driver', 'nempi'].includes(k)) {
        const s = C.sum(rows, k)
        v = QTY_COLS.includes(k) ? C.num(s, 0) : C.yen(s)
      }
      const neg = k === 'profit' && totalProfit < 0
      return `<td class="${i === 0 ? 'cell-sep' : ''} ${k === 'no' ? 'sticky-col' : ''} tnum ${neg ? 'neg' : ''}">${v}</td>`
    })).join('')

    const anomalyNote = C.state.ym === '2026-05'
      ? '<span class="badge badge-caution">黄色セル = 要確認(マウスで例月目安)</span>'
      : ''

    return `
      ${C.monthTabs()}
      <div class="card rise-in" style="padding:0.8rem 1.2rem;display:flex;gap:1rem;align-items:center;flex-wrap:wrap">
        <div class="seg-control" id="grid-mode">
          <button data-mode="summary" class="${summary ? 'active' : ''}">要約</button>
          <button data-mode="full" class="${summary ? '' : 'active'}">Excel互換(全51列)</button>
        </div>
        <label class="xs muted">所属
          <select id="flt-depot">
            <option value="">すべて</option>
            ${depots.map((d) => `<option ${f.depot === d ? 'selected' : ''}>${C.esc(d)}</option>`).join('')}
          </select></label>
        <label class="xs muted">車種
          <select id="flt-type">
            <option value="">すべて</option>
            ${types.map((d) => `<option ${f.vtype === d ? 'selected' : ''}>${C.esc(d)}</option>`).join('')}
          </select></label>
        <label class="xs muted" style="display:inline-flex;align-items:center;gap:0.3rem">
          <input type="checkbox" id="flt-deficit" ${f.deficitOnly ? 'checked' : ''}>赤字のみ</label>
        <span style="flex:1"></span>
        ${anomalyNote}
      </div>
      <div class="table-scroll rise-in" style="--stagger:60ms;max-height:calc(100vh - 21rem)">
        <table class="data">
          <thead><tr>${groupRow}</tr><tr>${headRow}</tr></thead>
          <tbody>${body}<tr class="total-row">${totalTds}</tr></tbody>
        </table>
      </div>
      <p class="xs muted" style="margin-top:0.5rem">行をクリックすると、その車両の12ヶ月推移と経費内訳が開きます。</p>`
  }

  /* ---------- S3 車両ドリルダウン ---------- */

  function vehicleModal(no) {
    const hist = C.vehicleHistory(no)
    const cur = hist.find((h) => h.ym === C.state.ym)?.row || hist.filter((h) => h.row).at(-1).row
    const withRow = hist.filter((h) => h.row)
    const repairs = withRow.map((h) => C.numval(h.row, 'repair'))
    const avgRepair = repairs.length ? repairs.reduce((a, b) => a + b, 0) / repairs.length : 0
    const maxAbs = Math.max(...withRow.map((h) => Math.abs(C.numval(h.row, 'profit'))), 1)

    const histRows = hist.map((h) => {
      if (!h.row) return `<tr class="no-hover"><td>${h.ym.slice(0, 4)}年${h.label}</td><td colspan="7" class="muted">在籍なし</td></tr>`
      const r = h.row
      const p = C.numval(r, 'profit')
      const kmp = C.kmPrice(r)
      const w = Math.max(1, Math.round((Math.abs(p) / maxAbs) * 100))
      const isCur = h.ym === C.state.ym
      return `<tr class="no-hover" ${isCur ? 'style="background:var(--brand-soft)"' : ''}>
        <td>${h.ym.slice(0, 4)}年${h.label}${isCur ? ' <span class="badge badge-brand">表示中</span>' : ''}</td>
        <td class="tnum">${C.yen(C.numval(r, 'sales'))}</td>
        <td class="tnum">${C.yen(C.numval(r, 'expense'))}</td>
        <td class="tnum ${p < 0 ? 'neg' : ''}">${C.yen(p)}</td>
        <td style="width:9rem"><div class="bar-track"><div class="bar-fill ${p < 0 ? 'danger' : ''}" style="width:${w}%"></div></div></td>
        <td class="tnum">${C.num(C.numval(r, 'km'), 0)}</td>
        <td class="tnum ${kmp !== null && kmp < C.DEFICIT_RULES.breakEvenKmPrice ? 'neg' : ''}">${kmp === null ? '—' : C.num(kmp, 0)}</td>
        <td class="tnum">${C.yen(C.numval(r, 'repair'))}</td>
      </tr>`
    }).join('')

    const cost = [
      ['運行費', 'tollNet'], ['燃料費', 'fuelTotal'], ['修繕費', 'repairTotal'], ['人件費', 'laborTotal'],
      ['保険料', 'insTotal'], ['賦課税', 'taxTotal'], ['運送費(リース等)', 'transportTotal'], ['一般管理費', 'adminTotal'],
    ].map(([label, k]) => ({ label, v: C.numval(cur, k) }))
    const costMax = Math.max(...cost.map((c) => c.v), 1)
    const costBars = cost.map((c) => C.barRow(c.label, c.v, costMax, C.yen(c.v), 'gray')).join('')

    const curProfit = C.numval(cur, 'profit')
    const adjProfit = curProfit + C.numval(cur, 'repair') - avgRepair

    return `<div class="modal-back" id="modal-back"><div class="modal rise-in">
      <div class="modal-head">
        <h2>車番 ${C.esc(no)} — ${C.esc(C.val(cur, 'type'))} / ${C.esc(C.val(cur, 'depot'))} / ${C.esc(C.val(cur, 'driver') || '運転者未設定')}</h2>
        <button class="btn btn-quiet" id="modal-close">閉じる</button>
      </div>
      <div class="grid-2">
        <div>
          <h2 style="font-size:0.8rem;margin:0 0 0.5rem">当月(${C.month().label})の経費内訳 — 売上 ${C.yen(C.numval(cur, 'sales'))}円</h2>
          ${costBars}
          <div class="note-info" style="margin-top:0.6rem">
            当月損益 <strong class="tnum ${curProfit < 0 ? 'neg' : ''}" style="${curProfit < 0 ? '' : 'color:var(--accent)'}">${C.yen(curProfit)}円</strong>
            ／ 実力損益(実費修理を12ヶ月平均 ${C.yen(avgRepair)}円 に均した場合)
            <strong class="tnum">${C.yen(adjProfit)}円</strong>
            <span class="xs muted">— 突発修繕の単月一括計上を按分して見る試算(仕様は要合意)</span>
          </div>
        </div>
        <div>
          <h2 style="font-size:0.8rem;margin:0 0 0.5rem">12ヶ月の推移</h2>
          <div class="table-scroll" style="border-radius:8px">
            <table class="data">
              <thead><tr><th>月</th><th>売上</th><th>経費</th><th>損益</th><th>損益バー</th><th>稼働Km</th><th>km単価</th><th>修理費実費</th></tr></thead>
              <tbody>${histRows}</tbody>
            </table>
          </div>
        </div>
      </div>
    </div></div>`
  }

  const prevAfter = window.Views.afterRender
  window.Views.afterRender = function (view, root) {
    if (prevAfter) prevAfter(view, root)
    if (view !== 'grid') return
    const f = C.state.filters
    root.querySelectorAll('#grid-mode button').forEach((b) =>
      b.addEventListener('click', () => {
        C.state.gridMode = b.dataset.mode
        window.App.render()
      }))
    root.querySelector('#flt-depot')?.addEventListener('change', (e) => {
      C.state.filters = { ...f, depot: e.target.value }; window.App.render()
    })
    root.querySelector('#flt-type')?.addEventListener('change', (e) => {
      C.state.filters = { ...f, vtype: e.target.value }; window.App.render()
    })
    root.querySelector('#flt-deficit')?.addEventListener('change', (e) => {
      C.state.filters = { ...f, deficitOnly: e.target.checked }; window.App.render()
    })
    root.querySelectorAll('tr[data-vehicle]').forEach((tr) => {
      tr.addEventListener('click', () => openModal(tr.dataset.vehicle))
    })
  }

  function openModal(no) {
    const rootEl = document.getElementById('modal-root')
    rootEl.innerHTML = vehicleModal(no)
    const close = () => { rootEl.innerHTML = '' }
    rootEl.querySelector('#modal-close').addEventListener('click', close)
    rootEl.querySelector('#modal-back').addEventListener('click', (e) => {
      if (e.target.id === 'modal-back') close()
    })
    document.addEventListener('keydown', function esc(e) {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc) }
    })
  }

  window.GridView = { openModal }
})()
