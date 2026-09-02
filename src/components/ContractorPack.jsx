import { useEffect, useState } from 'react'
import { ChevronLeft, Plus, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { STYLES, fmtDate } from '../lib/styles'

function money(n) {
  if (n == null || n === '' || Number.isNaN(Number(n))) return '—'
  return '$' + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function todayYmd() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const field =
  'w-full max-w-full min-w-0 box-border border border-black rounded px-3 py-2 text-sm appearance-none bg-white'

function Page({ children }) {
  return <div className="w-full max-w-full min-w-0 overflow-x-hidden box-border">{children}</div>
}

function Back({ onBack, title }) {
  if (!onBack) {
    return <h2 className="font-display text-xl mb-3 min-w-0">{title}</h2>
  }
  return (
    <div className="flex items-center gap-2 mb-4 min-w-0">
      <button type="button" onClick={onBack} className="flex items-center gap-1 text-sm text-[#6B6E72] flex-shrink-0">
        <ChevronLeft size={16} /> Back
      </button>
      <h2 className="font-display text-2xl flex-1 min-w-0 truncate">{title}</h2>
    </div>
  )
}

function coiFlag(date) {
  if (!date) return null
  const d = new Date(date + 'T12:00:00')
  const now = new Date()
  const soon = new Date()
  soon.setDate(soon.getDate() + 30)
  if (d < now) return 'expired'
  if (d < soon) return 'soon'
  return null
}

export function DirectoryPage({ profile, onBack }) {
  const [rows, setRows] = useState([])
  const [form, setForm] = useState({ name: '', kind: 'trade', trade: '', phone: '', email: '', insurance_expires: '', notes: '' })
  const load = async () => {
    const { data } = await supabase.from('directory_contacts').select('*').eq('company_id', profile.company_id).order('name')
    setRows(data || [])
  }
  useEffect(() => { load() }, [profile.company_id])
  const add = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) return
    await supabase.from('directory_contacts').insert({ ...form, name: form.name.trim(), company_id: profile.company_id })
    setForm({ name: '', kind: 'trade', trade: '', phone: '', email: '', insurance_expires: '', notes: '' })
    load()
  }
  const remove = async (id) => {
    await supabase.from('directory_contacts').delete().eq('id', id)
    load()
  }
  return (
    <Page>
      <Back onBack={onBack} title="Directory" />
      <form onSubmit={add} className="w-full max-w-full min-w-0 box-border border border-black rounded-md p-3 space-y-2 mb-4">
        <input className={field} placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <div className="grid grid-cols-2 gap-2 min-w-0">
          <select className={field} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
            <option value="trade">Trade</option>
            <option value="supplier">Supplier</option>
          </select>
          <input className={field} placeholder="Trade / type" value={form.trade} onChange={(e) => setForm({ ...form, trade: e.target.value })} />
        </div>
        <input className={field} placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        <input className={field} placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <label className="block text-[11px] font-mono uppercase text-[#6B6E72]">Insurance expires
          <input type="date" className={field + " mt-1"} value={form.insurance_expires} onChange={(e) => setForm({ ...form, insurance_expires: e.target.value })} />
        </label>
        <button type="submit" className="w-full py-2.5 bg-black text-white rounded text-sm">Add to directory</button>
      </form>
      <div className="space-y-2">
        {rows.map((r) => {
          const flag = coiFlag(r.insurance_expires)
          return (
            <div key={r.id} className="w-full max-w-full min-w-0 box-border border border-black rounded-md p-3">
              <div className="flex justify-between gap-2">
                <div>
                  <div className="font-medium text-sm">{r.name}</div>
                  <div className="text-xs text-[#6B6E72]">{r.kind}{r.trade ? ' · ' + r.trade : ''}</div>
                  {r.phone && <div className="text-xs">{r.phone}</div>}
                  {r.email && <div className="text-xs">{r.email}</div>}
                  {r.insurance_expires && (
                    <div className={`text-xs mt-1 ${flag === 'expired' ? 'text-[#B5533C]' : flag === 'soon' ? 'text-[#B8860B]' : ''}`}>
                      COI {fmtDate(r.insurance_expires)}{flag === 'expired' ? ' — expired' : flag === 'soon' ? ' — expires soon' : ''}
                    </div>
                  )}
                </div>
                <button type="button" onClick={() => remove(r.id)} className="p-1"><Trash2 size={14} /></button>
              </div>
            </div>
          )
        })}
        {!rows.length && <p className="text-sm text-[#6B6E72]">No contacts yet.</p>}
      </div>
    </Page>
  )
}

export function DailyLogPage({ project, profile, isAdmin, onBack }) {
  const [rows, setRows] = useState([])
  const [form, setForm] = useState({ log_date: todayYmd(), crew: '', weather: '', delays: '', deliveries: '', notes: '' })
  const load = async () => {
    const { data } = await supabase.from('daily_logs').select('*').eq('project_id', project.id).order('log_date', { ascending: false })
    setRows(data || [])
  }
  useEffect(() => { load() }, [project.id])
  const add = async (e) => {
    e.preventDefault()
    if (!isAdmin) return
    await supabase.from('daily_logs').insert({ ...form, company_id: profile.company_id, project_id: project.id, created_by: profile.id })
    setForm({ log_date: todayYmd(), crew: '', weather: '', delays: '', deliveries: '', notes: '' })
    load()
  }
  return (
    <Page>
      <Back onBack={onBack} title="Daily log" />
      {isAdmin && (
        <form onSubmit={add} className="w-full max-w-full min-w-0 box-border border border-black rounded-md p-3 space-y-2 mb-4">
          <input type="date" className={field} value={form.log_date} onChange={(e) => setForm({ ...form, log_date: e.target.value })} />
          <input className={field} placeholder="Who was on site" value={form.crew} onChange={(e) => setForm({ ...form, crew: e.target.value })} />
          <input className={field} placeholder="Weather" value={form.weather} onChange={(e) => setForm({ ...form, weather: e.target.value })} />
          <input className={field} placeholder="Delays" value={form.delays} onChange={(e) => setForm({ ...form, delays: e.target.value })} />
          <input className={field} placeholder="Deliveries" value={form.deliveries} onChange={(e) => setForm({ ...form, deliveries: e.target.value })} />
          <textarea className={field} rows={3} placeholder="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          <button type="submit" className="w-full py-2.5 bg-black text-white rounded text-sm">Save log</button>
        </form>
      )}
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.id} className="w-full max-w-full min-w-0 box-border border border-black rounded-md p-3 text-sm">
            <div className="font-medium">{fmtDate(r.log_date)}</div>
            {r.crew && <div>Crew: {r.crew}</div>}
            {r.weather && <div>Weather: {r.weather}</div>}
            {r.delays && <div>Delays: {r.delays}</div>}
            {r.deliveries && <div>Deliveries: {r.deliveries}</div>}
            {r.notes && <div className="mt-1 whitespace-pre-wrap">{r.notes}</div>}
          </div>
        ))}
        {!rows.length && <p className="text-sm text-[#6B6E72]">No logs yet.</p>}
      </div>
    </Page>
  )
}

export function PermitsPage({ project, profile, isAdmin, onBack }) {
  const [rows, setRows] = useState([])
  const [form, setForm] = useState({ title: '', number: '', office: '', filed_on: '', inspection_on: '', result: 'pending' })
  const load = async () => {
    const { data } = await supabase.from('permits').select('*').eq('project_id', project.id).order('created_at', { ascending: false })
    setRows(data || [])
  }
  useEffect(() => { load() }, [project.id])
  const add = async (e) => {
    e.preventDefault()
    if (!isAdmin || !form.title.trim()) return
    await supabase.from('permits').insert({ ...form, title: form.title.trim(), company_id: profile.company_id, project_id: project.id })
    setForm({ title: '', number: '', office: '', filed_on: '', inspection_on: '', result: 'pending' })
    load()
  }
  const setResult = async (id, result) => {
    await supabase.from('permits').update({ result }).eq('id', id)
    load()
  }
  return (
    <Page>
      <Back onBack={onBack} title="Permits" />
      {isAdmin && (
        <form onSubmit={add} className="w-full max-w-full min-w-0 box-border border border-black rounded-md p-3 space-y-2 mb-4">
          <input className={field} placeholder="Permit name" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <input className={field} placeholder="Number" value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} />
          <input className={field} placeholder="Office" value={form.office} onChange={(e) => setForm({ ...form, office: e.target.value })} />
          <label className="block text-[11px] font-mono uppercase text-[#6B6E72]">Filed
            <input type="date" className={field + " mt-1"} value={form.filed_on} onChange={(e) => setForm({ ...form, filed_on: e.target.value })} />
          </label>
          <label className="block text-[11px] font-mono uppercase text-[#6B6E72]">Inspection
            <input type="date" className={field + " mt-1"} value={form.inspection_on} onChange={(e) => setForm({ ...form, inspection_on: e.target.value })} />
          </label>
          <button type="submit" className="w-full py-2.5 bg-black text-white rounded text-sm">Add permit</button>
        </form>
      )}
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.id} className="w-full max-w-full min-w-0 box-border border border-black rounded-md p-3 text-sm">
            <div className="font-medium">{r.title}</div>
            <div className="text-xs text-[#6B6E72]">{[r.number, r.office].filter(Boolean).join(' · ')}</div>
            <div className="text-xs mt-1">Filed {fmtDate(r.filed_on)} · Inspection {fmtDate(r.inspection_on)}</div>
            {isAdmin ? (
              <div className="flex gap-2 mt-2">
                {['pending', 'pass', 'fail'].map((s) => (
                  <button key={s} type="button" onClick={() => setResult(r.id, s)} className={`px-2 py-1 text-xs border border-black rounded ${r.result === s ? 'bg-black text-white' : ''}`}>{s}</button>
                ))}
              </div>
            ) : <div className="text-xs uppercase mt-1">{r.result}</div>}
          </div>
        ))}
        {!rows.length && <p className="text-sm text-[#6B6E72]">No permits yet.</p>}
      </div>
    </Page>
  )
}

export function SelectionsPage({ project, profile, isAdmin, isCustomer, onBack }) {
  const [rows, setRows] = useState([])
  const [form, setForm] = useState({ category: '', item_name: '', option_label: '', notes: '' })
  const load = async () => {
    const { data } = await supabase.from('selections').select('*').eq('project_id', project.id).order('created_at', { ascending: false })
    setRows(data || [])
  }
  useEffect(() => { load() }, [project.id])
  const add = async (e) => {
    e.preventDefault()
    if (!isAdmin || !form.item_name.trim()) return
    await supabase.from('selections').insert({ ...form, item_name: form.item_name.trim(), company_id: profile.company_id, project_id: project.id, status: 'pending' })
    setForm({ category: '', item_name: '', option_label: '', notes: '' })
    load()
  }
  const setStatus = async (id, status) => {
    await supabase.from('selections').update({ status, decided_at: status === 'pending' ? null : new Date().toISOString() }).eq('id', id)
    load()
  }
  return (
    <Page>
      <Back onBack={onBack} title="Selections" />
      {isAdmin && (
        <form onSubmit={add} className="w-full max-w-full min-w-0 box-border border border-black rounded-md p-3 space-y-2 mb-4">
          <input className={field} placeholder="Category (tile, paint, fixture)" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
          <input className={field} placeholder="Item" value={form.item_name} onChange={(e) => setForm({ ...form, item_name: e.target.value })} />
          <input className={field} placeholder="Option" value={form.option_label} onChange={(e) => setForm({ ...form, option_label: e.target.value })} />
          <button type="submit" className="w-full py-2.5 bg-black text-white rounded text-sm">Add selection</button>
        </form>
      )}
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.id} className="w-full max-w-full min-w-0 box-border border border-black rounded-md p-3 text-sm">
            <div className="text-[11px] font-mono uppercase text-[#6B6E72]">{r.category || 'Selection'}</div>
            <div className="font-medium">{r.item_name}</div>
            {r.option_label && <div>{r.option_label}</div>}
            <div className="text-xs mt-1 uppercase">{r.status}{r.decided_at ? ' · ' + fmtDate(r.decided_at.slice(0, 10)) : ''}</div>
            {(isCustomer || isAdmin) && r.status === 'pending' && (
              <div className="flex gap-2 mt-2">
                <button type="button" className="px-3 py-1.5 bg-black text-white rounded text-xs" onClick={() => setStatus(r.id, 'approved')}>Approve</button>
                {isAdmin && <button type="button" className="px-3 py-1.5 border border-black rounded text-xs" onClick={() => setStatus(r.id, 'locked')}>Lock</button>}
              </div>
            )}
            {isAdmin && r.status === 'approved' && (
              <button type="button" className="mt-2 px-3 py-1.5 border border-black rounded text-xs" onClick={() => setStatus(r.id, 'locked')}>Lock choice</button>
            )}
          </div>
        ))}
        {!rows.length && <p className="text-sm text-[#6B6E72]">No selections yet.</p>}
      </div>
    </Page>
  )
}

export function InvoicesPage({ project, profile, isAdmin, isCustomer, onBack }) {
  const [rows, setRows] = useState([])
  const [form, setForm] = useState({ title: 'Invoice', amount: '', due_date: '', notes: '' })
  const load = async () => {
    const { data } = await supabase.from('customer_invoices').select('*').eq('project_id', project.id).order('created_at', { ascending: false })
    setRows(data || [])
  }
  useEffect(() => { load() }, [project.id])
  const add = async (e) => {
    e.preventDefault()
    if (!isAdmin) return
    const n = String((rows.length || 0) + 1).padStart(3, '0')
    await supabase.from('customer_invoices').insert({
      company_id: profile.company_id,
      project_id: project.id,
      number: n,
      title: form.title.trim() || 'Invoice',
      amount: form.amount === '' ? null : Number(form.amount),
      due_date: form.due_date || null,
      notes: form.notes,
      status: 'sent',
    })
    setForm({ title: 'Invoice', amount: '', due_date: '', notes: '' })
    load()
  }
  const markPaid = async (id) => {
    await supabase.from('customer_invoices').update({ status: 'paid' }).eq('id', id)
    load()
  }
  const share = async (r) => {
    const text = `${r.title} #${r.number || ''}\n${project.address}\nAmount ${money(r.amount)}\nDue ${fmtDate(r.due_date)}\n${r.notes || ''}`.trim()
    try {
      if (navigator.share) await navigator.share({ text })
      else await navigator.clipboard.writeText(text)
    } catch (_) {}
  }
  return (
    <Page>
      <Back onBack={onBack} title="Invoices" />
      {isAdmin && (
        <form onSubmit={add} className="w-full max-w-full min-w-0 box-border border border-black rounded-md p-3 space-y-2 mb-4">
          <input className={field} placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <input className={field} placeholder="Amount" type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          <label className="block text-[11px] font-mono uppercase text-[#6B6E72]">Due
            <input type="date" className={field + " mt-1"} value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
          </label>
          <textarea className={field} rows={2} placeholder="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          <button type="submit" className="w-full py-2.5 bg-black text-white rounded text-sm">Send invoice</button>
        </form>
      )}
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.id} className="w-full max-w-full min-w-0 box-border border border-black rounded-md p-3 text-sm">
            <div className="flex justify-between">
              <div className="font-medium">{r.title} {r.number ? '#' + r.number : ''}</div>
              <div>{money(r.amount)}</div>
            </div>
            <div className="text-xs text-[#6B6E72]">Due {fmtDate(r.due_date)} · {r.status}</div>
            {r.notes && <div className="text-xs mt-1">{r.notes}</div>}
            <div className="flex gap-2 mt-2">
              <button type="button" className="px-3 py-1.5 border border-black rounded text-xs" onClick={() => share(r)}>Share</button>
              {isAdmin && r.status !== 'paid' && <button type="button" className="px-3 py-1.5 bg-black text-white rounded text-xs" onClick={() => markPaid(r.id)}>Mark paid</button>}
            </div>
          </div>
        ))}
        {!rows.length && <p className="text-sm text-[#6B6E72]">No invoices yet.</p>}
      </div>
    </Page>
  )
}

export function WeekBoard({ projects, onOpenProject, onBack, hideBack }) {
  const start = new Date()
  start.setHours(12, 0, 0, 0)
  const days = [...Array(7)].map((_, i) => {
    const d = new Date(start)
    d.setDate(d.getDate() + i)
    return d.toISOString().slice(0, 10)
  })
  const rows = (projects || []).map((p) => {
    const phases = (p.phases || []).filter((ph) => ph.status === 'active' || (ph.start_date && days.includes(ph.start_date)))
    const meetings = []
    return { p, phases }
  }).filter((r) => r.phases.length || r.p.status === 'active')
  return (
    <Page>
      {!hideBack && <Back onBack={onBack} title="This week" />}
      {hideBack && <h2 className="font-display text-2xl mb-4">This week</h2>}
      <div className="space-y-3">
        {rows.map(({ p, phases }) => (
          <button key={p.id} type="button" className="w-full max-w-full min-w-0 box-border text-left border border-black rounded-md p-3" onClick={() => onOpenProject?.(p.id)}>
            <div className="font-medium text-sm">{p.address}</div>
            {phases.length ? phases.map((ph) => (
              <div key={ph.id} className="text-xs mt-1">
                {ph.name} · {ph.status === 'active' ? 'in progress' : 'starts'} {ph.start_date ? fmtDate(ph.start_date) : ''}
              </div>
            )) : <div className="text-xs text-[#6B6E72] mt-1">Job in progress</div>}
          </button>
        ))}
        {!rows.length && <p className="text-sm text-[#6B6E72]">Nothing scheduled this week.</p>}
      </div>
    </Page>
  )
}

export function EstimatesPage({ profile, onBack, onOpenProject }) {
  const [rows, setRows] = useState([])
  const [title, setTitle] = useState('')
  const [address, setAddress] = useState('')
  const [style, setStyle] = useState('remodel')
  const [line, setLine] = useState('')
  const [amt, setAmt] = useState('')
  const [openId, setOpenId] = useState(null)
  const [lines, setLines] = useState([])
  const load = async () => {
    const { data } = await supabase.from('estimates').select('*').eq('company_id', profile.company_id).order('created_at', { ascending: false })
    setRows(data || [])
  }
  const loadLines = async (id) => {
    const { data } = await supabase.from('estimate_lines').select('*').eq('estimate_id', id).order('sort_order')
    setLines(data || [])
  }
  useEffect(() => { load() }, [profile.company_id])
  const add = async (e) => {
    e.preventDefault()
    if (!title.trim()) return
    await supabase.from('estimates').insert({ company_id: profile.company_id, title: title.trim(), address: address.trim() || null, style, status: 'draft' })
    setTitle(''); setAddress('')
    load()
  }
  const addLine = async (e) => {
    e.preventDefault()
    if (!openId || !line.trim()) return
    await supabase.from('estimate_lines').insert({ estimate_id: openId, label: line.trim(), amount: amt === '' ? null : Number(amt), sort_order: lines.length })
    setLine(''); setAmt('')
    loadLines(openId)
  }
  const convert = async (est) => {
    const { data: linesData } = await supabase.from('estimate_lines').select('*').eq('estimate_id', est.id)
    const total = (linesData || []).reduce((s, l) => s + (Number(l.amount) || 0), 0)
    const styleKey = STYLES[est.style] ? est.style : 'remodel'
    const phaseNames = STYLES[styleKey].phases
    const { data: project, error } = await supabase.from('projects').insert({
      company_id: profile.company_id,
      address: est.address || est.title,
      style: styleKey,
      status: 'planning',
      base_cost: total || null,
    }).select().single()
    if (error || !project) return
    await supabase.from('phases').insert(phaseNames.map((name, i) => ({ project_id: project.id, name, sort_order: i, status: 'pending' })))
    await supabase.from('estimates').update({ status: 'converted', project_id: project.id }).eq('id', est.id)
    load()
    onOpenProject?.(project.id)
  }
  return (
    <Page>
      <Back onBack={onBack} title="Estimates" />
      <form onSubmit={add} className="w-full max-w-full min-w-0 box-border border border-black rounded-md p-3 space-y-2 mb-4">
        <input className={field} placeholder="Estimate title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <input className={field} placeholder="Address" value={address} onChange={(e) => setAddress(e.target.value)} />
        <select className={field} value={style} onChange={(e) => setStyle(e.target.value)}>
          {Object.entries(STYLES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <button type="submit" className="w-full py-2.5 bg-black text-white rounded text-sm">New estimate</button>
      </form>
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.id} className="w-full max-w-full min-w-0 box-border border border-black rounded-md p-3">
            <button type="button" className="w-full text-left" onClick={() => { setOpenId(r.id === openId ? null : r.id); if (r.id !== openId) loadLines(r.id) }}>
              <div className="font-medium text-sm">{r.title}</div>
              <div className="text-xs text-[#6B6E72]">{r.address || ''} · {r.status}</div>
            </button>
            {openId === r.id && (
              <div className="mt-3 space-y-2">
                {lines.map((l) => (
                  <div key={l.id} className="flex justify-between text-sm">
                    <span>{l.label}</span><span>{money(l.amount)}</span>
                  </div>
                ))}
                {r.status !== 'converted' && (
                  <form onSubmit={addLine} className="flex gap-2">
                    <input className={"flex-1 " + field} placeholder="Line" value={line} onChange={(e) => setLine(e.target.value)} />
                    <input className={"w-24 min-w-0 " + field} placeholder="$" value={amt} onChange={(e) => setAmt(e.target.value)} />
                    <button type="submit" className="px-2 border border-black rounded"><Plus size={14} /></button>
                  </form>
                )}
                {r.status !== 'converted' && (
                  <button type="button" className="w-full py-2 bg-black text-white rounded text-sm" onClick={() => convert(r)}>Turn into project</button>
                )}
                {r.project_id && (
                  <button type="button" className="w-full py-2 border border-black rounded text-sm" onClick={() => onOpenProject?.(r.project_id)}>Open project</button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </Page>
  )
}

export function PlanMarkupPage({ project, profile, isAdmin, onBack }) {
  const files = [...(project.project_files || []), ...(project.phases || []).flatMap((ph) => (ph.phase_files || []).map((f) => ({ ...f, phase_id: ph.id })))]
    .map((f) => ({ ...f, src: f.public_url || f.url || f.file_url || '' }))
    .filter((f) => f.src.match(/\.(png|jpe?g|webp|gif)(\?|$)/i) || (f.kind || f.type || f.mime || '').includes('image'))
  const [activeUrl, setActiveUrl] = useState(files[0]?.src || '')
  const [pins, setPins] = useState([])
  const [note, setNote] = useState('')
  const [phaseId, setPhaseId] = useState('')
  const load = async () => {
    const { data } = await supabase.from('plan_pins').select('*').eq('project_id', project.id)
    setPins(data || [])
  }
  useEffect(() => { load() }, [project.id])
  const onTap = async (e) => {
    if (!isAdmin || !activeUrl) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 100
    const y = ((e.clientY - rect.top) / rect.height) * 100
    const text = note.trim() || 'Pin'
    await supabase.from('plan_pins').insert({
      company_id: profile.company_id,
      project_id: project.id,
      phase_id: phaseId || null,
      file_url: activeUrl,
      x_pct: x,
      y_pct: y,
      note: text,
      created_by: profile.id,
    })
    setNote('')
    load()
  }
  const visible = pins.filter((p) => p.file_url === activeUrl)
  return (
    <Page>
      <Back onBack={onBack} title="Plan markup" />
      {!files.length ? (
        <p className="text-sm text-[#6B6E72]">Upload a plan photo under Plans & files first.</p>
      ) : (
        <>
          <select className="w-full border border-black rounded px-3 py-2 text-sm mb-2" value={activeUrl} onChange={(e) => setActiveUrl(e.target.value)}>
            {files.map((f, i) => <option key={i} value={f.src}>{f.file_name || f.name || f.title || 'Plan ' + (i + 1)}</option>)}
          </select>
          {isAdmin && (
            <div className="flex gap-2 mb-2 min-w-0">
              <input className={"flex-1 " + field} placeholder="Pin note" value={note} onChange={(e) => setNote(e.target.value)} />
              <select className={"min-w-0 " + field} value={phaseId} onChange={(e) => setPhaseId(e.target.value)}>
                <option value="">Phase</option>
                {(project.phases || []).map((ph) => <option key={ph.id} value={ph.id}>{ph.name}</option>)}
              </select>
            </div>
          )}
          <div className="relative border border-black rounded overflow-hidden" onClick={onTap}>
            <img src={activeUrl} alt="" className="w-full block" />
            {visible.map((p) => (
              <div key={p.id} className="absolute w-4 h-4 -ml-2 -mt-2 rounded-full bg-[#E6B800] border border-black" style={{ left: p.x_pct + '%', top: p.y_pct + '%' }} title={p.note} />
            ))}
          </div>
          <div className="mt-3 space-y-1">
            {visible.map((p) => (
              <div key={p.id} className="text-xs">{p.note}{p.phase_id ? ' · ' + ((project.phases || []).find((ph) => ph.id === p.phase_id)?.name || '') : ''}</div>
            ))}
          </div>
        </>
      )}
    </Page>
  )
}

export function CloseoutPage({ project, profile, isAdmin, isCustomer, onBack }) {
  const [rows, setRows] = useState([])
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState('warranty')
  const [detail, setDetail] = useState('')
  const load = async () => {
    const { data } = await supabase.from('closeout_items').select('*').eq('project_id', project.id).order('created_at')
    setRows(data || [])
  }
  useEffect(() => { load() }, [project.id])
  const add = async (e) => {
    e.preventDefault()
    if (!isAdmin || !title.trim()) return
    await supabase.from('closeout_items').insert({ company_id: profile.company_id, project_id: project.id, kind, title: title.trim(), detail })
    setTitle(''); setDetail('')
    load()
  }
  const share = async () => {
    const cos = (project.change_orders || []).filter((c) => c.status === 'approved')
    const text = [
      'Closeout · ' + project.address,
      'Quote ' + money(project.base_cost),
      ...rows.map((r) => r.kind + ': ' + r.title + (r.detail ? ' — ' + r.detail : '')),
      ...cos.map((c) => 'CO approved: ' + (c.title || c.note || '') + ' ' + money(c.amount)),
    ].join('\n')
    try {
      if (navigator.share) await navigator.share({ text })
      else await navigator.clipboard.writeText(text)
    } catch (_) {}
  }
  return (
    <Page>
      <Back onBack={onBack} title="Closeout" />
      {isAdmin && (
        <form onSubmit={add} className="w-full max-w-full min-w-0 box-border border border-black rounded-md p-3 space-y-2 mb-4">
          <select className={field} value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="warranty">Warranty</option>
            <option value="manual">Manual</option>
            <option value="note">Note</option>
          </select>
          <input className={field} placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <input className={field} placeholder="Detail" value={detail} onChange={(e) => setDetail(e.target.value)} />
          <button type="submit" className="w-full py-2.5 bg-black text-white rounded text-sm">Add to packet</button>
        </form>
      )}
      <div className="space-y-2 mb-4">
        {rows.map((r) => (
          <div key={r.id} className="w-full max-w-full min-w-0 box-border border border-black rounded-md p-3 text-sm">
            <div className="text-[11px] font-mono uppercase text-[#6B6E72]">{r.kind}</div>
            <div className="font-medium">{r.title}</div>
            {r.detail && <div className="text-xs">{r.detail}</div>}
          </div>
        ))}
      </div>
      <button type="button" className="w-full py-2.5 border border-black rounded text-sm" onClick={share}>Share closeout packet</button>
    </Page>
  )
}

export function ScheduleAsksPage({ project, profile, isAdmin, companyUsers = [], onBack }) {
  const [rows, setRows] = useState([])
  const [phaseId, setPhaseId] = useState('')
  const [userId, setUserId] = useState('')
  const [askDate, setAskDate] = useState(todayYmd())
  const load = async () => {
    let q = supabase.from('schedule_asks').select('*').eq('company_id', profile.company_id)
    if (project?.id) q = q.eq('project_id', project.id)
    if (profile.role === 'team') q = q.eq('user_id', profile.id)
    const { data } = await q.order('ask_date')
    setRows(data || [])
  }
  useEffect(() => { load() }, [project?.id, profile.id])
  const send = async (e) => {
    e.preventDefault()
    if (!isAdmin || !phaseId || !userId || !askDate) return
    await supabase.from('schedule_asks').insert({
      company_id: profile.company_id,
      project_id: project.id,
      phase_id: phaseId,
      user_id: userId,
      ask_date: askDate,
      status: 'pending',
    })
    try {
      await supabase.from('notifications').insert({
        company_id: profile.company_id,
        user_id: userId,
        project_id: project.id,
        title: 'Schedule confirm',
        body: 'Please confirm you can work ' + askDate,
      })
    } catch (_) {}
    load()
  }
  const reply = async (id, status) => {
    await supabase.from('schedule_asks').update({ status }).eq('id', id)
    load()
  }
  const phases = project?.phases || []
  const trades = (companyUsers || []).filter((u) => u.role === 'team')
  return (
    <Page>
      <Back onBack={onBack} title="Schedule confirm" />
      {isAdmin && project && (
        <form onSubmit={send} className="w-full max-w-full min-w-0 box-border border border-black rounded-md p-3 space-y-2 mb-4">
          <select className={field} value={phaseId} onChange={(e) => setPhaseId(e.target.value)}>
            <option value="">Phase</option>
            {phases.map((ph) => <option key={ph.id} value={ph.id}>{ph.name}</option>)}
          </select>
          <select className={field} value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">Trade</option>
            {trades.map((u) => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
          </select>
          <input type="date" className={field} value={askDate} onChange={(e) => setAskDate(e.target.value)} />
          <button type="submit" className="w-full py-2.5 bg-black text-white rounded text-sm">Ask to confirm</button>
        </form>
      )}
      <div className="space-y-2">
        {rows.map((r) => {
          const ph = phases.find((p) => p.id === r.phase_id)
          const mine = r.user_id === profile.id
          return (
            <div key={r.id} className="w-full max-w-full min-w-0 box-border border border-black rounded-md p-3 text-sm">
              <div className="font-medium">{ph?.name || 'Phase'} · {fmtDate(r.ask_date)}</div>
              <div className="text-xs uppercase mt-1">{r.status}</div>
              {mine && r.status === 'pending' && (
                <div className="flex gap-2 mt-2">
                  <button type="button" className="px-3 py-1.5 bg-black text-white rounded text-xs" onClick={() => reply(r.id, 'yes')}>Yes</button>
                  <button type="button" className="px-3 py-1.5 border border-black rounded text-xs" onClick={() => reply(r.id, 'no')}>No</button>
                </div>
              )}
            </div>
          )
        })}
        {!rows.length && <p className="text-sm text-[#6B6E72]">No schedule asks.</p>}
      </div>
    </Page>
  )
}

export function SetupWizard({ profile, company, onDone, onOpenNewProject, onOpenUsers }) {
  const [step, setStep] = useState(0)
  const [name, setName] = useState('')
  const [trade, setTrade] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('team')
  const finish = async () => {
    await supabase.from('companies').update({ onboarding_complete: true }).eq('id', company.id)
    onDone?.()
  }
  const addContact = async (e) => {
    e.preventDefault()
    if (!name.trim()) { setStep(2); return }
    await supabase.from('directory_contacts').insert({ company_id: profile.company_id, name: name.trim(), kind: 'trade', trade, phone, email })
    setStep(2)
  }
  const invite = async (e) => {
    e.preventDefault()
    if (inviteEmail.trim()) {
      await supabase.from('company_invites').upsert({
        company_id: profile.company_id,
        email: inviteEmail.trim().toLowerCase(),
        role: inviteRole,
        invited_by: profile.id,
      }, { onConflict: 'company_id,email' })
    }
    if (inviteRole === 'team') {
      setInviteEmail('')
      setInviteRole('customer')
      setStep(4)
    } else {
      setStep(5)
    }
  }
  const steps = [
    {
      title: 'Your company is ready',
      body: (
        <div>
          <p className="text-sm mb-4">Five short steps: logo later in Users, add a trade to the directory, start a job, invite a trade, invite an owner.</p>
          <button type="button" className="w-full py-2.5 bg-black text-white rounded" onClick={() => setStep(1)}>Start</button>
        </div>
      ),
    },
    {
      title: 'Add a trade to the directory',
      body: (
        <form onSubmit={addContact} className="space-y-2">
          <input className={field} placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <input className={field} placeholder="Trade" value={trade} onChange={(e) => setTrade(e.target.value)} />
          <input className={field} placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <button type="submit" className="w-full py-2.5 bg-black text-white rounded text-sm">Save and continue</button>
          <button type="button" className="w-full text-xs underline" onClick={() => setStep(2)}>Skip</button>
        </form>
      ),
    },
    {
      title: 'Create the first job',
      body: (
        <div>
          <p className="text-sm mb-4">Use the + on Projects. Come back here after, or skip and add it later.</p>
          <button type="button" className="w-full py-2.5 bg-black text-white rounded text-sm mb-2" onClick={() => { onOpenNewProject?.(); setStep(3) }}>Go to new project</button>
          <button type="button" className="w-full text-xs underline" onClick={() => setStep(3)}>Skip</button>
        </div>
      ),
    },
    {
      title: 'Invite a trade',
      body: (
        <form onSubmit={invite} className="space-y-2">
          <input className={field} placeholder="Trade email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />
          <button type="submit" className="w-full py-2.5 bg-black text-white rounded text-sm">Invite trade</button>
          <button type="button" className="w-full text-xs underline" onClick={() => { setInviteRole('customer'); setStep(4) }}>Skip</button>
        </form>
      ),
    },
    {
      title: 'Invite a customer',
      body: (
        <form onSubmit={invite} className="space-y-2">
          <input className={field} placeholder="Customer email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />
          <button type="submit" className="w-full py-2.5 bg-black text-white rounded text-sm">Invite customer</button>
          <button type="button" className="w-full text-xs underline" onClick={() => setStep(5)}>Skip</button>
        </form>
      ),
    },
    {
      title: 'You are set',
      body: (
        <div>
          <p className="text-sm mb-4">Directory, estimates, this week, and invoices live in the menu and on each job. Logo and header color are under Users.</p>
          <button type="button" className="w-full py-2.5 bg-black text-white rounded text-sm" onClick={finish}>Open the app</button>
        </div>
      ),
    },
  ]
  const s = steps[step] || steps[0]
  return (
    <Page>
      <div className="text-[11px] font-mono uppercase text-[#6B6E72] mb-1">Setup {step + 1} of {steps.length}</div>
      <h2 className="font-display text-2xl mb-3">{s.title}</h2>
      {s.body}
    </Page>
  )
}
