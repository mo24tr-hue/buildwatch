import { useEffect, useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, Plus, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { STYLES, fmtDate } from '../lib/styles'
import SwipeBack from './SwipeBack'
import PlanEditor from './PlanEditor'

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

function Page({ children, onBack }) {
  const inner = <div className="w-full max-w-full min-w-0 overflow-x-hidden box-border">{children}</div>
  if (!onBack) return inner
  return <SwipeBack onBack={onBack}>{inner}</SwipeBack>
}

function Back({ onBack, title }) {
  if (!onBack) {
    return <h2 className="font-display text-xl mb-3 min-w-0">{title}</h2>
  }
  return (
    <div className="mb-4 min-w-0">
      <button type="button" onClick={onBack} className="flex items-center gap-1 text-sm text-[#6B6E72] mb-2">
        <ChevronLeft size={16} /> Back
      </button>
      <h2 className="font-display text-2xl truncate">{title}</h2>
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
  const [openContact, setOpenContact] = useState(null)
  const [form, setForm] = useState({ name: '', kind: 'trade', trade: '', phone: '', email: '', insurance_expires: '', notes: '' })
  const load = async () => {
    const { data } = await supabase.from('directory_contacts').select('*').eq('company_id', profile.company_id).order('name')
    setRows(data || [])
  }
  useEffect(() => { load() }, [profile.company_id])
  const add = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) return
    const { error } = await supabase.from('directory_contacts').insert({
      company_id: profile.company_id,
      name: form.name.trim(),
      kind: form.kind === 'customer' ? 'customer' : 'trade',
      trade: form.trade || null,
      phone: form.phone || null,
      email: form.email || null,
      insurance_expires: form.insurance_expires || null,
      notes: form.notes || null,
    })
    if (error) {
      alert(error.message || 'Could not save contact')
      return
    }
    setForm({ name: '', kind: 'trade', trade: '', phone: '', email: '', insurance_expires: '', notes: '' })
    load()
  }
  const remove = async (id) => {
    await supabase.from('directory_contacts').delete().eq('id', id)
    load()
  }
  return (
    <Page onBack={onBack}>
      <Back onBack={onBack} title="Directory" />
      <form onSubmit={add} className="w-full max-w-full min-w-0 box-border border border-black rounded-md p-3 space-y-2 mb-4">
        <input className={field} placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <div className="grid grid-cols-2 gap-2 min-w-0">
          <select className={field} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
            <option value="trade">Trade</option>
            <option value="customer">Customer</option>
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
            <button key={r.id} type="button" className="w-full text-left max-w-full min-w-0 box-border border border-black rounded-md p-3" onClick={() => setOpenContact(r)}>
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
                <button type="button" onClick={(e) => { e.stopPropagation(); remove(r.id) }} className="p-1"><Trash2 size={14} /></button>
              </div>
            </button>
          )
        })}
        {!rows.length && <p className="text-sm text-[#6B6E72]">No contacts yet.</p>}
      </div>
      {openContact && createPortal(
        <div className="fixed inset-0 z-[300] bg-black/40 flex items-end" onClick={() => setOpenContact(null)}>
          <div className="w-full bg-white rounded-t-2xl p-4 space-y-2 max-h-[80vh] overflow-y-auto" style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }} onClick={(e) => e.stopPropagation()}>
            <div className="font-display text-xl mb-1">{openContact.name}</div>
            {openContact.phone && <a className="block w-full py-3 border border-black rounded text-center text-sm" href={'tel:' + String(openContact.phone).replace(/[^\d+]/g, '')}>Call</a>}
            {openContact.phone && <a className="block w-full py-3 border border-black rounded text-center text-sm" href={'sms:' + String(openContact.phone).replace(/[^\d+]/g, '')}>Message</a>}
            {openContact.phone && <a className="block w-full py-3 border border-black rounded text-center text-sm" href={'https://wa.me/' + String(openContact.phone).replace(/[^\d]/g, '')}>WhatsApp message</a>}
            {openContact.phone && <a className="block w-full py-3 border border-black rounded text-center text-sm" href={'https://wa.me/' + String(openContact.phone).replace(/[^\d]/g, '')}>WhatsApp call</a>}
            {openContact.email && <a className="block w-full py-3 border border-black rounded text-center text-sm" href={'mailto:' + openContact.email}>Email</a>}
            {!openContact.phone && !openContact.email && <p className="text-sm text-[#6B6E72]">No phone or email on this contact.</p>}
            <button type="button" className="w-full py-3 text-sm border border-black rounded" onClick={() => setOpenContact(null)}>Close</button>
          </div>
        </div>,
        document.body
      )}
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
    <Page onBack={onBack}>
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

export function InspectionsPage({ project, profile, isAdmin, onBack }) {
  const [rows, setRows] = useState([])
  const [photos, setPhotos] = useState([])
  const [uploading, setUploading] = useState(false)
  const [form, setForm] = useState({ title: '', inspection_on: '', notes: '' })
  const [noteDraft, setNoteDraft] = useState({})
  const [lb, setLb] = useState(null)
  const [undoRow, setUndoRow] = useState(null)
  const undoRef = useRef(null)

  const load = async () => {
    const { data } = await supabase.from('permits').select('*').eq('project_id', project.id).order('inspection_on', { ascending: true })
    setRows(data || [])
    const { data: ph } = await supabase.from('permit_photos').select('*').eq('project_id', project.id).order('created_at', { ascending: false })
    setPhotos(ph || [])
  }
  useEffect(() => { load() }, [project.id])

  const add = async (e) => {
    e.preventDefault()
    if (!isAdmin || !form.title.trim() || !form.inspection_on) return
    await supabase.from('permits').insert({
      company_id: profile.company_id,
      project_id: project.id,
      title: form.title.trim(),
      inspection_on: form.inspection_on,
      notes: form.notes || null,
      result: 'pending',
    })
    setForm({ title: '', inspection_on: '', notes: '' })
    load()
  }

  const setResult = async (id, result) => {
    await supabase.from('permits').update({ result }).eq('id', id)
    load()
  }

  const saveNotes = async (id) => {
    await supabase.from('permits').update({ notes: noteDraft[id] ?? '' }).eq('id', id)
    load()
  }

  const removeInspection = async (row) => {
    setUndoRow(row)
    setRows((cur) => cur.filter((x) => x.id !== row.id))
    if (undoRef.current) clearTimeout(undoRef.current)
    undoRef.current = setTimeout(async () => {
      await supabase.from('permits').delete().eq('id', row.id)
      setUndoRow(null)
    }, 5000)
  }

  const uploadPhoto = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !isAdmin) return
    setUploading(true)
    try {
      const safe = (file.name || 'permit.jpg').replace(/[^a-zA-Z0-9._-]/g, '_')
      const path = profile.company_id + '/' + project.id + '/permits/' + Date.now() + '-' + safe
      const { error: upErr } = await supabase.storage.from('project-photos').upload(path, file, { upsert: true })
      if (upErr) throw upErr
      const { data: pub } = supabase.storage.from('project-photos').getPublicUrl(path)
      const { error: insErr } = await supabase.from('permit_photos').insert({
        company_id: profile.company_id,
        project_id: project.id,
        public_url: pub.publicUrl,
        storage_path: path,
        file_name: file.name,
      })
      if (insErr) throw insErr
      load()
    } catch (err) {
      alert(err.message || 'Upload failed')
    }
    setUploading(false)
  }

  const removePhoto = async (p) => {
    if (p.storage_path) await supabase.storage.from('project-photos').remove([p.storage_path])
    await supabase.from('permit_photos').delete().eq('id', p.id)
    load()
  }

  return (
    <Page onBack={onBack}>
      <button type="button" onClick={onBack} className="flex items-center gap-1 text-sm text-[#6B6E72] mb-2">
        <ChevronLeft size={16} /> {project.address}
      </button>
      <h2 className="font-display text-xl mb-3">Inspections</h2>
      {isAdmin && (
        <form onSubmit={add} className="w-full max-w-full min-w-0 box-border border border-black rounded-md p-3 space-y-2 mb-4">
          <input className={field} placeholder="Inspection (plumbing, electrical, final…)" value={form.title} onChange={(e) => { setForm({ ...form, title: e.target.value }); if (typeof window !== 'undefined') window.__bwDirty = true }} />
          <div className="w-full min-w-0 overflow-hidden">
            <div className="text-[11px] font-mono uppercase text-[#6B6E72] mb-1">Scheduled</div>
            <input
              type="date"
              className={field}
              value={form.inspection_on}
              onChange={(e) => setForm({ ...form, inspection_on: e.target.value })}
            />
          </div>
          <textarea className={field} rows={2} placeholder="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          <button type="submit" className="w-full py-2.5 bg-black text-white rounded text-sm">Add inspection</button>
        </form>
      )}
      <div className="space-y-2 mb-8">
        {rows.map((r) => (
          <div key={r.id} className="w-full max-w-full min-w-0 box-border border border-black rounded-md p-3 text-sm">
            <div className="flex justify-between gap-2 items-start">
              <div>
                <div className="font-medium">{r.title}</div>
                <div className="text-xs text-[#6B6E72] mt-0.5">{fmtDate(r.inspection_on)}</div>
              </div>
              {isAdmin && (
                <button type="button" className="text-[#B5533C] p-1 flex-shrink-0" onClick={() => removeInspection(r)}>
                  <Trash2 size={14} />
                </button>
              )}
            </div>
            {isAdmin ? (
              <div className="flex gap-2 mt-2 flex-wrap">
                <button type="button" onClick={() => setResult(r.id, 'pending')} className={`px-2 py-1 text-xs border rounded ${r.result === 'pending' ? 'bg-[#6B6E72] text-white border-[#6B6E72]' : 'border-black'}`}>Pending</button>
                <button type="button" onClick={() => setResult(r.id, 'pass')} className={`px-2 py-1 text-xs border rounded ${r.result === 'pass' ? 'bg-[#3F7D58] text-white border-[#3F7D58]' : 'border-[#3F7D58] text-[#3F7D58]'}`}>Passed</button>
                <button type="button" onClick={() => setResult(r.id, 'fail')} className={`px-2 py-1 text-xs border rounded ${r.result === 'fail' ? 'bg-[#B5533C] text-white border-[#B5533C]' : 'border-[#B5533C] text-[#B5533C]'}`}>Failed</button>
              </div>
            ) : (
              <div className="text-xs uppercase mt-1">{r.result === 'pass' ? 'Passed' : r.result === 'fail' ? 'Failed' : 'Pending'}</div>
            )}
            {isAdmin ? (
              <div className="mt-2 space-y-2">
                <textarea
                  className={field}
                  rows={2}
                  placeholder="Notes"
                  value={noteDraft[r.id] ?? r.notes ?? ''}
                  onChange={(e) => setNoteDraft((d) => ({ ...d, [r.id]: e.target.value }))}
                />
                <button type="button" className="text-xs underline" onClick={() => saveNotes(r.id)}>Save notes</button>
              </div>
            ) : (
              r.notes ? <div className="text-xs mt-2 whitespace-pre-wrap">{r.notes}</div> : null
            )}
          </div>
        ))}
        {undoRow && (
          <div className="border border-black rounded px-3 py-2 text-sm flex justify-between">
            <span>Inspection removed</span>
            <button type="button" className="underline" onClick={() => { if (undoRef.current) clearTimeout(undoRef.current); setRows((cur) => [undoRow, ...cur]); setUndoRow(null) }}>Undo</button>
          </div>
        )}
        {!rows.length && <p className="text-sm text-[#6B6E72]">No inspections scheduled. Add one above.</p>}
      </div>

      <h3 className="font-display text-xl mb-3">Permits</h3>
      {isAdmin && (
        <label className="w-full flex items-center justify-center gap-1.5 text-sm border border-black rounded px-3 py-2 cursor-pointer mb-3">
          {uploading ? 'Uploading…' : 'Upload permit photo'}
          <input type="file" accept="image/*" className="hidden" disabled={uploading} onChange={uploadPhoto} />
        </label>
      )}
      <div className="grid grid-cols-2 gap-2">
        {photos.map((p) => (
          <div key={p.id} className="border border-black rounded overflow-hidden">
            <button type="button" className="w-full" onClick={() => setLb(p)}>
              <img src={p.public_url} alt="" className="w-full h-36 object-cover" />
            </button>
            {isAdmin && (
              <button type="button" className="w-full text-xs py-1.5 text-[#B5533C]" onClick={() => removePhoto(p)}>Delete</button>
            )}
          </div>
        ))}
      </div>
      {!photos.length && <p className="text-sm text-[#6B6E72]">No permit photos yet. Upload one above.</p>}
      {lb && (
        <div className="fixed inset-0 z-50 bg-black/90 flex flex-col" onClick={() => setLb(null)}>
          <div className="flex justify-end px-4 py-3 text-white">
            <button type="button" onClick={() => setLb(null)}>Close</button>
          </div>
          <div className="flex-1 flex items-center justify-center px-2">
            <img src={lb.public_url} alt="" className="max-h-full max-w-full object-contain" onClick={(e) => e.stopPropagation()} />
          </div>
        </div>
      )}
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
    <Page onBack={onBack}>
      <Back onBack={onBack} title="Invoices" />
      {isAdmin && (
        <form onSubmit={add} className="w-full max-w-full min-w-0 box-border border border-black rounded-md p-3 space-y-2 mb-4">
          <input className={field} placeholder="Title" value={form.title} onChange={(e) => { setForm({ ...form, title: e.target.value }); if (typeof window !== 'undefined') window.__bwDirty = true }} />
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
    const phases = (p.phases || []).filter((ph) => {
      if (ph.start_date && days.includes(ph.start_date)) return true
      if (ph.end_date && days.includes(ph.end_date)) return true
      return false
    })
    return { p, phases }
  }).filter((r) => r.phases.length)
  return (
    <Page onBack={hideBack ? undefined : onBack}>
      {!hideBack && <Back onBack={onBack} title="This week" />}
      {hideBack && (
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-2xl">This week</h2>
          {onBack && <button type="button" className="text-sm underline" onClick={onBack}>Done</button>}
        </div>
      )}
      <div className="space-y-3">
        {rows.map(({ p, phases }) => (
          <button key={p.id} type="button" className="w-full max-w-full min-w-0 box-border text-left border border-black rounded-md p-3" onClick={() => onOpenProject?.(p.id)}>
            <div className="font-medium text-sm">{p.address}</div>
            {phases.map((ph) => (
              <div key={ph.id} className="text-xs mt-1">
                {ph.name} · {ph.start_date && days.includes(ph.start_date) ? 'starts ' + fmtDate(ph.start_date) : 'ends ' + fmtDate(ph.end_date)}
              </div>
            ))}
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
  const [openId, setOpenId] = useState(null)
  const [lines, setLines] = useState([])
  const [newPhase, setNewPhase] = useState('')
  const [overhead, setOverhead] = useState('')
  const load = async () => {
    const { data, error } = await supabase.from('estimates').select('*').eq('company_id', profile.company_id).order('created_at', { ascending: false })
    if (error) alert(error.message)
    setRows(data || [])
  }
  const loadLines = async (id) => {
    const { data } = await supabase.from('estimate_lines').select('*').eq('estimate_id', id).order('sort_order')
    setLines(data || [])
    const oh = (data || []).find((l) => /^overhead$/i.test(l.label || ''))
    setOverhead(oh?.amount != null ? String(oh.amount) : '')
  }
  useEffect(() => { load() }, [profile.company_id])
  const add = async (e) => {
    e.preventDefault()
    if (!title.trim()) return
    const { error } = await supabase.from('estimates').insert({
      company_id: profile.company_id,
      title: title.trim(),
      address: address.trim() || null,
      style,
      status: 'draft',
    })
    if (error) {
      alert(error.message || 'Could not create estimate')
      return
    }
    const { data } = await supabase.from('estimates').select('*').eq('company_id', profile.company_id).order('created_at', { ascending: false }).limit(1)
    const created = data?.[0]
    if (!created) {
      alert('Estimate saved, but it did not reload. Close and open Estimates.')
      load()
      return
    }
    const names = (STYLES[style] || STYLES.remodel).phases
    if (names.length) {
      const { error: lineErr } = await supabase.from('estimate_lines').insert(names.map((name, i) => ({
        estimate_id: created.id,
        label: name,
        amount: null,
        sort_order: i,
      })))
      if (lineErr) alert(lineErr.message || 'Estimate saved, but phases did not.')
    }
    setTitle('')
    setAddress('')
    setOpenId(created.id)
    load()
    loadLines(created.id)
  }
  const setAmount = async (row, value) => {
    const amount = value === '' ? null : Number(value)
    setLines((list) => list.map((l) => (l.id === row.id ? { ...l, amount } : l)))
    await supabase.from('estimate_lines').update({ amount }).eq('id', row.id)
  }
  const addPhaseLine = async (e) => {
    e.preventDefault()
    if (!openId || !newPhase.trim()) return
    await supabase.from('estimate_lines').insert({
      estimate_id: openId,
      label: newPhase.trim(),
      amount: null,
      sort_order: lines.length,
    })
    setNewPhase('')
    loadLines(openId)
  }
  const saveOverhead = async () => {
    if (!openId) return
    const amount = overhead === '' ? null : Number(overhead)
    const existing = lines.find((l) => /^overhead$/i.test(l.label || ''))
    if (existing) {
      await supabase.from('estimate_lines').update({ amount }).eq('id', existing.id)
    } else {
      await supabase.from('estimate_lines').insert({ estimate_id: openId, label: 'Overhead', amount, sort_order: 1000 })
    }
    loadLines(openId)
  }
  const removeLine = async (id) => {
    await supabase.from('estimate_lines').delete().eq('id', id)
    loadLines(openId)
  }
  const removeEstimate = async (est) => {
    if (!confirm('Delete this estimate?')) return
    await supabase.from('estimate_lines').delete().eq('estimate_id', est.id)
    await supabase.from('estimates').delete().eq('id', est.id)
    setOpenId(null)
    load()
  }
  const convert = async (est) => {
    const { data: linesData } = await supabase.from('estimate_lines').select('*').eq('estimate_id', est.id)
    const phaseLines = (linesData || []).filter((l) => !/^overhead$/i.test(l.label || ''))
    const total = phaseLines.reduce((s, l) => s + (Number(l.amount) || 0), 0)
    const styleKey = STYLES[est.style] ? est.style : 'remodel'
    const { data: project, error } = await supabase.from('projects').insert({
      company_id: profile.company_id,
      address: est.address || est.title,
      style: styleKey,
      status: 'planning',
      base_cost: total || null,
    }).select().single()
    if (error || !project) {
      alert(error?.message || 'Could not create project')
      return
    }
    const { data: phases } = await supabase.from('phases').insert(phaseLines.map((l, i) => ({
      project_id: project.id,
      name: l.label,
      sort_order: i,
      status: 'pending',
    }))).select()
    for (const l of phaseLines) {
      const ph = (phases || []).find((p) => p.name === l.label)
      if (!ph || l.amount == null) continue
      await supabase.from('project_job_costs').insert({
        project_id: project.id,
        company_id: profile.company_id,
        phase_id: ph.id,
        kind: 'phase',
        quoted_amount: Number(l.amount),
        amount: Number(l.amount),
      })
    }
    const oh = (linesData || []).find((l) => /^overhead$/i.test(l.label || ''))
    if (oh?.amount) {
      await supabase.from('project_job_costs').insert({
        project_id: project.id,
        company_id: profile.company_id,
        kind: 'overhead',
        amount: Number(oh.amount),
        note: 'Overhead from estimate',
      })
    }
    await supabase.from('estimates').update({ status: 'converted', project_id: project.id }).eq('id', est.id)
    load()
    onOpenProject?.(project.id)
  }
  const open = rows.find((r) => r.id === openId)
  const phaseLines = lines.filter((l) => !/^overhead$/i.test(l.label || ''))
  const phaseTotal = phaseLines.reduce((s, l) => s + (Number(l.amount) || 0), 0)
  const ohAmt = Number(overhead) || 0
  const profit = phaseTotal - ohAmt
  if (open) {
    return (
      <Page onBack={() => setOpenId(null)}>
        <Back onBack={() => setOpenId(null)} title={open.title} />
        <div className="text-xs text-[#6B6E72] mb-3">{open.address || 'No address'} · {STYLES[open.style]?.label || open.style}</div>
        <div className="space-y-2 mb-4">
          {phaseLines.map((l) => (
            <div key={l.id} className="border border-black rounded-md p-3">
              <div className="flex justify-between gap-2 items-center">
                <div className="text-sm font-medium truncate">{l.label}</div>
                <button type="button" className="text-[#B5533C]" onClick={() => removeLine(l.id)}><Trash2 size={14} /></button>
              </div>
              <input className={field + ' mt-2'} inputMode="decimal" placeholder="Rough cost" value={l.amount ?? ''} onChange={(e) => setAmount(l, e.target.value)} />
            </div>
          ))}
        </div>
        {open.status !== 'converted' && (
          <form onSubmit={addPhaseLine} className="flex gap-2 mb-4">
            <input className={'flex-1 ' + field} placeholder="Add phase" value={newPhase} onChange={(e) => setNewPhase(e.target.value)} />
            <button type="submit" className="px-3 border border-black rounded"><Plus size={14} /></button>
          </form>
        )}
        <div className="border border-black rounded-md p-3 space-y-2 mb-4">
          <label className="block text-[11px] font-mono uppercase text-[#6B6E72]">Overhead</label>
          <input className={field} inputMode="decimal" placeholder="Insurance, license, fees" value={overhead} onChange={(e) => setOverhead(e.target.value)} onBlur={saveOverhead} />
          <div className="flex justify-between text-sm"><span>Phase costs</span><span>{money(phaseTotal)}</span></div>
          <div className="flex justify-between text-sm"><span>Overhead</span><span>{money(ohAmt)}</span></div>
          <div className="flex justify-between text-sm font-medium border-t border-black/20 pt-2"><span>Estimated profit</span><span>{money(profit)}</span></div>
        </div>
        {open.status !== 'converted' && (
          <div className="space-y-2">
            <button type="button" className="w-full py-2.5 bg-black text-white rounded text-sm" onClick={() => convert(open)}>Turn into project</button>
            <button type="button" className="w-full py-2.5 border border-black rounded text-sm" onClick={() => removeEstimate(open)}>Delete estimate</button>
          </div>
        )}
      </Page>
    )
  }
  return (
    <Page onBack={onBack}>
      <div className="mb-4">
        <button type="button" onClick={onBack} className="flex items-center gap-1 text-sm text-[#6B6E72] mb-2">
          <ChevronLeft size={16} /> Back
        </button>
        <h2 className="font-display text-2xl">Estimates</h2>
      </div>
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
          <button key={r.id} type="button" className="w-full text-left border border-black rounded-md p-3" onClick={() => { setOpenId(r.id); loadLines(r.id) }}>
            <div className="font-medium text-sm">{r.title}</div>
            <div className="text-xs text-[#6B6E72]">{r.address || ''} · {r.status}</div>
          </button>
        ))}
      </div>
    </Page>
  )
}
export function PlanMarkupPage({ project, profile, isAdmin, onBack }) {
  return (
    <Page onBack={onBack}>
      <Back onBack={onBack} title="Plans" />
      <PlanEditor project={project} profile={profile} isAdmin={isAdmin} />
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
    <Page onBack={onBack}>
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
    <Page onBack={onBack}>
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
      <div className="flex justify-between items-center mb-3">
        <div className="text-[11px] font-mono uppercase text-[#6B6E72]">Setup {step + 1} of {steps.length}</div>
        <button type="button" className="text-sm underline" onClick={finish}>Exit</button>
      </div>
      <h2 className="font-display text-2xl mb-3">{s.title}</h2>
      {s.body}
    </Page>
  )
}
