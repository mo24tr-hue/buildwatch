import { useCallback, useEffect, useState } from 'react'
import { ChevronLeft, Building2, MessageSquare, Users, FolderKanban } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { FEEDBACK_EMAIL } from '../lib/platform'
import { fmtDateTime } from '../lib/styles'

export default function PlatformAdmin({ profile, onBack }) {
  const [tab, setTab] = useState('companies') // companies | feedback
  const [companies, setCompanies] = useState([])
  const [feedback, setFeedback] = useState([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('all') // all | new | reviewed | archived
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { data: comps, error: cErr } = await supabase
        .from('companies')
        .select('id, name, logo_url, created_at, header_color')
        .order('created_at', { ascending: false })
      if (cErr) throw cErr

      const list = comps || []
      // Enrich with counts (best-effort)
      const enriched = await Promise.all(
        list.map(async (c) => {
          const [{ count: users }, { count: projects }] = await Promise.all([
            supabase
              .from('profiles')
              .select('id', { count: 'exact', head: true })
              .eq('company_id', c.id),
            supabase
              .from('projects')
              .select('id', { count: 'exact', head: true })
              .eq('company_id', c.id),
          ])
          return { ...c, userCount: users || 0, projectCount: projects || 0 }
        })
      )
      setCompanies(enriched)

      const { data: fb, error: fErr } = await supabase
        .from('app_feedback')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200)
      if (fErr) {
        // Table may not exist yet
        console.warn(fErr)
        setFeedback([])
        if (/relation|does not exist|app_feedback/i.test(fErr.message || '')) {
          setError('Run platform-admin.sql in Supabase to enable feedback storage.')
        }
      } else {
        setFeedback(fb || [])
      }
    } catch (err) {
      console.error(err)
      setError(err.message || 'Could not load platform data. Run platform-admin.sql in Supabase.')
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const setFeedbackStatus = async (id, status) => {
    const { error: uErr } = await supabase
      .from('app_feedback')
      .update({ status, reviewed_at: status === 'new' ? null : new Date().toISOString() })
      .eq('id', id)
    if (uErr) {
      alert(uErr.message)
      return
    }
    setFeedback((prev) => prev.map((f) => (f.id === id ? { ...f, status, reviewed_at: status === 'new' ? null : new Date().toISOString() } : f)))
  }

  const filteredFeedback = feedback.filter((f) => {
    if (statusFilter !== 'all' && (f.status || 'new') !== statusFilter) return false
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      const hay = [f.message, f.email, f.company_name, f.user_role].filter(Boolean).join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })

  return (
    <div>
      <button type="button" onClick={onBack} className="flex items-center gap-1 text-sm text-[#6B6E72] mb-4">
        <ChevronLeft size={16} /> Back
      </button>
      <h2 className="font-display text-2xl mb-1">Platform</h2>
      <p className="text-xs text-[#6B6E72] mb-4">
        App-wide view · Feedback inbox: {FEEDBACK_EMAIL}
      </p>

      <div className="flex gap-2 mb-4">
        <button
          type="button"
          onClick={() => setTab('companies')}
          className={
            'flex-1 py-2 text-sm rounded border ' +
            (tab === 'companies' ? 'bg-black text-white border-black' : 'border-black')
          }
        >
          Companies ({companies.length})
        </button>
        <button
          type="button"
          onClick={() => setTab('feedback')}
          className={
            'flex-1 py-2 text-sm rounded border ' +
            (tab === 'feedback' ? 'bg-black text-white border-black' : 'border-black')
          }
        >
          Feedback ({feedback.filter((f) => (f.status || 'new') === 'new').length} new)
        </button>
      </div>

      {error && (
        <div className="mb-4 text-sm text-[#B5533C] border border-[#B5533C] rounded p-3 bg-[#FDF2F0]">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-[#6B6E72]">Loading…</p>
      ) : tab === 'companies' ? (
        <div className="space-y-2">
          {companies.length === 0 ? (
            <p className="text-sm text-[#6B6E72]">No companies yet.</p>
          ) : (
            companies.map((c) => (
              <div key={c.id} className="bg-white border border-black rounded-md p-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded bg-[#F5F5F5] flex items-center justify-center overflow-hidden flex-shrink-0">
                    {c.logo_url ? (
                      <img src={c.logo_url} alt="" className="w-full h-full object-contain" />
                    ) : (
                      <Building2 size={18} className="text-[#6B6E72]" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">{c.name || 'Untitled'}</div>
                    <div className="text-[11px] text-[#6B6E72] mt-0.5">
                      Created {c.created_at ? fmtDateTime(c.created_at) : '—'}
                    </div>
                    <div className="flex gap-3 mt-2 text-xs text-[#6B6E72]">
                      <span className="inline-flex items-center gap-1">
                        <Users size={12} /> {c.userCount} users
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <FolderKanban size={12} /> {c.projectCount} projects
                      </span>
                    </div>
                    <div className="text-[10px] font-mono text-[#9A9A9A] mt-1 truncate">{c.id}</div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      ) : (
        <div>
          <div className="flex flex-col sm:flex-row gap-2 mb-3">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search feedback…"
              className="flex-1 border border-black rounded px-3 py-2 text-sm"
            />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="border border-black rounded px-3 py-2 text-sm"
            >
              <option value="all">All</option>
              <option value="new">New</option>
              <option value="reviewed">Reviewed</option>
              <option value="archived">Archived</option>
            </select>
          </div>
          {filteredFeedback.length === 0 ? (
            <p className="text-sm text-[#6B6E72]">No feedback matches.</p>
          ) : (
            <div className="space-y-2">
              {filteredFeedback.map((f) => (
                <div key={f.id} className="bg-white border border-black rounded-md p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <MessageSquare size={14} className="flex-shrink-0 text-[#6B6E72]" />
                      <div className="text-xs text-[#6B6E72] truncate">
                        {f.email || 'Unknown'}
                        {f.company_name ? ` · ${f.company_name}` : ''}
                        {f.user_role ? ` · ${f.user_role}` : ''}
                      </div>
                    </div>
                    <span
                      className={
                        'text-[10px] font-mono uppercase px-1.5 py-0.5 rounded flex-shrink-0 ' +
                        ((f.status || 'new') === 'new'
                          ? 'bg-[#FFF8DB] text-[#8A6D00]'
                          : (f.status || '') === 'archived'
                            ? 'bg-[#E9E9E7] text-[#6B6E72]'
                            : 'bg-[#E4EEF5] text-[#2F6690]')
                      }
                    >
                      {f.status || 'new'}
                    </span>
                  </div>
                  <p className="text-sm mt-2 whitespace-pre-wrap">{f.message}</p>
                  <div className="text-[11px] text-[#6B6E72] mt-2">
                    {f.created_at ? fmtDateTime(f.created_at) : ''}
                  </div>
                  <div className="flex flex-wrap gap-2 mt-3">
                    {(f.status || 'new') === 'new' && (
                      <button
                        type="button"
                        className="text-xs px-2 py-1 border border-black rounded"
                        onClick={() => setFeedbackStatus(f.id, 'reviewed')}
                      >
                        Mark reviewed
                      </button>
                    )}
                    {(f.status || '') !== 'archived' && (
                      <button
                        type="button"
                        className="text-xs px-2 py-1 border border-black rounded"
                        onClick={() => setFeedbackStatus(f.id, 'archived')}
                      >
                        Archive
                      </button>
                    )}
                    {(f.status || '') !== 'new' && (
                      <button
                        type="button"
                        className="text-xs px-2 py-1 border border-[#E5E5E5] rounded text-[#6B6E72]"
                        onClick={() => setFeedbackStatus(f.id, 'new')}
                      >
                        Mark new
                      </button>
                    )}
                    {f.email && (
                      <a
                        href={`mailto:${f.email}?subject=${encodeURIComponent('Re: BuildWatch feedback')}`}
                        className="text-xs px-2 py-1 border border-black rounded"
                      >
                        Reply by email
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
