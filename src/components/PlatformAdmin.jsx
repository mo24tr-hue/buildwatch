import { useCallback, useEffect, useState } from 'react'
import { Building2, MessageSquare, Users, FolderKanban, LogOut, RefreshCw, ChevronLeft, MapPin } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { FEEDBACK_EMAIL } from '../lib/platform'
import { fmtDateTime } from '../lib/styles'

const DEMO_COMPANY = {
  name: 'Acme Builders (Demo)',
  email: 'contractor@acme-demo.local',
}

const DEMO_PROJECTS = [
  {
    id: 'demo-1',
    address: '142 Maple Street',
    style: 'Remodel',
    status: 'In progress',
    statusColor: '#E8622C',
    done: 5,
    total: 11,
    base: 98000,
    paid: 40000,
    cos: 4500,
    phases: [
      { name: 'Demo', status: 'done' },
      { name: 'Framing', status: 'done' },
      { name: 'Electrical', status: 'done' },
      { name: 'Insulation', status: 'done' },
      { name: 'Drywall', status: 'done' },
      { name: 'Paint', status: 'active' },
      { name: 'Flooring', status: 'pending' },
      { name: 'Finishings', status: 'pending' },
    ],
    changeOrders: [
      { title: 'Foundation waterproofing', amount: 2500, status: 'Approved' },
      { title: 'Upgrade to quartz counters', amount: 2000, status: 'Approved' },
    ],
  },
  {
    id: 'demo-2',
    address: '88 Oak Avenue',
    style: 'Addition',
    status: 'In progress',
    statusColor: '#E8622C',
    done: 9,
    total: 14,
    base: 210000,
    paid: 120000,
    cos: 8500,
    phases: [
      { name: 'Excavation', status: 'done' },
      { name: 'Foundation', status: 'done' },
      { name: 'Framing', status: 'done' },
      { name: 'Roofing', status: 'active' },
      { name: 'Electrical', status: 'pending' },
    ],
    changeOrders: [{ title: 'Extra egress window', amount: 3200, status: 'Offer sent' }],
  },
  {
    id: 'demo-3',
    address: '21 Birch Lane',
    style: 'Kitchen',
    status: 'Complete',
    statusColor: '#3F7D58',
    done: 8,
    total: 8,
    base: 42000,
    paid: 42000,
    cos: 0,
    phases: [
      { name: 'Demo', status: 'done' },
      { name: 'Cabinets', status: 'done' },
      { name: 'Countertops', status: 'done' },
      { name: 'Appliances', status: 'done' },
    ],
    changeOrders: [],
  },
]

function money(n) {
  if (n == null || Number.isNaN(Number(n))) return '—'
  return '$' + Number(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

/**
 * Platform owner screen: companies, feedback, and isolated mock company for demos.
 * Mock data never touches real company workspaces.
 */
export default function PlatformAdmin({ profile, session, onLogout }) {
  const [tab, setTab] = useState('companies') // companies | feedback | demo
  const [companies, setCompanies] = useState([])
  const [feedback, setFeedback] = useState([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [demoProjectId, setDemoProjectId] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { data: comps, error: cErr } = await supabase
        .from('companies')
        .select('id, name, logo_url, created_at')
        .order('created_at', { ascending: false })
      if (cErr) throw cErr

      const list = comps || []
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
        .limit(300)
      if (fErr) {
        console.warn(fErr)
        setFeedback([])
        if (/relation|does not exist|app_feedback/i.test(fErr.message || '')) {
          setError('Feedback table missing — re-run platform-admin.sql in Supabase.')
        } else {
          setError(fErr.message)
        }
      } else {
        setFeedback(fb || [])
      }
    } catch (err) {
      console.error(err)
      setError(err.message || 'Could not load platform data. Check platform-admin.sql policies.')
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const setFeedbackStatus = async (id, status) => {
    const { error: uErr } = await supabase
      .from('app_feedback')
      .update({
        status,
        reviewed_at: status === 'new' ? null : new Date().toISOString(),
      })
      .eq('id', id)
    if (uErr) {
      alert(uErr.message)
      return
    }
    setFeedback((prev) =>
      prev.map((f) =>
        f.id === id
          ? { ...f, status, reviewed_at: status === 'new' ? null : new Date().toISOString() }
          : f
      )
    )
  }

  const filteredFeedback = feedback.filter((f) => {
    if (statusFilter !== 'all' && (f.status || 'new') !== statusFilter) return false
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      const hay = [f.message, f.email, f.company_name, f.user_role]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })

  const newCount = feedback.filter((f) => (f.status || 'new') === 'new').length
  const email = profile?.email || session?.user?.email || ''
  const demoProject = DEMO_PROJECTS.find((p) => p.id === demoProjectId) || null

  return (
    <div className="min-h-screen bg-white">
      <header
        className="text-white sticky top-0 z-50 bg-black"
        style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}
      >
        <div className="max-w-2xl mx-auto px-4">
          <div className="flex items-center justify-between gap-3 pb-2">
            <div className="min-w-0">
              <div className="font-display text-base tracking-wide">BuildWatch Platform</div>
              <div className="text-[10px] text-white/50 truncate">{email}</div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={load}
                className="p-2 border border-white/30 rounded hover:bg-white/10"
                aria-label="Refresh"
              >
                <RefreshCw size={16} />
              </button>
              <button
                type="button"
                onClick={onLogout}
                className="flex items-center gap-1.5 px-3 py-2 border border-white/30 rounded text-sm hover:bg-white/10"
              >
                <LogOut size={14} /> Log out
              </button>
            </div>
          </div>
          <nav className="flex border-t border-white/15" aria-label="Platform menu">
            <button
              type="button"
              onClick={() => { setTab('companies'); setDemoProjectId(null) }}
              className={
                'flex-1 py-3 text-sm font-medium border-b-2 transition-colors ' +
                (tab === 'companies'
                  ? 'border-[#E6B800] text-white'
                  : 'border-transparent text-white/50 hover:text-white/80')
              }
            >
              Companies
              <span className="ml-1 text-white/40">({companies.length})</span>
            </button>
            <button
              type="button"
              onClick={() => { setTab('feedback'); setDemoProjectId(null) }}
              className={
                'flex-1 py-3 text-sm font-medium border-b-2 transition-colors ' +
                (tab === 'feedback'
                  ? 'border-[#E6B800] text-white'
                  : 'border-transparent text-white/50 hover:text-white/80')
              }
            >
              Feedback
              {newCount > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-full bg-[#E6B800] text-black text-[10px] font-mono">
                  {newCount}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => { setTab('demo'); setDemoProjectId(null) }}
              className={
                'flex-1 py-3 text-sm font-medium border-b-2 transition-colors ' +
                (tab === 'demo'
                  ? 'border-[#E6B800] text-white'
                  : 'border-transparent text-white/50 hover:text-white/80')
              }
            >
              Demo
            </button>
          </nav>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-5">
        {error && (
          <div className="mb-4 text-sm text-[#B5533C] border border-[#B5533C] rounded p-3 bg-[#FDF2F0]">
            {error}
          </div>
        )}

        {loading && tab !== 'demo' ? (
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
                      <div className="flex gap-4 mt-2 text-sm text-[#6B6E72]">
                        <span className="inline-flex items-center gap-1">
                          <Users size={14} /> {c.userCount} user{c.userCount !== 1 ? 's' : ''}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <FolderKanban size={14} /> {c.projectCount} project
                          {c.projectCount !== 1 ? 's' : ''}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        ) : tab === 'feedback' ? (
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
              <p className="text-sm text-[#6B6E72]">
                No feedback yet. Users send it from ☰ → Send feedback.
              </p>
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
                    </div>
                  </div>
                ))}
              </div>
            )}
            <p className="text-[11px] text-[#6B6E72] mt-4">
              Feedback also goes to {FEEDBACK_EMAIL || 'buildwatchfeedback@gmail.com'}.
            </p>
          </div>
        ) : (
          /* Demo mock company — local only, never writes to real companies */
          <div>
            <div className="mb-4 border border-black rounded-md p-4 bg-[#FAFAFA]">
              <div className="font-display text-lg">{DEMO_COMPANY.name}</div>
              <div className="text-xs text-[#6B6E72] mt-1">
                Showcase workspace · fake data only · does not touch real companies
              </div>
            </div>

            {!demoProject ? (
              <div className="space-y-2">
                <p className="text-sm text-[#6B6E72] mb-2">
                  Open a mock project for screenshots or walkthroughs.
                </p>
                {DEMO_PROJECTS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setDemoProjectId(p.id)}
                    className="w-full text-left bg-white border border-black rounded-md p-4 hover:border-[#E6B800]"
                  >
                    <div className="flex justify-between items-start gap-2">
                      <div>
                        <div className="font-medium flex items-center gap-1.5">
                          <MapPin size={14} className="text-[#6B6E72]" />
                          {p.address}
                        </div>
                        <div className="text-xs text-[#6B6E72] mt-1">
                          {p.style} · {p.done} of {p.total} phases
                        </div>
                      </div>
                      <span
                        className="text-[10px] font-mono uppercase px-2 py-0.5 rounded"
                        style={{ background: p.statusColor + '22', color: p.statusColor }}
                      >
                        {p.status}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div>
                <button
                  type="button"
                  onClick={() => setDemoProjectId(null)}
                  className="flex items-center gap-1 text-sm text-[#6B6E72] mb-4"
                >
                  <ChevronLeft size={16} /> All demo projects
                </button>
                <div className="bg-white border border-black rounded-md p-5 mb-4">
                  <div className="text-sm font-semibold">{demoProject.style}</div>
                  <h2 className="font-display text-2xl flex items-center gap-1.5 mt-1">
                    <MapPin size={16} className="text-[#6B6E72]" />
                    {demoProject.address}
                  </h2>
                  <div className="text-[11px] font-mono text-[#6B6E72] mt-2">
                    {demoProject.done} of {demoProject.total} phases complete
                  </div>
                  <div className="h-2 rounded-full bg-[#E9E9E7] overflow-hidden mt-2">
                    <div
                      className="h-full bg-[#3F7D58]"
                      style={{ width: `${(demoProject.done / demoProject.total) * 100}%` }}
                    />
                  </div>
                </div>

                <div className="bg-white border border-black rounded-md p-4 mb-4 space-y-2 text-sm">
                  <div className="text-[11px] font-mono uppercase text-[#6B6E72]">Cost of construction</div>
                  <div className="flex justify-between">
                    <span className="text-[#6B6E72]">Original contract</span>
                    <span>{money(demoProject.base)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#6B6E72]">Approved change orders</span>
                    <span>{money(demoProject.cos)}</span>
                  </div>
                  <div className="flex justify-between font-medium border-t border-black/10 pt-2">
                    <span>Total</span>
                    <span>{money(demoProject.base + demoProject.cos)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#6B6E72]">Paid</span>
                    <span className="text-[#3F7D58]">{money(demoProject.paid)}</span>
                  </div>
                  <div className="flex justify-between font-medium">
                    <span className="text-[#6B6E72]">Remaining</span>
                    <span className="text-[#B5533C]">
                      {money(demoProject.base + demoProject.cos - demoProject.paid)}
                    </span>
                  </div>
                </div>

                <div className="space-y-2 mb-4">
                  <div className="text-[11px] font-mono uppercase text-[#6B6E72]">Phases</div>
                  {demoProject.phases.map((ph, i) => (
                    <div
                      key={ph.name}
                      className="bg-white border border-black rounded-md flex overflow-hidden"
                    >
                      <div
                        className="w-9 flex items-center justify-center font-mono text-xs text-white"
                        style={{
                          background:
                            ph.status === 'done'
                              ? '#3F7D58'
                              : ph.status === 'active'
                                ? '#E6B800'
                                : '#9A9A9A',
                        }}
                      >
                        {i + 1}
                      </div>
                      <div className="px-3 py-3 text-sm font-medium">{ph.name}</div>
                    </div>
                  ))}
                </div>

                <div className="bg-white border border-black rounded-md p-4 mb-4">
                  <div className="text-[11px] font-mono uppercase text-[#6B6E72] mb-2">Change orders</div>
                  {demoProject.changeOrders.length === 0 ? (
                    <p className="text-sm text-[#6B6E72]">None</p>
                  ) : (
                    <ul className="text-sm space-y-2">
                      {demoProject.changeOrders.map((c) => (
                        <li key={c.title} className="flex justify-between gap-2">
                          <span>
                            {c.title}{' '}
                            <span className="text-[#6B6E72]">· {c.status}</span>
                          </span>
                          <span className="tabular-nums">{money(c.amount)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
