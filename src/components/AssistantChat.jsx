import { useEffect, useRef, useState } from 'react'
import { MessageSquare, Mic, Send, Square } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { fmtDate } from '../lib/styles'

function money(n) {
  if (n == null || Number.isNaN(Number(n))) return '$0.00'
  return '$' + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function ymd(d) {
  const x = d instanceof Date ? d : new Date(d)
  const y = x.getFullYear()
  const m = String(x.getMonth() + 1).padStart(2, '0')
  const day = String(x.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function parseDateToken(text) {
  const t = (text || '').toLowerCase()
  const now = new Date()
  now.setHours(12, 0, 0, 0)
  if (/\btoday\b/.test(t)) return ymd(now)
  if (/\btomorrow\b/.test(t)) {
    const d = new Date(now)
    d.setDate(d.getDate() + 1)
    return ymd(d)
  }
  if (/\byesterday\b/.test(t)) {
    const d = new Date(now)
    d.setDate(d.getDate() - 1)
    return ymd(d)
  }
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
  for (let i = 0; i < days.length; i++) {
    if (new RegExp('\\b' + days[i] + '\\b').test(t)) {
      const d = new Date(now)
      let add = (i - d.getDay() + 7) % 7
      if (add === 0) add = 7
      d.setDate(d.getDate() + add)
      return ymd(d)
    }
  }
  const iso = t.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/)
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`
  const md = t.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/)
  if (md) {
    const month = Number(md[1])
    const day = Number(md[2])
    let year = md[3] ? Number(md[3]) : now.getFullYear()
    if (year < 100) year += 2000
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    }
  }
  const months = ['january','february','march','april','may','june','july','august','september','october','november','december']
  for (let i = 0; i < months.length; i++) {
    const re = new RegExp('\\b' + months[i].slice(0, 3) + '[a-z]*\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s*,?\\s*(20\\d{2}))?\\b')
    const m = t.match(re)
    if (m) {
      const year = m[2] ? Number(m[2]) : now.getFullYear()
      return `${year}-${String(i + 1).padStart(2, '0')}-${String(Number(m[1])).padStart(2, '0')}`
    }
  }
  return null
}

function matchProject(text, projects) {
  const t = (text || '').toLowerCase()
  let best = null
  let bestScore = 0
  for (const p of projects || []) {
    const addr = (p.address || '').toLowerCase()
    if (!addr) continue
    const tokens = addr.split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !['street', 'avenue', 'ave', 'lane', 'road', 'drive', 'the'].includes(w))
    let score = 0
    if (t.includes(addr)) score += 10
    tokens.forEach((tok) => { if (t.includes(tok)) score += tok.length > 4 ? 3 : 2 })
    if (score > bestScore) {
      bestScore = score
      best = p
    }
  }
  return bestScore >= 2 ? best : null
}

function matchPhases(text, phases) {
  const t = (text || '').toLowerCase()
  const aliases = [
    ['insulation', ['insulation', 'insul']],
    ['framing', ['framing', 'frame', 'framer']],
    ['drywall', ['drywall', 'sheetrock']],
    ['electrical', ['electrical', 'electric']],
    ['plumbing', ['plumbing', 'plumber']],
    ['hvac', ['hvac']],
    ['demo', ['demo', 'demolition']],
    ['paint', ['paint', 'painting']],
    ['flooring', ['flooring', 'floors']],
    ['tile', ['tile', 'tiling']],
    ['foundation', ['foundation', 'footing', 'footings']],
    ['roofing', ['roof', 'roofing']],
    ['cabinets', ['cabinet']],
    ['countertops', ['countertop', 'counters']],
  ]
  const found = []
  for (const ph of phases || []) {
    const name = (ph.name || '').toLowerCase()
    if (!name) continue
    if (t.includes(name) && name.length > 2) {
      found.push(ph)
      continue
    }
    for (const [label, words] of aliases) {
      if (name.includes(label) && words.some((w) => t.includes(w))) {
        found.push(ph)
        break
      }
    }
  }
  return found
}

function splitCommands(text) {
  return text
    .split(/\s+(?:and then|then|also|;|\.|\nand\s+(?=schedule|set|book|start))\s+/i)
    .map((s) => s.trim())
    .filter(Boolean)
}

export default function AssistantChat({ projects, profile, isAdmin, onReload, onOpenProject }) {
  const [messages, setMessages] = useState([
    {
      role: 'bot',
      text: isAdmin
        ? 'Ask me what’s scheduled today, how much you spent on something, or tell me to schedule a phase. Example: “Schedule framing on Maple Street this Friday.”'
        : 'Ask me what’s scheduled today or what’s going on with a project.',
    },
  ])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [listening, setListening] = useState(false)
  const recRef = useRef(null)
  const endRef = useRef(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, busy])

  const push = (role, text) => setMessages((m) => [...m, { role, text }])

  const loadMeetings = async (fromDate, toDate) => {
    let q = supabase.from('meetings').select('*').eq('company_id', profile.company_id).order('meet_date')
    if (fromDate) q = q.gte('meet_date', fromDate)
    if (toDate) q = q.lte('meet_date', toDate)
    const { data } = await q
    return data || []
  }

  const loadCosts = async () => {
    const { data } = await supabase.from('project_job_costs').select('*').eq('company_id', profile.company_id)
    return data || []
  }

  const describeDay = async (dateStr) => {
    const meetings = await loadMeetings(dateStr, dateStr)
    const lines = []
    for (const p of projects || []) {
      if (p.start_date === dateStr) lines.push(`${p.address}: project start`)
      if (p.end_date === dateStr) lines.push(`${p.address}: project end`)
      for (const ph of p.phases || []) {
        if (ph.start_date === dateStr) lines.push(`${p.address} — ${ph.name} starts`)
        if (ph.end_date === dateStr) lines.push(`${p.address} — ${ph.name} target end`)
        if (ph.status === 'active' && ph.start_date && ph.end_date && ph.start_date < dateStr && ph.end_date > dateStr) {
          lines.push(`${p.address} — ${ph.name} in progress`)
        }
      }
    }
    for (const m of meetings) {
      const proj = (projects || []).find((p) => p.id === m.project_id)
      const when = m.meet_time ? ` at ${String(m.meet_time).slice(0, 5)}` : ''
      lines.push(`Meeting${when}: ${m.title}${proj ? ' · ' + proj.address : ''}${m.location ? ' · ' + m.location : ''}`)
    }
    if (!lines.length) return `Nothing is scheduled for ${fmtDate(dateStr) || dateStr}.`
    return `${fmtDate(dateStr) || dateStr}\n` + lines.map((l) => '• ' + l).join('\n')
  }

  const schedulePhase = async (project, phase, dateStr) => {
    const patch = { start_date: dateStr, status: phase.status === 'done' ? phase.status : 'active' }
    const { error } = await supabase.from('phases').update(patch).eq('id', phase.id)
    if (error) return `Could not schedule ${phase.name}: ${error.message}`
    const meet = {
      company_id: profile.company_id,
      project_id: project.id,
      title: `${phase.name} — ${project.address}`,
      notes: 'Scheduled by assistant',
      meet_date: dateStr,
      location: project.address || null,
      created_by: profile.id,
    }
    let { error: mErr } = await supabase.from('meetings').insert(meet)
    if (mErr && /location|column/i.test(mErr.message || '')) {
      const { location: _l, ...rest } = meet
      await supabase.from('meetings').insert(rest)
    }
    return `Scheduled ${phase.name} at ${project.address} for ${fmtDate(dateStr) || dateStr}.`
  }

  const handle = async (raw) => {
    const text = (raw || '').trim()
    if (!text) return
    push('user', text)
    setBusy(true)
    try {
      const lower = text.toLowerCase()
      const dateStr = parseDateToken(text)
      const project = matchProject(text, projects)

      if (/\b(help|what can you|commands)\b/.test(lower)) {
        push('bot', 'I can:\n• Tell you what’s scheduled today, tomorrow, or a date\n• Schedule a phase: “Schedule framing on Maple Friday”\n• Add a meeting: “Meeting at Oak Avenue tomorrow at 9”\n• Project update: “What’s going on at Birch”\n• Costs: “How much did I spend on dumpsters”')
        return
      }

      if (/\b(what'?s going|update|status|progress|ongoing)\b/.test(lower)) {
        const list = project ? [project] : (projects || []).slice(0, 8)
        if (!list.length) {
          push('bot', 'No projects to report on.')
          return
        }
        const lines = list.map((p) => {
          const phases = p.phases || []
          const done = phases.filter((ph) => ph.status === 'done').length
          const active = phases.filter((ph) => ph.status === 'active').map((ph) => ph.name)
          const pendingCo = (p.change_orders || []).filter((c) => ['pending', 'quoted'].includes(c.status || '')).length
          return `${p.address}: ${done}/${phases.length} phases done${active.length ? '. In progress: ' + active.join(', ') : ''}${pendingCo ? `. ${pendingCo} open change order(s)` : ''}.`
        })
        push('bot', lines.join('\n'))
        return
      }

      if (/\b(how much|spent|spend|cost|costs|dumpster|paid|profit|invoice)\b/.test(lower) && !/\bschedule\b/.test(lower)) {
        if (!isAdmin) {
          push('bot', 'Cost details are only available to the contractor.')
          return
        }
        const costs = await loadCosts()
        const keywordMatch = lower.match(/(?:on|for)\s+([a-z0-9][a-z0-9 \-]{1,40})$/) 
        const words = lower.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 3 && !['much','spend','spent','cost','costs','total','project','dumpsters'].includes(w))
        let keyword = null
        if (/\bdumpsters?\b/.test(lower)) keyword = 'dumpster'
        else if (keywordMatch) keyword = keywordMatch[1].trim()
        else if (words.length) keyword = words[words.length - 1]

        const scoped = project ? costs.filter((c) => c.project_id === project.id) : costs
        const filtered = keyword
          ? scoped.filter((c) => (c.note || '').toLowerCase().includes(keyword) || (c.kind || '').includes(keyword))
          : scoped
        const sum = filtered.reduce((s, c) => s + (Number(c.amount) || Number(c.actual_amount) || 0), 0)
        if (keyword) {
          push('bot', `${money(sum)} recorded for “${keyword}”${project ? ' on ' + project.address : ''}${filtered.length ? ` (${filtered.length} item${filtered.length === 1 ? '' : 's'})` : ''}.`)
        } else if (project) {
          const quoted = Number(project.base_cost) || 0
          push('bot', `${project.address}\nOriginal quote ${money(quoted)}\nJob costs on file ${money(sum)}.`)
        } else {
          push('bot', `Job costs on file across projects: ${money(sum)}. Name a project or item for a breakdown.`)
        }
        return
      }

      if (/\b(schedule|what'?s on|what is on|planned|calendar)\b/.test(lower) && !/\bschedule (framing|drywall|insulation|plumbing|electrical|hvac|demo|paint|phase)\b/.test(lower) && !/\bschedule .{0,40} on\b/.test(lower)) {
        if (/\bthis week\b/.test(lower)) {
          const start = new Date()
          start.setHours(12, 0, 0, 0)
          const parts = []
          for (let i = 0; i < 7; i++) {
            const d = new Date(start)
            d.setDate(d.getDate() + i)
            parts.push(await describeDay(ymd(d)))
          }
          push('bot', parts.join('\n\n'))
          return
        }
        push('bot', await describeDay(dateStr || ymd(new Date())))
        return
      }

      if (/\b(meeting|meet with|set up a meeting|schedule a meeting)\b/.test(lower)) {
        if (!isAdmin) {
          push('bot', 'Only the contractor can add meetings.')
          return
        }
        const when = dateStr || ymd(new Date())
        const timeMatch = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i)
        let meetTime = null
        if (timeMatch) {
          let h = Number(timeMatch[1])
          const min = timeMatch[2] || '00'
          const ap = (timeMatch[3] || '').toLowerCase()
          if (ap === 'pm' && h < 12) h += 12
          if (ap === 'am' && h === 12) h = 0
          meetTime = `${String(h).padStart(2, '0')}:${min}:00`
        }
        const title = text.replace(/^(please\s+)?(schedule|set up|add|book)\s+(a\s+)?meeting\s+/i, '').slice(0, 80) || 'Meeting'
        const { error } = await supabase.from('meetings').insert({
          company_id: profile.company_id,
          project_id: project?.id || null,
          title: title.length > 4 ? title : (project ? `Meeting — ${project.address}` : 'Meeting'),
          meet_date: when,
          meet_time: meetTime,
          location: project?.address || null,
          created_by: profile.id,
          notes: 'Scheduled by assistant',
        })
        if (error) push('bot', error.message)
        else {
          await onReload?.()
          push('bot', `Meeting added for ${fmtDate(when) || when}${meetTime ? ' at ' + meetTime.slice(0, 5) : ''}${project ? ' · ' + project.address : ''}.`)
        }
        return
      }

      if (/\b(schedule|book|set|start)\b/.test(lower)) {
        if (!isAdmin) {
          push('bot', 'Only the contractor can change the schedule.')
          return
        }
        const parts = splitCommands(text)
        const results = []
        for (const part of parts) {
          const d = parseDateToken(part) || dateStr
          const p = matchProject(part, projects) || project
          if (!p) {
            results.push('Which project? Include part of the address.')
            continue
          }
          if (!d) {
            results.push(`What date for ${p.address}?`)
            continue
          }
          const phases = matchPhases(part, p.phases || [])
          if (!phases.length) {
            const { error } = await supabase.from('meetings').insert({
              company_id: profile.company_id,
              project_id: p.id,
              title: part.slice(0, 80),
              meet_date: d,
              location: p.address || null,
              created_by: profile.id,
              notes: 'Scheduled by assistant',
            })
            results.push(error ? error.message : `Added on ${p.address} for ${fmtDate(d) || d}.`)
            continue
          }
          for (const ph of phases) {
            results.push(await schedulePhase(p, ph, d))
          }
        }
        await onReload?.()
        push('bot', results.join('\n'))
        return
      }

      if (project && /\bopen\b/.test(lower)) {
        onOpenProject?.(project.id)
        push('bot', `Opening ${project.address}.`)
        return
      }

      if (dateStr) {
        push('bot', await describeDay(dateStr))
        return
      }

      if (project) {
        const phases = project.phases || []
        const done = phases.filter((ph) => ph.status === 'done').length
        push('bot', `${project.address}: ${done} of ${phases.length} phases complete. Ask “what’s going on at ${project.address}” or “schedule framing on ${project.address} Friday”.`)
        return
      }

      push('bot', 'Try “What’s scheduled today”, “How much did I spend on dumpsters”, or “Schedule framing on Maple Street Friday”.')
    } catch (err) {
      push('bot', err.message || 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  const startVoice = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) {
      push('bot', 'Voice is not available in this browser. Type instead.')
      return
    }
    try {
      recRef.current?.stop?.()
    } catch (_) {}
    const rec = new SR()
    rec.lang = 'en-US'
    rec.interimResults = false
    rec.onresult = (e) => {
      const said = e.results?.[0]?.[0]?.transcript
      setListening(false)
      if (said) handle(said)
    }
    rec.onerror = () => setListening(false)
    rec.onend = () => setListening(false)
    recRef.current = rec
    setListening(true)
    rec.start()
  }

  const stopVoice = () => {
    try { recRef.current?.stop?.() } catch (_) {}
    setListening(false)
  }

  return (
    <div className="flex flex-col" style={{ minHeight: 'calc(100dvh - 190px)' }}>
      <div className="flex items-center gap-2 mb-3">
        <MessageSquare size={18} />
        <h2 className="font-display text-2xl">Assistant</h2>
      </div>
      <div className="flex flex-wrap gap-2 mb-3">
        {['What’s scheduled today?', 'This week', 'What’s going on?'].map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => handle(q)}
            className="text-xs border border-black rounded-full px-3 py-1"
          >
            {q}
          </button>
        ))}
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto mb-3">
        {messages.map((m, i) => (
          <div key={i} className={`max-w-[90%] rounded-md px-3 py-2 text-sm whitespace-pre-wrap ${m.role === 'user' ? 'ml-auto bg-black text-white' : 'bg-[#F5F5F5] border border-black'}`}>
            {m.text}
          </div>
        ))}
        {busy && <div className="text-xs text-[#6B6E72]">Working…</div>}
        <div ref={endRef} />
      </div>
      <form
        className="flex gap-2 items-end"
        onSubmit={(e) => {
          e.preventDefault()
          const v = input
          setInput('')
          handle(v)
        }}
      >
        <button
          type="button"
          onClick={listening ? stopVoice : startVoice}
          className={`w-11 h-11 rounded border border-black flex items-center justify-center flex-shrink-0 ${listening ? 'bg-black text-white' : 'bg-white'}`}
          aria-label={listening ? 'Stop' : 'Speak'}
        >
          {listening ? <Square size={16} /> : <Mic size={18} />}
        </button>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask or schedule…"
          className="flex-1 border border-black rounded px-3 py-2.5 text-sm"
        />
        <button type="submit" disabled={busy || !input.trim()} className="w-11 h-11 rounded bg-black text-white flex items-center justify-center disabled:opacity-40">
          <Send size={16} />
        </button>
      </form>
    </div>
  )
}
