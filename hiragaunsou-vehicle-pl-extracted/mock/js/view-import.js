/* データ登録(毎日つかう画面):
   ① デジタコのデータを都度追加(基軸) → 行と自動列が埋まる
   ② 足りない数字(黄色セル)を入れる → 右端の損益まで連鎖してその場で決まる */
(function () {
  'use strict'
  const C = window.Core
  window.Views = window.Views || {}

  const INPUT_COLS = [
    ['fuelIn', '軽油代(インタンク)'], ['fuelInQty', '給油量(内)'],
    ['fuelOut', '軽油代(外部)'], ['fuelOutQty', '給油量(外)'],
    ['salary', '給与'], ['repair', '修理費(実費)'],
  ]
  // 金額系の入力 → 連鎖して再計算される列
  const COST_FIELDS = { fuelIn: 'fuel', fuelOut: 'fuel', salary: 'labor', repair: 'repairT' }

  // 5月に実際に未入力だったセルをそのまま再現
  const MISSING = [
    { no: '58', field: 'fuelOut' }, { no: '58', field: 'fuelOutQty' },
    { no: '17', field: 'salary' }, { no: '205', field: 'salary' },
    { no: '500', field: 'salary' }, { no: '1300', field: 'salary' }, { no: '5555', field: 'salary' },
  ]
  const missingKey = (no, field) => `${no}|${field}`
  const isMissingCell = (no, field) => MISSING.some((m) => m.no === no && m.field === field)

  function missingCount() {
    return MISSING.filter((m) => !String(C.state.regValues[missingKey(m.no, m.field)] ?? '').trim()).length
  }
  window.Views.regMissingCount = missingCount

  /* 入力済みの値を織り込んだ連鎖計算(モックでも本物の足し算) */
  function chained(r) {
    const no = r[C.F.no]
    const delta = { fuel: 0, labor: 0, repairT: 0 }
    MISSING.filter((m) => m.no === no).forEach((m) => {
      const kind = COST_FIELDS[m.field]
      if (!kind) return
      const v = Number(String(C.state.regValues[missingKey(no, m.field)] ?? '').replace(/,/g, '')) || 0
      delta[kind] += v
    })
    const totalDelta = delta.fuel + delta.labor + delta.repairT
    return {
      fuel: C.numval(r, 'fuelTotal') + delta.fuel,
      labor: C.numval(r, 'laborTotal') + delta.labor,
      profit: C.numval(r, 'profit') - totalDelta,
    }
  }

  window.Views.import = function () {
    const m = C.month('2026-05')
    const remaining = missingCount()
    const showAll = C.state.regShowAll
    const missingNos = new Set(MISSING.map((x) => x.no))
    const rows = showAll ? m.rows : m.rows.filter((r) => missingNos.has(r[C.F.no]))

    /* ① 基軸データ: デジタコを都度追加 */
    const uploader = `
      <div class="card rise-in" style="padding:1rem 1.3rem">
        <div style="display:flex;gap:1.5rem;align-items:center;flex-wrap:wrap">
          <div style="flex:1;min-width:16rem">
            <div style="font-weight:700;font-size:0.92rem;margin-bottom:0.2rem">1. デジタコのデータを追加する(毎日・都度)</div>
            <div class="xs muted">追加した分だけ、下の表の稼働Km・売上・道路使用料などが自動で埋まっていきます。</div>
            <div id="upload-feed" class="xs muted" style="margin-top:0.4rem">昨日までの分は取込済み(累計 101台・22日分)</div>
          </div>
          <div class="dropzone" id="tacho-drop" style="flex:1;min-width:18rem;padding:1.2rem 1rem">
            今日の分をここにドラッグ&ドロップ<br>
            <span class="xs">(クリックでも追加できます — モックのため実ファイルは不要)</span>
          </div>
        </div>
      </div>`

    /* ② 穴埋め: 残数と表 */
    const summary = remaining === 0
      ? `<div class="reg-summary rise-in" style="--stagger:40ms;border-color:var(--brand)">
          <span class="big">今日の入力は完了です</span>
          <span class="small muted">101台 × 全項目が揃っています。</span>
          <span style="flex:1"></span>
          <button class="btn btn-cta" data-go="anomaly">異常値チェックへ進む</button>
        </div>`
      : `<div class="reg-summary rise-in" style="--stagger:40ms">
          <span style="font-weight:700;font-size:0.92rem">2. 足りない数字を入れる</span>
          <span class="big">残り <span class="accent tnum">${remaining}</span> セル</span>
          <span class="small muted">入れた瞬間、右端の損益まで自動で計算されます(Enterで次のセルへ)</span>
          <span style="flex:1"></span>
          <button class="btn btn-cta" id="jump-missing">次の未入力セルへ</button>
        </div>`

    const headCells =
      `<th class="sticky-col">車番</th>` +
      `<th>運転者<span class="th-badge auto">自動</span></th>` +
      `<th>稼働Km<span class="th-badge auto">自動</span></th>` +
      `<th>売上<span class="th-badge auto">自動</span></th>` +
      INPUT_COLS.map(([, label], i) => `<th class="${i === 0 ? 'cell-sep' : ''}" style="background:var(--caution-soft)">${label}<span class="th-badge input">入力</span></th>`).join('') +
      `<th class="cell-sep">燃料費計<span class="th-badge auto">自動</span></th>` +
      `<th>人件費計<span class="th-badge auto">自動</span></th>` +
      `<th>損益<span class="th-badge auto">自動</span></th>`

    const body = rows.map((r) => {
      const no = r[C.F.no]
      const ch = chained(r)
      const inputTds = INPUT_COLS.map(([k], i) => {
        const key = missingKey(no, k)
        const isMissing = isMissingCell(no, k)
        const entered = C.state.regValues[key]
        const value = isMissing ? (entered ?? '') : C.num(C.numval(r, k), 0)
        const stillMissing = isMissing && !String(entered ?? '').trim()
        return `<td class="${i === 0 ? 'cell-sep' : ''}" style="padding:0.15rem 0.3rem">
          <input class="cell-input ${stillMissing ? 'missing' : ''}" inputmode="numeric"
            data-cell="${C.esc(key)}" data-no="${C.esc(no)}" ${isMissing ? 'data-required="1"' : ''}
            value="${C.esc(String(value))}" ${stillMissing ? 'placeholder="要入力"' : ''}>
        </td>`
      }).join('')
      return `<tr class="no-hover" data-reg-row="${C.esc(no)}">
        <td class="sticky-col">${C.esc(no)}</td>
        <td class="auto-cell text">${C.esc(C.val(r, 'driver') || '—')}</td>
        <td class="auto-cell tnum">${C.num(C.numval(r, 'km'), 0)}</td>
        <td class="auto-cell tnum">${C.yen(C.numval(r, 'sales'))}</td>
        ${inputTds}
        <td class="cell-sep tnum" data-comp="fuel" data-no="${C.esc(no)}">${C.yen(ch.fuel)}</td>
        <td class="tnum" data-comp="labor" data-no="${C.esc(no)}">${C.yen(ch.labor)}</td>
        <td class="tnum ${ch.profit < 0 ? 'neg' : ''}" data-comp="profit" data-no="${C.esc(no)}" style="font-weight:600">${C.yen(ch.profit)}</td>
      </tr>`
    }).join('')

    return `
      ${uploader}
      ${summary}

      <div class="card rise-in" style="--stagger:60ms;padding:0.7rem 1.2rem;display:flex;gap:1rem;align-items:center;flex-wrap:wrap">
        <div class="seg-control" id="reg-filter">
          <button data-all="0" class="${showAll ? '' : 'active'}">未入力がある行だけ(${missingNos.size}行)</button>
          <button data-all="1" class="${showAll ? 'active' : ''}">全${m.rows.length}行</button>
        </div>
        <span style="flex:1"></span>
        <span class="xs muted">セルは直接書き換えられます(モックのため保存はされません)</span>
      </div>

      <div class="table-scroll rise-in" style="--stagger:80ms;max-height:calc(100vh - 26rem)">
        <table class="data">
          <thead><tr>${headCells}</tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>

      <details class="disclosure rise-in" style="--stagger:100ms">
        <summary>月に1回だけのもの(今月は完了)</summary>
        <div class="disclosure-body">
          <div class="source-row"><span>燃料集計ファイルの取込</span><span class="xs muted">取込済み</span></div>
          <div class="source-row"><span>給与データの取込(賞与・福利厚生は自動計算)</span><span class="xs muted">取込済み</span></div>
          <div class="source-row"><span>インタンク軽油単価 → 全車へ一括反映</span><span class="xs muted">120.21円/ℓ 入力済み</span></div>
          <div class="source-row"><span>車番リストの貼り付けで行を作り直す(増減車の月のみ)</span><span class="xs muted">前月の101台を引き継ぎ中</span></div>
        </div>
      </details>`
  }

  /* ---------- 入力 → 連鎖計算をその場で反映 ---------- */

  function updateRow(root, no) {
    const m = C.month('2026-05')
    const r = m.rows.find((x) => x[C.F.no] === no)
    if (!r) return
    const ch = chained(r)
    const vals = { fuel: C.yen(ch.fuel), labor: C.yen(ch.labor), profit: C.yen(ch.profit) }
    root.querySelectorAll(`td[data-no="${CSS.escape(no)}"]`).forEach((td) => {
      const v = vals[td.dataset.comp]
      if (v === undefined || td.textContent === v) return
      td.textContent = v
      if (td.dataset.comp === 'profit') td.classList.toggle('neg', ch.profit < 0)
      td.classList.remove('flash')
      void td.offsetWidth
      td.classList.add('flash')
    })
  }

  function updateCounters(root) {
    const remaining = missingCount()
    const navEl = document.getElementById('nav-reg-count')
    navEl.textContent = remaining > 0 ? String(remaining) : ''
    navEl.style.display = remaining > 0 ? '' : 'none'
    const summaryBig = root.querySelector('.reg-summary .big')
    if (summaryBig && remaining > 0) {
      summaryBig.innerHTML = `残り <span class="accent tnum">${remaining}</span> セル`
    }
    if (remaining === 0) window.App.render({ keepScroll: true })
  }

  function focusNextMissing(root) {
    const next = root.querySelector('input.cell-input.missing')
    if (next) {
      next.scrollIntoView({ block: 'center' })
      next.focus()
    }
  }

  const prevAfter = window.Views.afterRender
  window.Views.afterRender = function (view, root) {
    if (prevAfter) prevAfter(view, root)
    if (view !== 'import') return

    root.querySelector('#jump-missing')?.addEventListener('click', () => focusNextMissing(root))

    root.querySelectorAll('#reg-filter button').forEach((b) =>
      b.addEventListener('click', () => {
        C.state.regShowAll = b.dataset.all === '1'
        window.App.render({ keepScroll: true })
      }))

    root.querySelectorAll('input.cell-input').forEach((input) => {
      input.addEventListener('input', () => {
        if (!input.dataset.required) return
        C.state.regValues = { ...C.state.regValues, [input.dataset.cell]: input.value }
        input.classList.toggle('missing', !input.value.trim())
        updateRow(root, input.dataset.no)
        if (input.value.trim()) updateCounters(root)
      })
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); focusNextMissing(root) }
      })
    })

    const drop = root.querySelector('#tacho-drop')
    const feed = root.querySelector('#upload-feed')
    const simulate = () => {
      feed.innerHTML = `<strong style="color:var(--brand-deep)">今日(5月23日)の運行データ 101台分を追加しました(モック)</strong> — 稼働Km・売上・道路使用料が更新されました<br>` + feed.innerHTML
      drop.textContent = '追加済み — 明日もここに放り込むだけです'
    }
    drop?.addEventListener('click', simulate)
    drop?.addEventListener('dragover', (e) => e.preventDefault())
    drop?.addEventListener('drop', (e) => { e.preventDefault(); simulate() })
  }
})()
