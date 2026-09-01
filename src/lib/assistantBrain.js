function tokens(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1)
}

function money(n) {
  if (n == null || Number.isNaN(Number(n))) return null
  return '$' + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function buildProjectPack(projects, extras = {}) {
  const costs = extras.costs || []
  const meetings = extras.meetings || []
  return (projects || []).map((p) => {
    const phases = p.phases || []
    const done = phases.filter((ph) => ph.status === 'done')
    const active = phases.filter((ph) => ph.status === 'active')
    const cos = p.change_orders || []
    const approved = cos.filter((c) => (c.status || '') === 'approved')
    const coSum = approved.reduce((s, c) => s + (Number(c.amount) || 0), 0)
    const base = p.base_cost != null ? Number(p.base_cost) : null
    const paid = Number(p.amount_paid) || 0
    const pCosts = costs.filter((c) => c.project_id === p.id)
    const costLines = pCosts.map((c) => {
      const amt = Number(c.actual_amount ?? c.amount) || 0
      return `${c.kind || 'cost'}${c.note ? ' ' + c.note : ''}: ${money(amt)}`
    })
    const meetLines = meetings
      .filter((m) => m.project_id === p.id)
      .map((m) => `${m.meet_date}${m.meet_time ? ' ' + String(m.meet_time).slice(0, 5) : ''} ${m.title}`)
    const facts = [
      `Address ${p.address}`,
      p.style ? `Type ${p.style}` : null,
      p.status ? `Project status ${p.status}` : null,
      base != null ? `Quoted amount ${money(base)}` : 'No quoted amount set',
      coSum ? `Approved change orders ${money(coSum)}` : null,
      base != null ? `Quoted total ${money((base || 0) + coSum)}` : null,
      paid ? `Paid ${money(paid)}` : null,
      base != null ? `Balance ${money((base || 0) + coSum - paid)}` : null,
      `${done.length} of ${phases.length} phases complete`,
      active.length ? `In progress ${active.map((ph) => ph.name).join(', ')}` : 'No phase in progress',
      ...phases.map((ph) => {
        const bits = [ph.name, ph.status || 'pending']
        if (ph.start_date) bits.push('start ' + ph.start_date)
        if (ph.end_date) bits.push('end ' + ph.end_date)
        if (ph.trade) bits.push('trade ' + ph.trade)
        return bits.join(', ')
      }),
      ...approved.map((c) => `Change order approved ${c.title || c.note || ''} ${money(c.amount)}`),
      ...cos.filter((c) => ['pending', 'quoted'].includes(c.status || '')).map((c) => `Open change order ${c.title || c.note || ''} ${c.status}`),
      ...costLines,
      ...meetLines.map((l) => 'Meeting ' + l),
    ].filter(Boolean)
    return {
      id: p.id,
      address: p.address || '',
      search: tokens([p.address, p.style, ...phases.map((ph) => ph.name)].join(' ')),
      facts,
      project: p,
    }
  })
}

export function resolveProject(text, pack, lastId) {
  const t = tokens(text)
  let best = null
  let bestScore = 0
  for (const row of pack || []) {
    let score = 0
    const addr = row.address.toLowerCase()
    if (addr && String(text || '').toLowerCase().includes(addr)) score += 20
    row.search.forEach((w) => {
      if (t.includes(w)) score += w.length > 3 ? 4 : 2
    })
    if (row.id === lastId) score += 1
    if (score > bestScore) {
      bestScore = score
      best = row
    }
  }
  if (bestScore >= 2) return best
  if (lastId) return (pack || []).find((r) => r.id === lastId) || null
  return null
}

function pickFacts(row, question) {
  const q = String(question || '').toLowerCase()
  const all = row.facts || []
  if (/quot|contract amount|construction cost|cost of construction|original/.test(q)) {
    return all.filter((f) => /quoted|change order approved|no quoted/i.test(f))
  }
  if (/paid|balance|remaining|owe/.test(q)) {
    return all.filter((f) => /quoted|paid|balance/i.test(f))
  }
  if (/dumpster|invoice|receipt|spent|spend|job cost/.test(q)) {
    const key = (q.match(/dumpster|invoice|receipt|[a-z]{4,}/g) || []).join(' ')
    const hits = all.filter((f) => key.split(' ').some((w) => w.length > 3 && f.toLowerCase().includes(w)))
    return hits.length ? hits : all.filter((f) => /cost|invoice|receipt|quoted/i.test(f))
  }
  if (/meeting|calendar|schedul/.test(q) && !/framing|drywall|phase/.test(q)) {
    return all.filter((f) => /meeting|start |end /i.test(f))
  }
  if (/going on|progress|status|update|phase/.test(q)) {
    return all.filter((f) => /phases complete|in progress|Project status|start |end /i.test(f) || /pending|active|done/i.test(f))
  }
  const qt = tokens(q)
  const scored = all
    .map((f) => ({ f, n: tokens(f).filter((w) => qt.includes(w)).length }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n)
  if (scored.length) return scored.slice(0, 8).map((x) => x.f)
  return all.filter((f) => /quoted|phases complete|in progress/i.test(f)).slice(0, 6)
}

export function answerFromContext(question, historyText, pack, lastId) {
  const row = resolveProject(`${question} ${historyText || ''}`, pack, lastId)
  if (!row) return { text: 'Which address?', projectId: lastId || null }
  const facts = pickFacts(row, question)
  if (!facts.length) return { text: `${row.address}: nothing on file for that.`, projectId: row.id }
  return { text: `${row.address}\n` + facts.join('\n'), projectId: row.id }
}

export function contextBlob(pack) {
  return (pack || [])
    .map((r) => `PROJECT ${r.address}\n` + r.facts.map((f) => '- ' + f).join('\n'))
    .join('\n\n')
    .slice(0, 14000)
}
