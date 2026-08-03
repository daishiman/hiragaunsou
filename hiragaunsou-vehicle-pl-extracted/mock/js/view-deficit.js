/* S6 赤字3分類: 各分類はワースト5だけ見せ、残りは段階的開示 */
(function () {
  'use strict'
  const C = window.Core
  window.Views = window.Views || {}

  const TOP_N = 5

  const META = {
    repair: {
      title: '突発修繕型',
      desc: '実費修理がその月に一括計上されて赤字化。単月では「経営課題」と誤読しやすい。',
      action: '実力損益(12ヶ月按分)で再評価し、実費の内容(車検・事故・老朽)を確認する。',
    },
    price: {
      title: '単価・効率型',
      desc: `稼働しているのに赤字。km単価${C.DEFICIT_RULES.breakEvenKmPrice}円未満の仕事は構造的に赤字。`,
      action: '主要荷主・運行ルートの単価見直し、または配車の組み替えを検討する。',
    },
    idle: {
      title: '遊休・低稼働型',
      desc: '売上がほぼ立たず、保険・税・リースなどの固定費だけが出ていく。',
      action: '予備車として必要か、売却・リース解約かを1台ごとに判断する。',
    },
  }

  function row(r, extra) {
    const no = r[C.F.no]
    return `<tr data-vehicle="${C.esc(no)}">
      <td class="sticky-col">${C.esc(no)}</td>
      <td class="text">${C.esc(C.val(r, 'type'))}</td>
      <td class="text">${C.esc(C.val(r, 'driver') || '—')}</td>
      <td class="tnum">${C.yen(C.numval(r, 'sales'))}</td>
      <td class="tnum neg">${C.yen(C.numval(r, 'profit'))}</td>
      ${extra(r)}
    </tr>`
  }

  function table(rows, extraHead, extra) {
    return `<div class="table-scroll" style="border-radius:8px">
      <table class="data">
        <thead><tr><th class="sticky-col">車番</th><th>車種</th><th>運転者</th><th>売上</th><th>損益</th>${extraHead}</tr></thead>
        <tbody>${rows.map((r) => row(r, extra)).join('')}</tbody>
      </table>
    </div>`
  }

  window.Views.deficit = function () {
    const m = C.month()
    const groups = C.classifyDeficit(m.rows)
    const all = [...groups.repair, ...groups.price, ...groups.idle]
    const totalDeficit = C.sum(all, 'profit')

    const summary = C.monthTabs() + `<p class="small rise-in" style="margin:0 0 1.25rem">
      ${m.ym.slice(0, 4)}年${m.label}の赤字は <strong class="tnum">${all.length}台・${C.man(totalDeficit)}</strong>。
      ここが利益改善の余地です。行をクリックすると車両の12ヶ月が開きます。</p>`

    const sections = [
      ['repair', groups.repair,
        '<th>修理費(実費)</th>',
        (r) => `<td class="tnum">${C.yen(C.numval(r, 'repair'))}</td>`,
        (a, b) => C.numval(b, 'repair') - C.numval(a, 'repair')],
      ['price', groups.price,
        '<th>km単価</th>',
        (r) => {
          const kmp = C.kmPrice(r)
          return `<td class="tnum ${kmp !== null && kmp < 170 ? 'neg' : ''}">${kmp === null ? '—' : C.num(kmp, 0)}円/km</td>`
        },
        (a, b) => (C.kmPrice(a) ?? 999) - (C.kmPrice(b) ?? 999)],
      ['idle', groups.idle,
        '<th>固定費の流出</th>',
        (r) => `<td class="tnum">${C.yen(C.numval(r, 'fixed'))}</td>`,
        (a, b) => C.numval(a, 'profit') - C.numval(b, 'profit')],
    ].map(([key, rows, extraHead, extra, sortFn], i) => {
      const meta = META[key]
      const sub = C.sum(rows, 'profit')
      const share = totalDeficit !== 0 ? sub / totalDeficit : 0
      const sorted = [...rows].sort(sortFn)
      const top = sorted.slice(0, TOP_N)
      const rest = sorted.slice(TOP_N)
      return `<div class="card rise-in" style="--stagger:${(i + 1) * 60}ms">
        <div class="card-head">
          <h2>${meta.title} — ${rows.length}台
            <span class="tnum" style="color:var(--danger)">${C.man(sub)}</span>
            <span class="xs muted">(赤字全体の${C.pct(share, 0)})</span></h2>
        </div>
        <p class="small muted" style="margin:0 0 0.7rem">${meta.desc} <strong>${meta.action}</strong></p>
        ${rows.length === 0 ? '<div class="note-info">該当車両はありません。</div>' : table(top, extraHead, extra)}
        ${rest.length > 0 ? `<details class="disclosure">
          <summary>残り${rest.length}台を表示</summary>
          <div class="disclosure-body">${table(rest, extraHead, extra)}</div>
        </details>` : ''}
      </div>`
    }).join('')

    return summary + sections + `
      <p class="xs muted rise-in">分類ルール(仮): 修理費実費${C.num(C.DEFICIT_RULES.repairSpike)}円以上=突発修繕 ／
        売上${C.num(C.DEFICIT_RULES.idleSales)}円未満=遊休・低稼働 ／ 残り=単価・効率。
        閾値は<a href="#" data-go="logic">データ設計</a>のヒアリングで調整します。</p>`
  }

  const prevAfter = window.Views.afterRender
  window.Views.afterRender = function (view, root) {
    if (prevAfter) prevAfter(view, root)
    if (view !== 'deficit') return
    root.querySelectorAll('tr[data-vehicle]').forEach((tr) => {
      tr.addEventListener('click', () => window.GridView.openModal(tr.dataset.vehicle))
    })
  }
})()
