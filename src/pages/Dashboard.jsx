import { useCallback, useEffect, useState, useRef } from 'react'
import { HardHat, Plus, Image as ImageIcon, MapPin, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Camera, Trash2, Check, FileText, X, Video, Menu, Share2, Bell, Search, Copy, Archive, Printer } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { STYLES, PROJECT_STATUS, PHASE_STATUS, nextPhaseStatus, fmtDate, fmtDateTime, isFinishingPhase, FINISHING_PHASES, finishingLabel, roleLabel } from '../lib/styles'
import AdminPanel from '../components/AdminPanel'

const QUEUE_KEY = 'ay_upload_queue'



function SwipeBack({ onBack, children, className = '', disabled = false }) {
  const start = useRef(null)
  const onTouchStart = (e) => {
    if (disabled) return
    const t = e.touches[0]
    // Only start back-gesture near the left edge so vertical scrolling never exits
    if (t.clientX > 28) {
      start.current = null
      return
    }
    start.current = { x: t.clientX, y: t.clientY }
  }
  const onTouchMove = (e) => {
    if (!start.current) return
    const t = e.touches[0]
    const dx = t.clientX - start.current.x
    const dy = t.clientY - start.current.y
    // Cancel if user is clearly scrolling vertically
    if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 12) {
      start.current = null
    }
  }
  const onTouchEnd = (e) => {
    if (disabled || !start.current) return
    const t = e.changedTouches[0]
    const dx = t.clientX - start.current.x
    const dy = t.clientY - start.current.y
    start.current = null
    // Require clear horizontal swipe (rightward) and little vertical movement
    if (dx > 100 && Math.abs(dx) > Math.abs(dy) * 2) onBack?.()
  }
  return (
    <div
      className={className}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {children}
    </div>
  )
}

function SwipeDeleteRow({ children, onDelete }) {
  const startX = useRef(null)
  const [offset, setOffset] = useState(0)

  return (
    <div className="relative overflow-hidden rounded-md">
      <div className="absolute inset-y-0 right-0 w-20 bg-[#B5533C] flex items-center justify-center text-white text-xs font-medium">
        Delete
      </div>
      <div
        style={{ transform: `translateX(${offset}px)`, transition: startX.current == null ? 'transform 0.15s ease' : 'none' }}
        onTouchStart={(e) => { startX.current = e.touches[0].clientX }}
        onTouchMove={(e) => {
          if (startX.current == null) return
          const dx = e.touches[0].clientX - startX.current
          if (dx < 0) setOffset(Math.max(dx, -80))
          else setOffset(0)
        }}
        onTouchEnd={() => {
          if (offset < -50) {
            setOffset(-80)
            onDelete?.()
          } else {
            setOffset(0)
          }
          startX.current = null
        }}
        className="relative bg-transparent"
      >
        {children}
      </div>
    </div>
  )
}

function titleCase(str) {
  if (!str) return ''
  return String(str)
    .split(/\s+/)
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : ''))
    .join(' ')
}

function formatStyleLabel(style) {

  if (!style) return '—'
  if (STYLES[style]?.label) return STYLES[style].label
  // strip legacy "custom_" prefix and underscores from older data
  return String(style)
    .replace(/^custom_/i, '')
    .replace(/_/g, ' ')
    .trim() || style
}

export default function Dashboard({ session, profile, company, onCompanyUpdate, onLogout }) {
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [digest, setDigest] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [showNew, setShowNew] = useState(false)
  const [showAdmin, setShowAdmin] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showCalendar, setShowCalendar] = useState(false)
  const [showWeek, setShowWeek] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [headerCompany, setHeaderCompany] = useState(company)
  const [searchQ, setSearchQ] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [showArchived, setShowArchived] = useState(false)
  const [notifications, setNotifications] = useState([])
  const [showNotifs, setShowNotifs] = useState(false)

  const isAdmin = profile?.role === 'admin'
  const isCustomer = profile?.role === 'customer'
  const canUpload = profile?.role === 'admin' || profile?.role === 'team'

  const refreshCompany = useCallback(async () => {
    if (!profile?.company_id) return
    const { data, error } = await supabase
      .from('companies')
      .select('id, name, logo_url, app_share_url, header_color')
      .eq('id', profile.company_id)
      .maybeSingle()
    if (error) {
      console.error('company load', error)
      return
    }
    if (data) {
      console.log('Header company:', data)
      setHeaderCompany(data)
    }
  }, [profile?.company_id])

  useEffect(() => {
    setHeaderCompany(company)
  }, [company])

  useEffect(() => {
    refreshCompany()
  }, [refreshCompany])

  const loadProjects = useCallback(async (opts = {}) => {
    const soft = opts.soft === true
    if (!soft) setLoading(true)
    const fullSelect =
      '*, phases(*, photos(*), phase_team(user_id), phase_files(*), tasks(*, task_photos(*))), project_files(*), project_team(user_id), project_customers(user_id), change_orders(*)'
    const basicSelect =
      '*, phases(*, photos(*), phase_team(user_id), phase_files(*)), project_files(*), project_team(user_id), project_customers(user_id), change_orders(*)'

    let data = null
    let error = null
    {
      const res = await supabase.from('projects').select(fullSelect).order('created_at', { ascending: false })
      data = res.data
      error = res.error
      if (error) {
        console.warn('full select failed, retry basic', error.message)
        const res2 = await supabase.from('projects').select(basicSelect).order('created_at', { ascending: false })
        data = res2.data
        error = res2.error
      }
    }

    if (error) {
      console.error(error)
      if (!soft) setProjects([])
    } else {
      let list = (data || []).map((p) => ({
        ...p,
        phases: (p.phases || []).slice().sort((a, b) => a.sort_order - b.sort_order),
        tasks: (p.tasks || []).slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at)),
      }))
      // Team: if a project has assigned trade members, only those trade members see it (admins see all)
      if (profile?.role === 'team') {
        list = list.filter((p) => {
          const phases = p.phases || []
          return phases.some((ph) =>
            (ph.phase_team || []).some((m) => m.user_id === profile.id)
          )
        }).map((p) => {
          const myPhases = (p.phases || []).filter((ph) =>
            (ph.phase_team || []).some((m) => m.user_id === profile.id)
          )
          const myPhaseIds = new Set(myPhases.map((ph) => ph.id))
          // Change orders only for phases this trade member is on
          const cos = (p.change_orders || [])
            .filter((co) => co.phase_id && myPhaseIds.has(co.phase_id))
            .map((co) => {
              const { amount, admin_reply, admin_fee, ...rest } = co
              return rest // keep team_amount only
            })
          return { ...p, phases: myPhases, change_orders: cos }
        })
      }
      if (profile?.role === 'customer') {
        list = list.filter((p) =>
          (p.project_customers || []).some((c) => c.user_id === profile.id)
        )
      }
      setProjects(list)
      try {
        if (profile?.company_id) {
          localStorage.setItem('bw_projects_cache_' + profile.company_id, JSON.stringify({ at: Date.now(), list }))
        }
      } catch (_) {}
    }
    setLoading(false)
  }, [profile?.id, profile?.role])

  const visibleProjects = projects.filter((p) => {
    if (!showArchived && p.archived) return false
    if (showArchived && !p.archived) return false
    if (statusFilter === 'pending_co') {
      if (!(p.change_orders || []).some((c) => ['pending', 'quoted'].includes(c.status || ''))) return false
    } else if (statusFilter !== 'all' && p.status !== statusFilter) {
      return false
    }
    if (searchQ.trim()) {
      const q = searchQ.trim().toLowerCase()
      const hay = (p.address || '') + ' ' + (p.style || '')
      if (!hay.toLowerCase().includes(q)) return false
    }
    return true
  })


  useEffect(() => {
    // Offline: show last cached projects immediately
    try {
      if (profile?.company_id) {
        const raw = localStorage.getItem('bw_projects_cache_' + profile.company_id)
        if (raw) {
          const parsed = JSON.parse(raw)
          if (parsed?.list?.length) setProjects(parsed.list)
        }
      }
    } catch (_) {}
    loadProjects()
  }, [loadProjects, profile?.company_id])

  // Offline queue: retry when back online
  useEffect(() => {
    const flush = async () => {
      try {
        const raw = localStorage.getItem(QUEUE_KEY)
        if (!raw) return
        const q = JSON.parse(raw)
        if (!Array.isArray(q) || !q.length) return
        const left = []
        for (const item of q) {
          try {
            const bin = Uint8Array.from(atob(item.b64), (c) => c.charCodeAt(0))
            const { error: upErr } = await supabase.storage.from('project-photos').upload(item.path, bin, {
              contentType: item.contentType,
            })
            if (upErr) { left.push(item); continue }
            const { data: pub } = supabase.storage.from('project-photos').getPublicUrl(item.path)
            await supabase.from('photos').insert({
              phase_id: item.phase_id,
              project_id: item.project_id,
              storage_path: item.path,
              public_url: pub.publicUrl,
              caption: item.caption || null,
              tag: item.tag || null,
              media_type: item.media_type || 'image',
              uploaded_by: profile?.id,
            })
          } catch {
            left.push(item)
          }
        }
        localStorage.setItem(QUEUE_KEY, JSON.stringify(left))
        if (q.length !== left.length) loadProjects()
      } catch (_) {}
    }
    window.addEventListener('online', flush)
    if (navigator.onLine) flush()
    return () => window.removeEventListener('online', flush)
  }, [loadProjects, profile?.id])


  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    navigator.serviceWorker.getRegistration().then((reg) => {
      if (!reg) return
      reg.update().catch(() => {})
      if (reg.waiting) setUpdateAvailable(true)
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing
        if (!nw) return
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) setUpdateAvailable(true)
        })
      })
    }).catch(() => {})
  }, [])


  useEffect(() => {
    if (!profile?.company_id || profile?.role !== 'admin') return
    const since = new Date()
    since.setDate(since.getDate() - 7)
    supabase
      .from('activity')
      .select('id, action, detail, user_name, user_email, created_at, project_id')
      .eq('company_id', profile.company_id)
      .gte('created_at', since.toISOString())
      .order('created_at', { ascending: false })
      .limit(40)
      .then(({ data }) => setDigest(data || []))
      .catch(() => {})
  }, [profile?.company_id, profile?.role, projects.length])

  const activeProject = projects.find((p) => p.id === activeId) || null

  const logActivity = async (action, detail, projectId = null, phaseName = null) => {
    const pid = projectId || activeId || null
    const proj = projects.find((p) => p.id === pid) || activeProject
    const projectLabel = (proj && (proj.address || proj.name)) || null
    const phaseLabel = phaseName || null
    const whereBits = []
    if (projectLabel) whereBits.push(projectLabel)
    if (phaseLabel) whereBits.push('Phase: ' + phaseLabel)
    const whereLine = whereBits.length ? whereBits.join(' · ') : null

    await supabase.from('activity').insert({
      company_id: profile.company_id,
      user_id: profile.id,
      user_email: profile.email,
      user_name: profile.name,
      action,
      detail: [detail, whereLine].filter(Boolean).join(' — '),
      project_id: pid,
    })

    const notifTitle = titleCase(action)
    const who = profile.name || profile.email || 'User'
    const bodyParts = []
    if (whereLine) bodyParts.push(whereLine)
    if (detail) bodyParts.push(who + ': ' + detail)
    else bodyParts.push(who)
    const notifBody = bodyParts.join('\n')

    if (profile?.company_id && profile?.role !== 'admin') {
      try {
        await supabase.rpc('notify_company_admins', {
          p_company_id: profile.company_id,
          p_project_id: pid,
          p_title: notifTitle,
          p_body: notifBody,
          p_kind: action,
        })
      } catch (_) {}
    } else if (profile?.company_id && profile?.role === 'admin') {
      const shareWithAdmins = [
        'quoted change order',
        'approved change order',
        'rejected change order',
        'sent change order offer',
      ]
      if (shareWithAdmins.some((k) => action.includes(k) || action === k)) {
        try {
          await supabase.rpc('notify_company_admins', {
            p_company_id: profile.company_id,
            p_project_id: pid,
            p_title: notifTitle,
            p_body: [whereLine, detail].filter(Boolean).join('\n') || detail || '',
            p_kind: action,
          })
        } catch (_) {}
      }
    }
  }

  const updateAppBadge = useCallback((unreadCount) => {
    try {
      if (typeof navigator !== 'undefined' && 'setAppBadge' in navigator) {
        if (unreadCount > 0) navigator.setAppBadge(unreadCount)
        else if ('clearAppBadge' in navigator) navigator.clearAppBadge()
      }
      if (navigator.serviceWorker?.ready) {
        navigator.serviceWorker.ready.then((reg) => {
          if (reg.setAppBadge) {
            if (unreadCount > 0) reg.setAppBadge(unreadCount)
            else if (reg.clearAppBadge) reg.clearAppBadge()
          }
        }).catch(() => {})
      }
    } catch (_) {}
  }, [])

  const loadNotifications = useCallback(async () => {
    if (!profile?.id) return
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', profile.id)
      .order('created_at', { ascending: false })
      .limit(30)
    const list = data || []
    setNotifications(list)
    updateAppBadge(list.filter((n) => !n.read_at).length)
  }, [profile?.id, updateAppBadge])

  useEffect(() => {
    loadNotifications()
    const t = setInterval(loadNotifications, 60000)
    return () => clearInterval(t)
  }, [loadNotifications])

  // Request browser notification permission (team + admin)
  useEffect(() => {
    if (!profile?.id) return
    if (typeof Notification === 'undefined') return
    if (Notification.permission === 'default') {
      // defer slightly so UI loads first
      const id = setTimeout(() => {
        Notification.requestPermission().catch(() => {})
      }, 2000)
      return () => clearTimeout(id)
    }
  }, [profile?.id])

  const showLocalPush = useCallback((title, body, data = {}) => {
    try {
      if (typeof Notification === 'undefined') return
      if (Notification.permission !== 'granted') return
      if (navigator.serviceWorker?.controller) {
        navigator.serviceWorker.controller.postMessage({
          type: 'show-notification',
          title,
          body,
          data,
        })
      } else {
        new Notification(title, { body, icon: '/icon-192.png', data })
      }
    } catch (_) {}
  }, [])

  // Soft reload helper (no full-screen spinner)
  const softReload = useCallback(() => {
    loadProjects({ soft: true })
  }, [loadProjects])

  // Realtime + fallback polling so data pops in without manual refresh
  useEffect(() => {
    if (!profile?.company_id || !profile?.id) return

    let debounceTimer = null
    const scheduleReload = () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        loadProjects({ soft: true })
      }, 300)
    }

    const tables = [
      'projects',
      'phases',
      'photos',
      'change_orders',
      'tasks',
      'task_photos',
      'project_files',
      'phase_files',
      'phase_team',
      'project_customers',
      'activity',
    ]

    let channel = supabase.channel('company-live-' + profile.company_id + '-' + profile.id)
    tables.forEach((table) => {
      channel = channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        () => scheduleReload()
      )
    })
    channel = channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'notifications', filter: 'user_id=eq.' + profile.id },
      (payload) => {
        loadNotifications()
        if (payload.eventType === 'INSERT' && payload.new) {
          const row = payload.new
          showLocalPush(row.title || 'Update', row.body || '', { project_id: row.project_id })
        }
      }
    )

    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.log('Realtime connected')
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.warn('Realtime issue:', status)
      }
    })

    // Light fallback poll (Realtime should handle most updates)
    const poll = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        loadNotifications()
      }
    }, 20000)

    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        loadProjects({ soft: true })
        loadNotifications()
      }
    }
    document.addEventListener('visibilitychange', onVisible)

    // System notification click → mark that user's notification read + open project
    const onMsg = async (event) => {
      if (!event.data || event.data.type !== 'notification-click') return
      const data = event.data.data || {}
      if (data.notification_id) {
        await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', data.notification_id).eq('user_id', profile.id)
        loadNotifications()
      }
      if (data.project_id) {
        setActiveId(data.project_id)
        setShowNotifs(false)
      }
    }
    if (navigator.serviceWorker) {
      navigator.serviceWorker.addEventListener('message', onMsg)
    }

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      clearInterval(poll)
      document.removeEventListener('visibilitychange', onVisible)
      if (navigator.serviceWorker) navigator.serviceWorker.removeEventListener('message', onMsg)
      supabase.removeChannel(channel)
    }
  }, [profile?.company_id, profile?.id, loadProjects, loadNotifications, showLocalPush])


  const createProject = async (form) => {
    const phaseNames = form.customPhases?.length
      ? form.customPhases.filter((n) => !isFinishingPhase(n))
      : (STYLES[form.style] || STYLES.remodel).phases.filter((n) => !isFinishingPhase(n))
    const styleKey = form.customLabel || form.style || 'Remodel'

    // Optionally persist custom type for this company
    if (form.customPhases?.length && form.customLabel && profile.company_id) {
      const { data: existing } = await supabase
        .from('company_styles')
        .select('styles')
        .eq('company_id', profile.company_id)
        .maybeSingle()
      const styles = { ...(existing?.styles || {}), [styleKey]: { label: form.customLabel, phases: form.customPhases } }
      await supabase.from('company_styles').upsert({ company_id: profile.company_id, styles, updated_at: new Date().toISOString() })
    }

    let coverUrl = form.coverPhotoUrl || null

    const { data: project, error } = await supabase
      .from('projects')
      .insert({
        company_id: profile.company_id,
        address: form.address,
        style: styleKey,
        status: 'planning',
        start_date: form.startDate || null,
        end_date: form.endDate || null,
        cover_photo_url: coverUrl,
        created_by: profile.id,
      })
      .select()
      .single()
    if (error) {
      alert(error.message)
      return
    }

    const phaseRows = phaseNames.map((name, i) => ({
      project_id: project.id,
      name,
      sort_order: i,
      status: 'pending',
      trade: '',
    }))
    const { error: phErr } = await supabase.from('phases').insert(phaseRows)
    if (phErr) {
      alert(phErr.message)
      return
    }
    await logActivity('created project', form.address)
    setShowNew(false)
    await loadProjects()
    setActiveId(project.id)
  }

  const updateProject = async (patch) => {
    if (!activeProject) return
    const { id, phases, ...fields } = patch
    if (Object.keys(fields).length) {
      await supabase.from('projects').update(fields).eq('id', activeProject.id)
    }
    await loadProjects()
  }

    const deleteProject = async (id) => {
    if (!confirm('Delete this project and all photos, files, and history? This cannot be undone.')) return
    try {
      const paths = []
      const { data: photos } = await supabase.from('photos').select('storage_path').eq('project_id', id)
      ;(photos || []).forEach((x) => x.storage_path && paths.push(x.storage_path))
      const { data: pfiles } = await supabase.from('project_files').select('storage_path').eq('project_id', id)
      ;(pfiles || []).forEach((x) => x.storage_path && paths.push(x.storage_path))
      const { data: phfiles } = await supabase.from('phase_files').select('storage_path').eq('project_id', id)
      ;(phfiles || []).forEach((x) => x.storage_path && paths.push(x.storage_path))
      const { data: cos } = await supabase.from('change_orders').select('storage_path').eq('project_id', id)
      ;(cos || []).forEach((x) => x.storage_path && paths.push(x.storage_path))
      const { data: tphotos } = await supabase.from('task_photos').select('storage_path').eq('project_id', id)
      ;(tphotos || []).forEach((x) => x.storage_path && paths.push(x.storage_path))
      // chunk removes
      for (let i = 0; i < paths.length; i += 50) {
        await supabase.storage.from('project-photos').remove(paths.slice(i, i + 50))
      }
    } catch (_) {}
    await supabase.from('projects').delete().eq('id', id)
    setActiveId(null)
    await loadProjects()
  }

  const archiveProject = async (id, archived = true) => {
    if (archived && !confirm('Archive this project? You can restore it from Archived.')) return
    if (!archived && !confirm('Restore this project to active?')) return
    await supabase.from('projects').update({ archived }).eq('id', id)
    setActiveId(null)
    await loadProjects()
  }


  return (
    <div className="min-h-screen bg-white">
      <header className="text-white px-4 pb-3 sticky top-0 z-50" style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))", background: (headerCompany?.header_color || company?.header_color || '#000000') }}>
        <div className="max-w-2xl mx-auto grid grid-cols-3 items-center gap-2">
          {/* Left: company + email */}
          <div className="min-w-0 text-left">
            <div className="font-display text-sm sm:text-base tracking-wide truncate leading-tight">
              {headerCompany?.name || company?.name || 'Workspace'}
            </div>
            <div className="text-[10px] text-white/50 truncate">{profile?.email}</div>
          </div>
          {/* Center: logo */}
          <div className="flex justify-center items-center min-w-0">
            {(headerCompany?.logo_url || company?.logo_url) ? (
              <img
                src={headerCompany?.logo_url || company?.logo_url}
                alt={headerCompany?.name || company?.name || 'Logo'}
                className="h-11 w-auto max-w-[120px] object-contain"
                onError={(e) => {
                  e.currentTarget.style.display = 'none'
                }}
              />
            ) : (
              <div className="font-display text-sm tracking-wide text-white/80">AY</div>
            )}
          </div>
          {/* Right: role + menu */}
          <div className="flex items-center justify-end gap-2 relative">
            <span className="hidden sm:inline text-[10px] font-mono uppercase tracking-wide px-1.5 py-0.5 border border-white/40 rounded">
              {profile?.role}
            </span>
            {(isAdmin || profile?.role === 'team') && (
              <button
                type="button"
                onClick={() => { setShowNotifs((v) => !v); setMenuOpen(false) }}
                className="p-2 border border-white/30 rounded hover:bg-white/10 relative"
                aria-label="Notifications"
              >
                <Bell size={18} />
                {notifications.some((n) => !n.read_at) && (
                  <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-[#E6B800]" />
                )}
              </button>
            )}
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              className="p-2 border border-white/30 rounded hover:bg-white/10"
              aria-label="Menu"
            >
              <Menu size={18} />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-full mt-2 z-50 w-44 bg-white text-black border border-black rounded-md shadow-lg overflow-hidden">
                  <div className="px-3 py-2 text-[10px] font-mono uppercase text-[#6B6E72] border-b border-[#E5E5E5] sm:hidden">
                    {profile?.role}
                  </div>
                  {isAdmin && (
                    <button
                      type="button"
                      className="w-full text-left px-3 py-2.5 text-sm hover:bg-[#F5F5F5]"
                      onClick={() => {
                        setMenuOpen(false)
                        setShowAdmin(true)
                        setShowPassword(false)
                        setShowCalendar(false)
                        setShowWeek(false)
                        setActiveId(null)
                        setShowNew(false)
                      }}
                    >
                      Users / Contractor
                    </button>
                  )}
                  {isAdmin && (
                    <button
                      type="button"
                      className="w-full text-left px-3 py-2.5 text-sm hover:bg-[#F5F5F5]"
                      onClick={() => {
                        setMenuOpen(false)
                        setShowCalendar(true)
                        setShowWeek(false)
                        setShowAdmin(false)
                        setShowPassword(false)
                        setActiveId(null)
                        setShowNew(false)
                      }}
                    >
                      Calendar
                    </button>
                  )}
                  {isAdmin && (
                    <button
                      type="button"
                      className="w-full text-left px-3 py-2.5 text-sm hover:bg-[#F5F5F5]"
                      onClick={() => {
                        setMenuOpen(false)
                        setShowWeek(true)
                        setShowCalendar(false)
                        setShowAdmin(false)
                        setShowPassword(false)
                        setActiveId(null)
                        setShowNew(false)
                      }}
                    >
                      This week
                    </button>
                  )}
                  <button
                    type="button"
                    className="w-full text-left px-3 py-2.5 text-sm hover:bg-[#F5F5F5]"
                    onClick={() => {
                      setMenuOpen(false)
                      setShowPassword(true)
                      setShowAdmin(false)
                      setShowCalendar(false)
                      setShowWeek(false)
                      setActiveId(null)
                      setShowNew(false)
                    }}
                  >
                    Change password
                  </button>
                  <button
                    type="button"
                    className="w-full text-left px-3 py-2.5 text-sm hover:bg-[#F5F5F5] border-t border-[#E5E5E5]"
                    onClick={() => {
                      setMenuOpen(false)
                      onLogout()
                    }}
                  >
                    Log out
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {updateAvailable && (
        <div className="bg-[#FFF8DB] border-b border-[#E6B800] text-center text-sm px-4 py-2">
          New version available.{' '}
          <button type="button" className="underline font-medium" onClick={() => window.location.reload()}>
            Refresh
          </button>
        </div>
      )}
      <main className="max-w-2xl mx-auto px-4 py-5">
        {showNotifs && (isAdmin || profile?.role === 'team') ? (
          <SwipeBack onBack={() => setShowNotifs(false)}>
            <button type="button" onClick={() => setShowNotifs(false)} className="flex items-center gap-1 text-sm text-[#6B6E72] mb-4">
              <ChevronLeft size={16} /> Back
            </button>
            <h2 className="font-display text-2xl mb-4">Notifications</h2>
            {notifications.length > 0 && (
              <div className="flex justify-end mb-3">
                <button
                  type="button"
                  className="text-xs underline text-[#6B6E72]"
                  onClick={async () => {
                    if (!confirm('Clear all your notifications?')) return
                    const ids = notifications.map((n) => n.id)
                    if (!ids.length) return
                    const { error } = await supabase.from('notifications').delete().in('id', ids)
                    if (error) {
                      alert(error.message || 'Could not clear notifications')
                      return
                    }
                    setNotifications([])
                    updateAppBadge(0)
                  }}
                >
                  Clear all
                </button>
              </div>
            )}
            {notifications.length === 0 ? (
              <p className="text-sm text-[#6B6E72]">No notifications yet.</p>
            ) : (
              <div className="space-y-2">
                {notifications.map((n) => (
                  <SwipeDeleteRow
                    key={n.id}
                    onDelete={async () => {
                      const { error } = await supabase.from('notifications').delete().eq('id', n.id).eq('user_id', profile.id)
                      if (error) {
                        alert(error.message || 'Could not delete')
                        return
                      }
                      setNotifications((prev) => {
                        const next = prev.filter((x) => x.id !== n.id)
                        updateAppBadge(next.filter((x) => !x.read_at).length)
                        return next
                      })
                    }}
                  >
                    <button
                      type="button"
                      className={`w-full text-left border rounded-md p-3 ${n.read_at ? 'border-[#E5E5E5] bg-white' : 'border-black bg-[#FFFCF0]'}`}
                      onClick={async () => {
                        if (!n.read_at) {
                          await supabase
                            .from('notifications')
                            .update({ read_at: new Date().toISOString() })
                            .eq('id', n.id)
                            .eq('user_id', profile.id)
                          loadNotifications()
                        }
                        if (n.project_id) {
                          setActiveId(n.project_id)
                          setShowNotifs(false)
                        }
                      }}
                    >
                      <div className="text-sm font-medium">{titleCase(n.title)}</div>
                      {(() => {
                        const proj = projects.find((p) => p.id === n.project_id)
                        const projLine = proj?.address || null
                        return (
                          <>
                            {projLine && (
                              <div className="text-xs text-[#16324F] mt-0.5 font-medium">{projLine}</div>
                            )}
                            {n.body && (
                              <div className="text-xs text-[#6B6E72] mt-0.5 whitespace-pre-wrap">{n.body}</div>
                            )}
                          </>
                        )
                      })()}
                      <div className="text-[10px] font-mono text-[#8A8D91] mt-1">{fmtDateTime(n.created_at)}</div>
                    </button>
                  </SwipeDeleteRow>
                ))}
              </div>
            )}
          </SwipeBack>
        ) : showPassword ? (
          <ChangePasswordPanel
            email={profile?.email}
            onBack={() => setShowPassword(false)}
          />
        ) : showCalendar && isAdmin ? (
          <AdminCalendarView
            projects={projects}
            onBack={() => setShowCalendar(false)}
            onOpenProject={(id) => {
              setShowCalendar(false)
              setActiveId(id)
            }}
          />
        ) : showWeek && isAdmin ? (
          <ThisWeekView
            digest={digest}
            projects={projects}
            onBack={() => setShowWeek(false)}
            onOpenProject={(id) => {
              setShowWeek(false)
              setActiveId(id)
            }}
          />
        ) : showAdmin && isAdmin ? (
          <AdminPanel
            profile={profile}
            company={headerCompany || company}
            digest={digest}
            allProjects={projects}
            onBack={() => {
              setShowAdmin(false)
              refreshCompany()
              onCompanyUpdate?.()
            }}
            onCompanyUpdate={async () => {
              await onCompanyUpdate?.()
              await refreshCompany()
            }}
          />
        ) : showNew && isAdmin ? (
          <NewProjectForm onCreate={createProject} onCancel={() => setShowNew(false)} companyId={profile.company_id} existingProjects={projects} />
        ) : activeProject ? (
          <ProjectDetail
            project={activeProject}
            isAdmin={isAdmin}
            canUpload={canUpload}
            isCustomer={isCustomer}
            profile={profile}
            onBack={() => setActiveId(null)}
            onReload={softReload}
            onDelete={deleteProject}
            logActivity={logActivity}
          />
        ) : (
          <div>
            <div className="flex justify-between items-center mb-4 gap-2">
              <span className="text-sm text-[#6B6E72]">
                {loading ? '…' : `${projects.length} project${projects.length !== 1 ? 's' : ''}`}
              </span>
              {isAdmin && (
                <button
                  onClick={() => setShowNew(true)}
                  className="flex items-center gap-1.5 bg-black text-white text-sm font-medium px-3 py-2 rounded"
                >
                  <Plus size={16} /> New project
                </button>
              )}
            </div>

            
        {!isCustomer && (
          <div className="mb-4 space-y-2">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8A8D91]" />
              <input
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                placeholder="Search address"
                className="w-full border border-black rounded pl-9 pr-3 py-2 text-sm"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="border border-black rounded px-2 py-1.5 text-xs bg-white">
                <option value="all">All statuses</option>
                <option value="planning">Planning</option>
                <option value="active">In progress</option>
                <option value="hold">On hold</option>
                <option value="done">Complete</option>
                <option value="pending_co">Pending change orders</option>
              </select>
              {isAdmin && (
                <button type="button" onClick={() => setShowArchived((v) => !v)} className="text-xs border border-black rounded px-2 py-1.5">
                  {showArchived ? 'Active projects' : 'Archived'}
                </button>
              )}
            </div>
          </div>
        )}


{loading ? (
              <div className="text-center py-16">
                <p className="text-sm text-[#6B6E72]">Loading projects…</p>
              </div>
            ) : !visibleProjects.length ? (
              <div className="text-center py-16 border-2 border-dashed border-black rounded-md">
                <HardHat size={32} className="mx-auto text-[#C9C4B8] mb-2" />
                <p className="text-[#6B6E72] text-sm mb-3">
                  {showArchived
                    ? 'No archived projects.'
                    : isCustomer
                      ? 'No projects shared with you yet.'
                      : 'No projects yet.'}
                </p>
                {isAdmin && (
                  <button onClick={() => setShowNew(true)} className="text-sm font-medium text-white bg-black px-4 py-2 rounded">
                    Start a project
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {visibleProjects.map((p) => {
                  const phases = p.phases || []
                  const doneCount = phases.filter((ph) => ph.status === 'done').length
                  const thumb = p.cover_photo_url
                  return (
                    <button
                      key={p.id}
                      onClick={() => setActiveId(p.id)}
                      className="w-full text-left bg-white border border-black rounded-md p-4 flex gap-3 hover:bg-gray-50"
                    >
                      <div className="w-14 h-14 rounded bg-[#F5F5F5] flex items-center justify-center flex-shrink-0 overflow-hidden">
                        {thumb ? (
                          <img src={thumb} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <ImageIcon size={20} className="text-[#C9C4B8]" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-start gap-2">
                          <h3 className="font-display text-lg text-black leading-tight truncate">{p.address}</h3>
                          <div className="flex flex-col items-end gap-1">
                            <StatusBadge status={p.status} map={PROJECT_STATUS} />
                            {isAdmin && (p.change_orders || []).some((c) => ['pending', 'quoted'].includes(c.status || '')) && (
                              <span className="text-[9px] font-mono uppercase bg-[#E6B800] text-black px-1.5 py-0.5 rounded">
                                CO open
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="text-xs text-[#6B6E72] mt-0.5">{formatStyleLabel(p.style)}</div>
                        <div className="text-[11px] font-mono text-[#6B6E72] mt-1">
                          {doneCount} of {phases.length} phases complete
                          {phases.length > 0 ? ` · ${Math.round((doneCount / phases.length) * 100)}%` : ''}
                        </div>
                        {isCustomer && (() => {
                          const active = phases.find((ph) => ph.status === 'active')
                          const recent = (p.change_orders || []).filter((c) => ['quoted', 'pending'].includes(c.status || ''))
                          return (
                            <div className="text-[11px] text-[#6B6E72] mt-1">
                              {active ? `In progress: ${active.name}` : 'No phase in progress'}
                              {recent.length ? ` · ${recent.length} change order${recent.length > 1 ? 's' : ''} open` : ''}
                            </div>
                          )
                        })()}
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}



function ChangePasswordPanel({ email, onBack }) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setSuccess('')
    if (newPassword.length < 6) {
      setError('New password must be at least 6 characters.')
      return
    }
    if (newPassword !== confirm) {
      setError('New passwords do not match.')
      return
    }
    if (currentPassword && currentPassword === newPassword) {
      setError('Choose a different password than the one-time password.')
      return
    }
    setLoading(true)
    try {
      // Re-auth with current password (OTP or personal) so stolen sessions can't change it blindly
      if (email && currentPassword) {
        const { error: signErr } = await supabase.auth.signInWithPassword({
          email: email.trim().toLowerCase(),
          password: currentPassword,
        })
        if (signErr) {
          setError('Current password is incorrect.')
          setLoading(false)
          return
        }
      }
      const { error: upErr } = await supabase.auth.updateUser({ password: newPassword })
      if (upErr) throw upErr
      setSuccess('Password updated. Use your new password next time you log in.')
      setCurrentPassword('')
      setNewPassword('')
      setConfirm('')
    } catch (err) {
      setError(err.message || 'Could not update password.')
    }
    setLoading(false)
  }

  return (
    <div>
      <button type="button" onClick={onBack} className="flex items-center gap-1 text-sm text-[#6B6E72] mb-4">
        <ChevronLeft size={16} /> Back
      </button>
      <h2 className="font-display text-2xl mb-1">Change password</h2>
      <p className="text-sm text-[#6B6E72] mb-6">
        Replace the one-time password from your invite with a personal password you will remember.
      </p>
      <form onSubmit={submit} className="bg-white border border-black rounded-md p-4 space-y-3 max-w-md">
        <div>
          <label className="block text-[11px] font-mono uppercase text-[#6B6E72] mb-1">Current password (or one-time password)</label>
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
            className="w-full border border-black rounded px-3 py-2.5 text-sm"
            autoComplete="current-password"
          />
        </div>
        <div>
          <label className="block text-[11px] font-mono uppercase text-[#6B6E72] mb-1">New password</label>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
            minLength={6}
            className="w-full border border-black rounded px-3 py-2.5 text-sm"
            autoComplete="new-password"
            placeholder="At least 6 characters"
          />
        </div>
        <div>
          <label className="block text-[11px] font-mono uppercase text-[#6B6E72] mb-1">Confirm new password</label>
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            className="w-full border border-black rounded px-3 py-2.5 text-sm"
            autoComplete="new-password"
          />
        </div>
        {error && <p className="text-xs text-[#B5533C]">{error}</p>}
        {success && <p className="text-xs text-[#3F7D58]">{success}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full py-2.5 rounded text-sm font-medium text-white bg-black disabled:opacity-50"
        >
          {loading ? 'Saving…' : 'Save new password'}
        </button>
      </form>
    </div>
  )
}


function AdminCalendarView({ projects, onBack, onOpenProject }) {
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth()) // 0-11
  const [selected, setSelected] = useState(today.toISOString().slice(0, 10))

  const first = new Date(year, month, 1)
  const startPad = first.getDay() // 0 Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells = []
  for (let i = 0; i < startPad; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  const iso = (d) => {
    const mm = String(month + 1).padStart(2, '0')
    const dd = String(d).padStart(2, '0')
    return year + '-' + mm + '-' + dd
  }

  const marks = {}
  ;(projects || []).forEach((pr) => {
    const mark = (dateStr, info) => {
      if (!dateStr) return
      if (!marks[dateStr]) marks[dateStr] = []
      marks[dateStr].push(info)
    }
    mark(pr.start_date, { projectId: pr.id, label: pr.address, detail: 'Project start', status: pr.status })
    mark(pr.end_date, { projectId: pr.id, label: pr.address, detail: 'Project end', status: pr.status })
    ;(pr.phases || []).forEach((ph) => {
      mark(ph.start_date, { projectId: pr.id, label: pr.address + ' · ' + ph.name, detail: 'Phase start', status: ph.status })
      mark(ph.end_date, { projectId: pr.id, label: pr.address + ' · ' + ph.name, detail: 'Phase end', status: ph.status })
    })
  })

  // Ongoing on selected day
  const dayItems = []
  const day = selected
  ;(projects || []).forEach((pr) => {
    if (pr.start_date === day || pr.end_date === day) {
      dayItems.push({
        projectId: pr.id,
        label: pr.address,
        detail: pr.start_date === day && pr.end_date === day ? 'Start & end' : pr.start_date === day ? 'Project start' : 'Project end',
        status: pr.status,
      })
    }
    ;(pr.phases || []).forEach((ph) => {
      if (ph.start_date === day || ph.end_date === day) {
        dayItems.push({
          projectId: pr.id,
          label: pr.address + ' · ' + ph.name,
          detail: ph.start_date === day && ph.end_date === day ? 'Start & end' : ph.start_date === day ? 'Phase start' : 'Phase target end',
          status: ph.status,
        })
      }
      if (ph.start_date && ph.end_date && ph.start_date < day && ph.end_date > day && ph.status === 'active') {
        dayItems.push({
          projectId: pr.id,
          label: pr.address + ' · ' + ph.name,
          detail: 'In progress',
          status: ph.status,
        })
      }
    })
  })

  const monthLabel = new Date(year, month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  const prev = () => {
    if (month === 0) { setMonth(11); setYear((y) => y - 1) }
    else setMonth((m) => m - 1)
  }
  const next = () => {
    if (month === 11) { setMonth(0); setYear((y) => y + 1) }
    else setMonth((m) => m + 1)
  }

  return (
    <SwipeBack onBack={onBack}>
      <button type="button" onClick={onBack} className="flex items-center gap-1 text-sm text-[#6B6E72] mb-4">
        <ChevronLeft size={16} /> Back
      </button>
      <h2 className="font-display text-2xl mb-4">Calendar</h2>
      <div className="bg-white border border-black rounded-md p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <button type="button" onClick={prev} className="p-2 border border-black rounded"><ChevronLeft size={18} /></button>
          <div className="font-display text-lg">{monthLabel}</div>
          <button type="button" onClick={next} className="p-2 border border-black rounded"><ChevronRight size={18} /></button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-mono uppercase text-[#6B6E72] mb-1">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
            <div key={d}>{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map((d, i) => {
            if (d == null) return <div key={'e' + i} className="aspect-square" />
            const dateStr = iso(d)
            const has = (marks[dateStr] || []).length > 0
            const isSel = selected === dateStr
            const isToday = dateStr === today.toISOString().slice(0, 10)
            return (
              <button
                key={dateStr}
                type="button"
                onClick={() => setSelected(dateStr)}
                className={
                  'aspect-square rounded text-sm relative border ' +
                  (isSel ? 'bg-black text-white border-black' : isToday ? 'border-[#E6B800] bg-[#FFF8DB]' : 'border-transparent hover:border-black')
                }
              >
                {d}
                {has && !isSel && (
                  <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-[#E6B800]" />
                )}
                {has && isSel && (
                  <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-[#E6B800]" />
                )}
              </button>
            )
          })}
        </div>
      </div>
      <div className="bg-white border border-black rounded-md p-4">
        <h3 className="text-[11px] font-mono uppercase text-[#6B6E72] mb-2">
          {fmtDate(selected)}
        </h3>
        {dayItems.length === 0 ? (
          <p className="text-sm text-[#6B6E72]">Nothing scheduled.</p>
        ) : (
          <div className="space-y-2">
            {dayItems.map((it, i) => (
              <button
                key={i}
                type="button"
                className="w-full text-left border border-[#E5E5E5] rounded p-3 hover:border-black"
                onClick={() => it.projectId && onOpenProject?.(it.projectId)}
              >
                <div className="text-sm font-medium">{it.label}</div>
                <div className="text-xs text-[#6B6E72]">{it.detail}{it.status ? ' · ' + it.status : ''}</div>
              </button>
            ))}
          </div>
        )}
      </div>
    </SwipeBack>
  )
}

function ThisWeekView({ digest, projects, onBack, onOpenProject }) {
  return (
    <SwipeBack onBack={onBack}>
      <button type="button" onClick={onBack} className="flex items-center gap-1 text-sm text-[#6B6E72] mb-4">
        <ChevronLeft size={16} /> Back
      </button>
      <h2 className="font-display text-2xl mb-4">This week</h2>
      {(digest || []).length === 0 ? (
        <p className="text-sm text-[#6B6E72]">No activity in the last 7 days.</p>
      ) : (
        <div className="space-y-2">
          {digest.map((d) => {
            const proj = (projects || []).find((p) => p.id === d.project_id)
            return (
              <button
                key={d.id}
                type="button"
                className="w-full text-left bg-white border border-black rounded-md p-3"
                onClick={() => d.project_id && onOpenProject?.(d.project_id)}
              >
                <div className="text-sm font-medium">{titleCase(d.action)}</div>
                {proj?.address && <div className="text-xs text-[#16324F] mt-0.5">{proj.address}</div>}
                <div className="text-xs text-[#6B6E72] mt-0.5">{d.detail || d.user_name || d.user_email}</div>
                <div className="text-[10px] font-mono text-[#8A8D91] mt-1">{fmtDateTime(d.created_at)}</div>
              </button>
            )
          })}
        </div>
      )}
    </SwipeBack>
  )
}

function StatusBadge({ status, map }) {
  const s = map[status] || map.planning || Object.values(map)[0]
  return (
    <span
      className="text-[10px] font-mono uppercase tracking-wide px-2 py-0.5 rounded-sm border flex-shrink-0"
      style={{ color: s.color, background: s.bg, borderColor: s.color }}
    >
      {s.label}
    </span>
  )
}

function NewProjectForm({ onCreate, onCancel, companyId, existingProjects = [] }) {
  const [address, setAddress] = useState('')
  const [style, setStyle] = useState('remodel')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [useCustom, setUseCustom] = useState(false)
  const [customLabel, setCustomLabel] = useState('')
  const [customPhases, setCustomPhases] = useState('')
  const [formError, setFormError] = useState('')
  const [coverUrl, setCoverUrl] = useState(null)
  const [uploadingCover, setUploadingCover] = useState(false)
  const [templateId, setTemplateId] = useState('')

  const uploadCover = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !companyId) return
    setUploadingCover(true)
    try {
      const safeName = (file.name || 'cover.jpg').replace(/[^a-zA-Z0-9._-]/g, '_')
      const path = companyId + '/covers/' + Date.now() + '-' + safeName
      const bytes = await file.arrayBuffer()
      const { error: upErr } = await supabase.storage.from('project-photos').upload(path, bytes, {
        upsert: false,
        contentType: file.type || 'image/jpeg',
      })
      if (upErr) throw upErr
      const { data: pub } = supabase.storage.from('project-photos').getPublicUrl(path)
      setCoverUrl(pub.publicUrl)
    } catch (err) {
      alert(err.message || 'Cover upload failed')
    }
    setUploadingCover(false)
  }

  const submit = () => {
    setFormError('')
    if (!address.trim()) return
    if (useCustom) {
      const lab = customLabel.trim()
      const phases = customPhases.split(',').map((s) => s.trim()).filter(Boolean)
      if (!lab) {
        setFormError('Enter a name for this project type.')
        return
      }
      if (!phases.length) {
        setFormError('List at least one phase (comma-separated).')
        return
      }
      onCreate({
        address: address.trim(),
        style: lab, // store human-readable type name (no "custom_" prefix)
        startDate,
        endDate,
        customLabel: lab,
        customPhases: phases,
        coverPhotoUrl: coverUrl,
      })
      return
    }
    onCreate({ address: address.trim(), style, startDate, endDate, coverPhotoUrl: coverUrl })
  }

  return (
    <div className="bg-white border border-black rounded-md p-5">
      <h3 className="font-display text-xl mb-4">New project</h3>
      <div className="space-y-3">
        <div>
          <label className="block text-[11px] font-mono uppercase text-[#6B6E72] mb-1">Address</label>
          <input value={address} onChange={(e) => setAddress(e.target.value)} className="w-full border border-black rounded px-3 py-2 text-sm" placeholder="214 Maple St" />
        </div>
        <div>
          <label className="block text-[11px] font-mono uppercase text-[#6B6E72] mb-1">Cover photo (optional)</label>
          {coverUrl ? (
            <div className="relative">
              <img src={coverUrl} alt="" className="w-full h-36 object-cover rounded border border-black" />
              <button type="button" onClick={() => setCoverUrl(null)} className="absolute top-2 right-2 bg-black/70 text-white text-xs px-2 py-1 rounded">Remove</button>
            </div>
          ) : (
            <label className="flex flex-col items-center justify-center h-28 border-2 border-dashed border-black rounded text-sm text-[#6B6E72] cursor-pointer">
              {uploadingCover ? 'Uploading…' : 'Add cover photo'}
              <input type="file" accept="image/*" className="hidden" onChange={uploadCover} disabled={uploadingCover} />
            </label>
          )}
        </div>
        {existingProjects.length > 0 && (
          <div>
            <label className="block text-[11px] font-mono uppercase text-[#6B6E72] mb-1">Copy phases from</label>
            <select
              value={templateId}
              onChange={(e) => {
                const id = e.target.value
                setTemplateId(id)
                if (!id) return
                const src = existingProjects.find((p) => p.id === id)
                if (!src) return
                const names = (src.phases || []).slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)).map((ph) => ph.name)
                if (names.length) {
                  setUseCustom(true)
                  setCustomLabel((src.style || 'Template') + ' phases')
                  setCustomPhases(names.join(', '))
                }
              }}
              className="w-full border border-black rounded px-3 py-2 text-sm bg-white"
            >
              <option value="">None — pick a type below</option>
              {existingProjects.map((p) => (
                <option key={p.id} value={p.id}>{p.address}</option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="block text-[11px] font-mono uppercase text-[#6B6E72] mb-1">Project type</label>
          {!useCustom ? (
            <>
              <select value={style} onChange={(e) => setStyle(e.target.value)} className="w-full border border-black rounded px-3 py-2 text-sm bg-white">
                {Object.entries(STYLES).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
              <button type="button" onClick={() => setUseCustom(true)} className="mt-2 w-full py-2 rounded border-2 border-dashed border-black text-sm">
                + Custom project type
              </button>
            </>
          ) : (
            <div className="space-y-2 border border-black rounded p-3">
              <button type="button" onClick={() => setUseCustom(false)} className="text-xs text-[#6B6E72] underline">Use existing type</button>
              <input value={customLabel} onChange={(e) => setCustomLabel(e.target.value)} placeholder="Type name (e.g. Roofing)" className="w-full border border-black rounded px-3 py-2 text-sm" />
              <textarea value={customPhases} onChange={(e) => setCustomPhases(e.target.value)} placeholder="Phases, comma-separated (e.g. Tear-off, Underlayment, Shingles)" rows={3} className="w-full border border-black rounded px-3 py-2 text-sm" />
            </div>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 min-w-0">
          <div className="min-w-0">
            <label className="block text-[11px] font-mono uppercase text-[#6B6E72] mb-1">Start</label>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full max-w-full min-w-0 box-border border border-black rounded px-2 py-2 text-sm" />
          </div>
          <div className="min-w-0">
            <label className="block text-[11px] font-mono uppercase text-[#6B6E72] mb-1">End</label>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-full max-w-full min-w-0 box-border border border-black rounded px-2 py-2 text-sm" />
          </div>
        </div>
        {formError && <p className="text-xs text-[#B5533C]">{formError}</p>}
        <div className="flex gap-2 pt-2">
          <button type="button" onClick={onCancel} className="flex-1 py-2 rounded text-sm border border-black">Cancel</button>
          <button type="button" disabled={!address.trim()} onClick={submit} className="flex-1 py-2 rounded text-sm text-white bg-black disabled:opacity-40">
            Create
          </button>
        </div>
      </div>
    </div>
  )
}


function ProjectDetail({ project, isAdmin, canUpload, isCustomer, profile, onBack, onReload, onDelete, logActivity }) {
  const [showExport, setShowExport] = useState(false)
  const [selectedPhaseId, setSelectedPhaseId] = useState(null)
  const [newPhaseName, setNewPhaseName] = useState('')
  const [newFinishingName, setNewFinishingName] = useState('')
  const [companyUsers, setCompanyUsers] = useState([])
  const [uploadingFile, setUploadingFile] = useState(false)
  const [editingProject, setEditingProject] = useState(false)
  const [editAddress, setEditAddress] = useState(project.address || '')
  const [editStart, setEditStart] = useState(project.start_date || '')
  const [editEnd, setEditEnd] = useState(project.end_date || '')
  const [editCover, setEditCover] = useState(project.cover_photo_url || null)
  const [dragIdx, setDragIdx] = useState(null)
  const [dragOverIdx, setDragOverIdx] = useState(null)
  const [localPhases, setLocalPhases] = useState(project.phases || [])
  const [editingPhaseId, setEditingPhaseId] = useState(null)
  const [editingPhaseName, setEditingPhaseName] = useState('')
  const [showPeople, setShowPeople] = useState(false)
  const touchX = useRef(null)
  const pointerDrag = useRef(null) // { fromIdx, startY }
  const phases = localPhases.length ? localPhases : (project.phases || [])

  useEffect(() => {
    setLocalPhases(project.phases || [])
  }, [project.phases])
  const files = project.project_files || []
  const assignedCustomers = (project.project_customers || []).map((m) => m.user_id)
  const selected = phases.find((p) => p.id === selectedPhaseId)

  useEffect(() => {
    setEditAddress(project.address || '')
    setEditStart(project.start_date || '')
    setEditEnd(project.end_date || '')
    setEditCover(project.cover_photo_url || null)
  }, [project.id, project.address, project.start_date, project.end_date, project.cover_photo_url])

  useEffect(() => {
    if (!isAdmin || !profile?.company_id) return
    supabase
      .from('profiles')
      .select('id, name, email, role')
      .eq('company_id', profile.company_id)
      .then(({ data }) => setCompanyUsers(data || []))
  }, [isAdmin, profile?.company_id, project.id])

  if (selected) {
    return (
      <PhaseDetail
        phase={selected}
        project={project}
        isAdmin={isAdmin}
        canUpload={canUpload}
        isCustomer={isCustomer}
        profile={profile}
        onBack={() => setSelectedPhaseId(null)}
        onReload={onReload}
        logActivity={logActivity}
      />
    )
  }

  if (showPeople) {
    return (
      <ProjectPeoplePage
        project={project}
        isAdmin={isAdmin}
        companyUsers={companyUsers}
        onBack={() => setShowPeople(false)}
        onReload={onReload}
      />
    )
  }

  const doneCount = phases.filter((p) => p.status === 'done').length

  const setStatus = async (status) => {
    if (!isAdmin) return
    await supabase.from('projects').update({ status }).eq('id', project.id)
    await logActivity('updated project status', status)
    onReload()
  }

  const cyclePhase = async (phase) => {
    if (!isAdmin) return
    const next = nextPhaseStatus(phase.status)
    await supabase.from('phases').update({ status: next }).eq('id', phase.id)
    await logActivity('updated phase status', phase.name, project.id, phase.name)
    onReload()
  }

  const addPhase = async (toFinishing = false) => {
    if (!isAdmin) return
    const raw = (toFinishing ? newFinishingName : newPhaseName).trim()
    if (!raw) return
    const name = toFinishing
      ? (isFinishingPhase(raw) ? raw : ('Finishing — ' + raw))
      : raw
    const maxOrder = phases.reduce((m, ph) => Math.max(m, ph.sort_order ?? 0), -1)
    const { error } = await supabase.from('phases').insert({
      project_id: project.id,
      name,
      sort_order: maxOrder + 1,
      status: 'pending',
      trade: '',
    })
    if (error) {
      alert(error.message)
      return
    }
    if (toFinishing) setNewFinishingName('')
    else setNewPhaseName('')
    await logActivity('added phase', name, project.id, name)
    onReload()
  }

  const reorderPhases = async (fromIdx, toIdx) => {
    if (!isAdmin) return
    if (fromIdx === toIdx || fromIdx == null || toIdx == null) return
    const list = localPhases.length ? localPhases : (project.phases || [])
    if (fromIdx < 0 || toIdx < 0 || fromIdx >= list.length || toIdx >= list.length) return
    const ordered = list.slice()
    const [item] = ordered.splice(fromIdx, 1)
    ordered.splice(toIdx, 0, item)
    setLocalPhases(ordered)
    const results = await Promise.all(
      ordered.map((ph, i) =>
        supabase.from('phases').update({ sort_order: i }).eq('id', ph.id)
      )
    )
    const err = results.find((r) => r.error)?.error
    if (err) {
      alert(err.message)
      setLocalPhases(project.phases || [])
      return
    }
    onReload()
  }

  const movePhaseBy = (index, delta) => {
    reorderPhases(index, index + delta)
  }

  // Touch + mouse drag via pointer events (works on iPhone)
  const onPhasePointerDown = (e, index) => {
    if (!isAdmin) return
    // only primary button / touch
    if (e.pointerType === 'mouse' && e.button !== 0) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    pointerDrag.current = { fromIdx: index, startY: e.clientY, lastOver: index }
    setDragIdx(index)
    setDragOverIdx(index)
  }

  const onPhasePointerMove = (e) => {
    if (!pointerDrag.current || !isAdmin) return
    const list = localPhases.length ? localPhases : (project.phases || [])
    const rowH = 64 // approximate row height
    const delta = e.clientY - pointerDrag.current.startY
    let over = pointerDrag.current.fromIdx + Math.round(delta / rowH)
    over = Math.max(0, Math.min(list.length - 1, over))
    pointerDrag.current.lastOver = over
    setDragOverIdx(over)
  }

  const onPhasePointerUp = async (e) => {
    if (!pointerDrag.current || !isAdmin) return
    const from = pointerDrag.current.fromIdx
    const to = pointerDrag.current.lastOver
    pointerDrag.current = null
    setDragIdx(null)
    setDragOverIdx(null)
    try {
      e.currentTarget.releasePointerCapture?.(e.pointerId)
    } catch (_) {}
    if (from !== to) await reorderPhases(from, to)
  }

  const savePhaseName = async (phaseId) => {
    if (!isAdmin) return
    const name = editingPhaseName.trim()
    if (!name) {
      setEditingPhaseId(null)
      return
    }
    const { error } = await supabase.from('phases').update({ name }).eq('id', phaseId)
    if (error) alert(error.message)
    setEditingPhaseId(null)
    onReload()
  }

  const saveProjectEdits = async () => {
    if (!isAdmin) return
    const { error } = await supabase.from('projects').update({
      address: editAddress.trim() || project.address,
      start_date: editStart || null,
      end_date: editEnd || null,
      cover_photo_url: editCover,
    }).eq('id', project.id)
    if (error) {
      alert(error.message)
      return
    }
    setEditingProject(false)
    onReload()
  }

  const uploadCoverEdit = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !profile?.company_id) return
    const safeName = (file.name || 'cover.jpg').replace(/[^a-zA-Z0-9._-]/g, '_')
    const path = profile.company_id + '/' + project.id + '/covers/' + Date.now() + '-' + safeName
    const bytes = await file.arrayBuffer()
    const { error: upErr } = await supabase.storage.from('project-photos').upload(path, bytes, {
      contentType: file.type || 'image/jpeg',
    })
    if (upErr) {
      alert(upErr.message)
      return
    }
    const { data: pub } = supabase.storage.from('project-photos').getPublicUrl(path)
    setEditCover(pub.publicUrl)
  }

  const onTouchStart = (e) => {
    touchX.current = e.touches[0].clientX
  }
  const onTouchEnd = (e) => {
    if (touchX.current == null) return
    const dx = e.changedTouches[0].clientX - touchX.current
    touchX.current = null
    if (dx > 90) onBack()
  }

  return (
    <SwipeBack onBack={onBack}>
            <button onClick={onBack} className="flex items-center gap-1 text-sm text-[#6B6E72] mb-4">
        <ChevronLeft size={16} /> All projects
      </button>

      <div className="bg-white border border-black rounded-md overflow-hidden mb-4">
        {(editingProject ? editCover : project.cover_photo_url) && (
          <img src={editingProject ? editCover : project.cover_photo_url} alt="" className="w-full h-44 object-cover" />
        )}
        <div className="p-5">
          {!editingProject ? (
            <>
              <div className="flex justify-between items-start gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-black">
                    {formatStyleLabel(project.style)}
                  </div>
                  <h2 className="font-display text-2xl leading-tight truncate flex items-center gap-1.5">
                    <MapPin size={16} className="flex-shrink-0 text-[#6B6E72]" />
                    <span className="truncate">{project.address}</span>
                  </h2>
                </div>
                <StatusBadge status={project.status} map={PROJECT_STATUS} />
              </div>
              <div className="text-[11px] font-mono text-[#6B6E72] mt-2">
                {fmtDate(project.start_date)} – {project.end_date ? fmtDate(project.end_date) : 'TBD'}
              </div>
              {isAdmin && (
                <button type="button" onClick={() => setEditingProject(true)} className="mt-3 text-xs underline text-[#6B6E72]">
                  Edit address, dates & cover
                </button>
              )}
            </>
          ) : (
            <div className="space-y-3 min-w-0">
              <div>
                <label className="block text-[11px] font-mono uppercase text-[#6B6E72] mb-1">Address</label>
                <input value={editAddress} onChange={(e) => setEditAddress(e.target.value)} className="w-full border border-black rounded px-3 py-2 text-sm" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 min-w-0">
                <div className="min-w-0">
                  <label className="block text-[11px] font-mono uppercase text-[#6B6E72] mb-1">Start</label>
                  <input type="date" value={editStart || ''} onChange={(e) => setEditStart(e.target.value)} className="w-full max-w-full min-w-0 box-border border border-black rounded px-2 py-2 text-sm" />
                </div>
                <div className="min-w-0">
                  <label className="block text-[11px] font-mono uppercase text-[#6B6E72] mb-1">End</label>
                  <input type="date" value={editEnd || ''} onChange={(e) => setEditEnd(e.target.value)} className="w-full max-w-full min-w-0 box-border border border-black rounded px-2 py-2 text-sm" />
                </div>
              </div>
              <label className="block text-xs border border-black rounded px-3 py-2 cursor-pointer text-center">
                Change cover photo
                <input type="file" accept="image/*" className="hidden" onChange={uploadCoverEdit} />
              </label>
              <div className="flex gap-2">
                <button type="button" onClick={() => setEditingProject(false)} className="flex-1 py-2 border border-black rounded text-sm">Cancel</button>
                <button type="button" onClick={saveProjectEdits} className="flex-1 py-2 bg-black text-white rounded text-sm">Save</button>
              </div>
            </div>
          )}
          <div className="mt-3">
            <div className="flex justify-between text-[11px] font-mono text-[#6B6E72] mb-1">
              <span>{doneCount} of {phases.length} phases complete</span>
            </div>
            <div className="h-2 rounded-full bg-[#E9E9E7] overflow-hidden flex">
              <div
                className="h-full bg-[#3F7D58]"
                style={{ width: `${phases.length ? (doneCount / phases.length) * 100 : 0}%` }}
              />
              <div
                className="h-full bg-[#E6B800]"
                style={{ width: `${phases.length ? (phases.filter((ph) => ph.status === 'active').length / phases.length) * 100 : 0}%` }}
              />
            </div>
          </div>
          {isCustomer && (
            <div className="mt-3 text-sm text-[#6B6E72]">
              {Math.round(phases.length ? (doneCount / phases.length) * 100 : 0)}% complete
              {(() => {
                const active = phases.find((ph) => ph.status === 'active')
                return active ? <span> · In progress: {active.name}</span> : null
              })()}
            </div>
          )}

        </div>
      </div>

      <div className="space-y-2 mb-4">
        {phases.map((phase, i) => {
          if (isFinishingPhase(phase.name)) return null
          const mainNum = phases.slice(0, i + 1).filter((p) => !isFinishingPhase(p.name)).length
          return (
          <div key={'wrap-' + phase.id}>
          <div
            key={phase.id}
className={`bg-white border border-black rounded-md flex items-stretch overflow-hidden ${dragIdx === i ? 'opacity-60 scale-[0.98]' : ''} ${dragOverIdx === i && dragIdx !== null && dragIdx !== i ? 'ring-2 ring-black' : ''}`}
          >
            {isAdmin && (
              <div
                onPointerDown={(e) => onPhasePointerDown(e, i)}
                onPointerMove={onPhasePointerMove}
                onPointerUp={onPhasePointerUp}
                onPointerCancel={onPhasePointerUp}
                className="w-11 flex flex-col items-center justify-center gap-0.5 text-white flex-shrink-0 cursor-grab active:cursor-grabbing select-none touch-none"
                style={{
                  background: (PHASE_STATUS[phase.status] || PHASE_STATUS.pending).color,
                  touchAction: 'none',
                }}
                              >
                <span className="text-sm leading-none opacity-90">⋮⋮</span>
                <span className="font-mono text-xs">{mainNum}</span>
              </div>
            )}
            {!isAdmin && (
              <div
                className="w-9 flex items-center justify-center font-mono text-xs text-white flex-shrink-0"
                style={{ background: (PHASE_STATUS[phase.status] || PHASE_STATUS.pending).color }}
              >
                {mainNum}
              </div>
            )}
            <button
              type="button"
              className="flex-1 text-left px-3 py-3 min-w-0"
              onClick={() => setSelectedPhaseId(phase.id)}
            >
              <div className="text-sm font-medium truncate">{phase.name}</div>
              <div className="text-[11px] text-[#8A8D91] mt-0.5 flex flex-wrap gap-x-2">
                {!isCustomer && phase.trade && <span className="font-medium text-black">{phase.trade}</span>}
                <span>{(phase.photos || []).length} photo{(phase.photos || []).length !== 1 ? 's' : ''}</span>
              </div>
            </button>
            {isAdmin && (
              <div className="flex flex-col border-l border-black/20">
                <button
                  type="button"
                  disabled={i === 0}
                  onClick={() => movePhaseBy(i, -1)}
                  className="px-2.5 py-1.5 disabled:opacity-25"
                  title="Move up"
                >
                  <ChevronUp size={18} />
                </button>
                <button
                  type="button"
                  disabled={i === phases.length - 1}
                  onClick={() => movePhaseBy(i, 1)}
                  className="px-2.5 py-1.5 disabled:opacity-25"
                  title="Move down"
                >
                  <ChevronDown size={18} />
                </button>
              </div>
            )}
            {isAdmin ? (
              <button type="button" onClick={() => cyclePhase(phase)} className="px-2 flex items-center border-l border-black/20" title="Cycle status">
                {phase.status === 'done' ? (
                  <Check size={16} className="text-[#3F7D58]" />
                ) : (
                  <div className="w-2.5 h-2.5 rounded-full" style={{ background: (PHASE_STATUS[phase.status] || PHASE_STATUS.pending).color }} />
                )}
              </button>
            ) : (
              <div className="px-2 flex items-center">
                {phase.status === 'done' ? (
                  <Check size={16} className="text-[#3F7D58]" />
                ) : (
                  <div className="w-2.5 h-2.5 rounded-full" style={{ background: (PHASE_STATUS[phase.status] || PHASE_STATUS.pending).color }} />
                )}
              </div>
            )}
          </div>
          </div>
        )})}
      </div>

      {isAdmin && (
        <div className="bg-white border border-dashed border-black rounded-md p-3 flex gap-2 mb-4">
          <input
            value={newPhaseName}
            onChange={(e) => setNewPhaseName(e.target.value)}
            placeholder="Add a phase"
            className="flex-1 border border-black rounded px-3 py-2 text-sm"
            onKeyDown={(e) => { if (e.key === 'Enter') addPhase(false) }}
          />
          <button
            type="button"
            onClick={() => addPhase(false)}
            disabled={!newPhaseName.trim()}
            className="px-3 rounded bg-black text-white disabled:opacity-40"
          >
            <Plus size={16} />
          </button>
        </div>
      )}

      <div className="text-[11px] font-mono uppercase text-[#6B6E72] pt-2 pb-1 border-t border-black mt-1 mb-2">
        Finishing
      </div>
      <div className="space-y-2 mb-2">
        {(() => {
          const finishing = phases.filter((ph) => isFinishingPhase(ph.name))
          if (!finishing.length) {
            return <p className="text-xs text-[#8A8D91]">No finishing phases yet. Add trades below.</p>
          }
          return finishing.map((phase, fi) => {
            const globalIdx = phases.findIndex((p) => p.id === phase.id)
            return (
              <div
                key={'fin-' + phase.id}
                className="bg-white border border-black rounded-md flex items-stretch overflow-hidden"
              >
                <div
                  className="w-9 flex items-center justify-center font-mono text-xs text-white flex-shrink-0"
                  style={{ background: (PHASE_STATUS[phase.status] || PHASE_STATUS.pending).color }}
                >
                  {fi + 1}
                </div>
                <button
                  type="button"
                  className="flex-1 text-left px-3 py-3 min-w-0"
                  onClick={() => setSelectedPhaseId(phase.id)}
                >
                  <div className="text-sm font-medium truncate">{finishingLabel(phase.name)}</div>
                  <div className="text-[11px] text-[#8A8D91] mt-0.5">
                    {(phase.photos || []).length} photo{(phase.photos || []).length !== 1 ? 's' : ''}
                  </div>
                </button>
                {isAdmin && (
                  <div className="flex flex-col border-l border-black/20">
                    <button
                      type="button"
                      disabled={fi === 0}
                      onClick={() => {
                        if (globalIdx <= 0) return
                        // swap with previous finishing only
                        const prevFin = finishing[fi - 1]
                        const prevIdx = phases.findIndex((p) => p.id === prevFin.id)
                        movePhaseBy(globalIdx, prevIdx - globalIdx)
                      }}
                      className="px-2.5 py-1.5 disabled:opacity-25"
                      title="Move up"
                    >
                      <ChevronUp size={18} />
                    </button>
                    <button
                      type="button"
                      disabled={fi === finishing.length - 1}
                      onClick={() => {
                        const nextFin = finishing[fi + 1]
                        const nextIdx = phases.findIndex((p) => p.id === nextFin.id)
                        movePhaseBy(globalIdx, nextIdx - globalIdx)
                      }}
                      className="px-2.5 py-1.5 disabled:opacity-25"
                      title="Move down"
                    >
                      <ChevronDown size={18} />
                    </button>
                  </div>
                )}
                {isAdmin ? (
                  <button type="button" onClick={() => cyclePhase(phase)} className="px-2 flex items-center border-l border-black/20" title="Cycle status">
                    {phase.status === 'done' ? (
                      <Check size={16} className="text-[#3F7D58]" />
                    ) : (
                      <div className="w-2.5 h-2.5 rounded-full" style={{ background: (PHASE_STATUS[phase.status] || PHASE_STATUS.pending).color }} />
                    )}
                  </button>
                ) : (
                  <div className="px-2 flex items-center">
                    {phase.status === 'done' ? (
                      <Check size={16} className="text-[#3F7D58]" />
                    ) : (
                      <div className="w-2.5 h-2.5 rounded-full" style={{ background: (PHASE_STATUS[phase.status] || PHASE_STATUS.pending).color }} />
                    )}
                  </div>
                )}
              </div>
            )
          })
        })()}
      </div>
      {isAdmin && (
        <div className="bg-white border border-dashed border-black rounded-md p-3 flex gap-2 mb-4">
          <input
            value={newFinishingName}
            onChange={(e) => setNewFinishingName(e.target.value)}
            placeholder="Add finishing phase (e.g. Electrical)"
            className="flex-1 border border-black rounded px-3 py-2 text-sm"
            onKeyDown={(e) => { if (e.key === 'Enter') addPhase(true) }}
          />
          <button
            type="button"
            onClick={() => addPhase(true)}
            disabled={!newFinishingName.trim()}
            className="px-3 rounded bg-black text-white disabled:opacity-40"
          >
            <Plus size={16} />
          </button>
        </div>
      )}

      {isAdmin && (
        <div className="mb-4">
          <label className="block text-[11px] font-mono uppercase text-[#6B6E72] mb-1">Project status</label>
          <div className="flex gap-2 flex-wrap">
            {Object.entries(PROJECT_STATUS).map(([key, s]) => (
              <button
                key={key}
                onClick={() => setStatus(key)}
                className="text-[11px] font-mono uppercase tracking-wide px-2 py-1 rounded-sm border-2"
                style={{
                  color: project.status === key ? '#fff' : s.color,
                  background: project.status === key ? s.color : s.bg,
                  borderColor: s.color,
                }}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      )}


      {/* Change orders: team → admin price → customer */}
      <div className="bg-white border border-black rounded-md p-4 mb-4">
        <div className="flex items-center justify-between gap-2 mb-2">
          <h3 className="text-[11px] font-mono uppercase text-[#6B6E72]">Change orders</h3>
          {isAdmin && (project.change_orders || []).some((c) => ['pending', 'quoted'].includes(c.status || '')) && (
            <span className="text-[10px] font-mono uppercase bg-[#E6B800] text-black px-2 py-0.5 rounded">
              {(project.change_orders || []).filter((c) => ['pending', 'quoted'].includes(c.status || '')).length} open
            </span>
          )}
        </div>
        {(isAdmin || isCustomer) && (project.change_orders || []).length > 0 && (() => {
          const cos = project.change_orders || []
          const accepted = cos.filter((c) => c.status === 'approved')
          const declined = cos.filter((c) => c.status === 'rejected')
          const open = cos.filter((c) => ['pending', 'quoted'].includes(c.status || ''))
          const sum = (arr) => arr.reduce((s, c) => s + (Number(c.amount) || 0), 0)
          return (
            <div className="grid grid-cols-3 gap-2 mb-3 text-center">
              <div className="border border-[#E5E5E5] rounded p-2">
                <div className="text-[10px] font-mono uppercase text-[#6B6E72]">Open</div>
                <div className="text-sm font-medium">{open.length}</div>
                <div className="text-[10px] text-[#6B6E72]">${sum(open).toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
              </div>
              <div className="border border-[#E5E5E5] rounded p-2">
                <div className="text-[10px] font-mono uppercase text-[#6B6E72]">Accepted</div>
                <div className="text-sm font-medium text-[#3F7D58]">${sum(accepted).toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                <div className="text-[10px] text-[#6B6E72]">{accepted.length} item{accepted.length !== 1 ? 's' : ''}</div>
              </div>
              <div className="border border-[#E5E5E5] rounded p-2">
                <div className="text-[10px] font-mono uppercase text-[#6B6E72]">Declined</div>
                <div className="text-sm font-medium text-[#B5533C]">${sum(declined).toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                <div className="text-[10px] text-[#6B6E72]">{declined.length} item{declined.length !== 1 ? 's' : ''}</div>
              </div>
            </div>
          )
        })()}
        {(project.change_orders || []).length > 0 && (
          <div className="space-y-3 mb-3">
            {(project.change_orders || [])
              .slice()
              .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
              .map((co) => {
                const phaseName = (project.phases || []).find((ph) => ph.id === co.phase_id)?.name
                const st = co.status || 'approved'
                return (
                  <div key={co.id} className="border border-[#E5E5E5] rounded p-3">
                    <div className="flex justify-between gap-2 items-start">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-sm font-medium">{co.title}</div>
                          <span
                            className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded"
                            style={{
                              background: st === 'pending' || st === 'quoted' ? '#FFF8DB' : st === 'rejected' ? '#FCE7DB' : '#E1EDE4',
                              color: st === 'pending' || st === 'quoted' ? '#8A6D00' : st === 'rejected' ? '#B5533C' : '#3F7D58',
                            }}
                          >
                            {st === 'quoted' ? ((isAdmin || isCustomer) ? 'Offer sent' : 'With customer') : st === 'rejected' ? 'Declined' : st === 'approved' ? 'Approved' : st === 'pending' ? (co.origin === 'team_request' ? 'Awaiting contractor price' : (isAdmin || isCustomer ? 'Customer request' : 'Submitted')) : st}
                          </span>
                        </div>
                        <div className="text-[10px] font-mono text-[#8A8D91] mt-0.5">
                          {fmtDateTime(co.created_at)}
                          {phaseName ? ` · ${phaseName}` : ''}
                          {co.origin === 'admin_offer' ? ' · Contractor offer' : co.origin === 'team_request' ? ' · Trade request' : ' · Customer request'}
                        </div>
                        {(isAdmin || isCustomer) && (
                          <div className="text-[10px] text-[#8A8D91] mt-0.5">
                            {co.decided_at ? `Decided ${fmtDateTime(co.decided_at)}` : st === 'quoted' ? 'Awaiting customer decision' : st === 'pending' ? 'Awaiting admin quote' : ''}
                          </div>
                        )}
                      </div>
                      {isAdmin && (
                        <button
                          type="button"
                          className="text-[#B5533C] p-1 flex-shrink-0"
                          onClick={async () => {
                            if (!confirm('Delete this change order?')) return
                            if (co.storage_path) await supabase.storage.from('project-photos').remove([co.storage_path])
                            await supabase.from('change_orders').delete().eq('id', co.id)
                            onReload()
                          }}
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                    {co.description && <p className="text-xs mt-2 whitespace-pre-wrap">{co.description}</p>}
                    {co.public_url && (
                      <a href={co.public_url} target="_blank" rel="noreferrer" className="text-xs underline mt-2 inline-block">
                        View attachment
                      </a>
                    )}
                    {isAdmin && co.team_amount != null && co.team_amount !== '' && (
                      <div className="text-xs mt-2 text-[#6B6E72]">
                        Trade request: ${Number(co.team_amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                    )}
                    {isAdmin && co.admin_fee != null && Number(co.admin_fee) > 0 && (
                      <div className="text-xs text-[#6B6E72]">
                        Contractor fee: ${Number(co.admin_fee).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                    )}
                    {(isAdmin || isCustomer) && (co.amount != null && co.amount !== '') && (
                      <div className="text-sm mt-1 font-medium">
                        {isCustomer ? 'Amount' : (co.origin === 'admin_offer' ? 'Customer offer' : 'Customer total')}: ${Number(co.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                    )}
                    {!isAdmin && !isCustomer && co.team_amount != null && co.team_amount !== '' && (
                      <div className="text-sm mt-2 font-medium">
                        Cost: ${Number(co.team_amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                    )}
                    {!isAdmin && !isCustomer && st === 'approved' && (
                      <div className="text-xs mt-1 text-[#3F7D58]">
                        Customer approved{co.team_amount != null ? ` — $${Number(co.team_amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : ''}
                      </div>
                    )}
                    {!isAdmin && !isCustomer && st === 'rejected' && (
                      <div className="text-xs mt-2 text-[#B5533C]">Customer declined</div>
                    )}
                    {isAdmin && st === 'approved' && (co.amount != null) && (
                      <div className="text-xs mt-1 text-[#3F7D58]">
                        Approved at customer total ${Number(co.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                    )}
                    {(isAdmin || isCustomer) && co.admin_reply && (
                      <p className="text-xs mt-1 text-[#6B6E72] whitespace-pre-wrap">{co.admin_reply}</p>
                    )}
                    {isAdmin && st === 'rejected' && (
                      <p className="text-xs mt-2 text-[#B5533C]">
                        Customer declined{co.decided_at ? ` on ${fmtDate(co.decided_at)}` : ''}. Kept for your records.
                      </p>
                    )}
                    {isAdmin && st === 'approved' && co.origin === 'admin_offer' && (
                      <p className="text-xs mt-2 text-[#3F7D58]">
                        Customer accepted this offer{co.decided_at ? ` on ${fmtDate(co.decided_at)}` : ''}.
                      </p>
                    )}
                    {isAdmin && st === 'pending' && (
                      <QuoteReplyForm
                        changeOrder={co}
                        profile={profile}
                        logActivity={logActivity}
                        onDone={onReload}
                      />
                    )}
                    {isCustomer && st === 'quoted' && (
                      <div className="flex gap-2 mt-3">
                        <button
                          type="button"
                          className="flex-1 py-2 text-sm rounded text-white bg-[#3F7D58]"
                          onClick={async () => {
                            const { error } = await supabase.from('change_orders').update({
                              status: 'approved',
                              decided_at: new Date().toISOString(),
                              decided_by: profile.id,
                            }).eq('id', co.id)
                            if (error) { alert(error.message); return }
                            await logActivity?.('accepted change order quote', co.title)
                            onReload()
                          }}
                        >
                          Accept amount
                        </button>
                        <button
                          type="button"
                          className="flex-1 py-2 text-sm rounded border border-black"
                          onClick={async () => {
                            const amt = co.amount != null ? '$' + Number(co.amount).toLocaleString(undefined, { minimumFractionDigits: 2 }) : 'this offer'
                            if (!confirm('Decline ' + amt + ' for "' + co.title + '"?')) return
                            const { error } = await supabase.from('change_orders').update({
                              status: 'rejected',
                              decided_at: new Date().toISOString(),
                              decided_by: profile.id,
                            }).eq('id', co.id)
                            if (error) { alert(error.message); return }
                            await logActivity?.('declined change order quote', co.title)
                            onReload()
                          }}
                        >
                          Decline
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
          </div>
        )}
        <ChangeOrderForm
            project={project}
            profile={profile}
            isAdmin={isAdmin}
            isTeam={!isAdmin && !isCustomer}
            onDone={onReload}
            logActivity={logActivity}
          />
      </div>



      {isAdmin && (
        <div className="bg-white border border-black rounded-md p-4 mb-4">
          <h3 className="text-[11px] font-mono uppercase text-[#6B6E72] mb-2">Activity</h3>
          <ProjectActivity projectId={project.id} />
        </div>
      )}
      {/* Plans / files */}
      <div className="bg-white border border-black rounded-md p-4 mb-4">
        <h3 className="text-[11px] font-mono uppercase text-[#6B6E72] mb-2">Plans & files</h3>
        {files.length === 0 && <p className="text-xs text-[#8A8D91] mb-2">No files attached yet.</p>}
        <div className="space-y-2 mb-3">
          {files.map((f) => (
            <div key={f.id} className="flex items-center justify-between gap-2 text-sm border-b border-[#E5E5E5] py-1.5">
              <a href={f.public_url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 min-w-0 truncate text-black underline">
                <FileText size={14} /> <span className="truncate">{f.file_name || 'File'}</span>
              </a>
              {isAdmin && (
                <button
                  type="button"
                  className="text-[#B5533C] text-xs flex-shrink-0"
                  onClick={async () => {
                    if (!confirm('Delete this file?')) return
                    if (f.storage_path) await supabase.storage.from('project-photos').remove([f.storage_path])
                    await supabase.from('project_files').delete().eq('id', f.id)
                    onReload()
                  }}
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          ))}
        </div>
        {isAdmin && (
          <label className="w-full flex items-center justify-center gap-1.5 text-sm border border-black rounded px-3 py-2 cursor-pointer">
            {uploadingFile ? 'Uploading…' : 'Upload plan / file'}
            <input
              type="file"
              className="hidden"
              disabled={uploadingFile}
              onChange={async (e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (!file) return
                setUploadingFile(true)
                try {
                  const safeName = (file.name || 'plan.pdf').replace(/[^a-zA-Z0-9._-]/g, '_')
                  const path = profile.company_id + '/' + project.id + '/files/' + Date.now() + '-' + safeName
                  const bytes = await file.arrayBuffer()
                  const { error: upErr } = await supabase.storage.from('project-photos').upload(path, bytes, {
                    contentType: file.type || 'application/octet-stream',
                  })
                  if (upErr) throw upErr
                  const { data: pub } = supabase.storage.from('project-photos').getPublicUrl(path)
                  const { error: insErr } = await supabase.from('project_files').insert({
                    project_id: project.id,
                    storage_path: path,
                    public_url: pub.publicUrl,
                    file_name: file.name,
                    file_type: file.type,
                    uploaded_by: profile.id,
                  })
                  if (insErr) throw insErr
                  await logActivity('uploaded file', file.name)
                  onReload()
                } catch (err) {
                  alert(err.message || 'Upload failed')
                }
                setUploadingFile(false)
              }}
            />
          </label>
        )}
      </div>

      {!isCustomer && (
        <button
          type="button"
          onClick={() => setShowPeople(true)}
          className="w-full mb-4 py-2.5 rounded border border-black text-sm text-left px-4 hover:bg-[#F5F5F5]"
        >
          Who’s on this project →
        </button>
      )}

      {isAdmin && (
        <div className="flex flex-wrap gap-3 mb-4">
          <button
            type="button"
            className="text-xs border border-black rounded px-3 py-1.5 flex items-center gap-1"
            onClick={() => setShowExport(true)}
          >
            <Printer size={13} /> Export / Print
          </button>
          <button
            type="button"
            className="text-xs border border-black rounded px-3 py-1.5 flex items-center gap-1"
            onClick={async () => {
              await supabase.from('projects').update({ archived: !project.archived }).eq('id', project.id)
              onReload()
              onBack()
            }}
          >
            <Archive size={13} /> {project.archived ? 'Unarchive' : 'Archive'}

          {isAdmin && project.status === 'done' && !(project.phases || []).some((ph) => /punch/i.test(ph.name || '')) && (
            <button
              type="button"
              className="text-xs border border-black rounded px-3 py-1.5 flex items-center gap-1"
              onClick={async () => {
                if (!confirm('Add a Punch List / Warranty phase to this completed project?')) return
                const maxOrder = Math.max(0, ...(project.phases || []).map((ph) => ph.sort_order || 0))
                const { error } = await supabase.from('phases').insert({
                  project_id: project.id,
                  name: 'Punch List / Warranty',
                  sort_order: maxOrder + 1,
                  status: 'active',
                  trade: '',
                })
                if (error) alert(error.message)
                else {
                  await logActivity?.('added phase', 'Punch List / Warranty', project.id)
                  onReload()
                }
              }}
            >
              Punch list
            </button>
          )}
          </button>
        </div>
      )}

      {showExport && (
        <SwipeBack onBack={() => setShowExport(false)}>
          <div className="fixed inset-0 z-[60] bg-white flex flex-col" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-black">
              <button type="button" onClick={() => setShowExport(false)} className="flex items-center gap-1 text-sm text-[#6B6E72]">
                <ChevronLeft size={16} /> Close
              </button>
              <button
                type="button"
                className="text-sm font-medium px-3 py-1.5 bg-black text-white rounded"
                onClick={() => window.print()}
              >
                Print
              </button>
            </div>
            <div className="flex-1 overflow-auto p-6 max-w-2xl mx-auto w-full" id="export-print-area">
              <h1 className="font-display text-2xl mb-2">{project.address}</h1>
              <p className="text-sm text-[#6B6E72] mb-4">{doneCount} / {phases.length} phases complete</p>
              <h2 className="text-sm font-medium mb-2">Phases</h2>
              <ul className="text-sm space-y-1 mb-6">
                {phases.map((ph) => (
                  <li key={ph.id}>{ph.name} — {ph.status}</li>
                ))}
              </ul>
              <h2 className="text-sm font-medium mb-2">Approved change orders</h2>
              <ul className="text-sm space-y-1">
                {(project.change_orders || []).filter((c) => (c.status || 'approved') === 'approved').length
                  ? (project.change_orders || []).filter((c) => (c.status || 'approved') === 'approved').map((c) => (
                      <li key={c.id}>{c.title}{c.amount != null ? ` — $${Number(c.amount).toFixed(2)}` : ''}</li>
                    ))
                  : <li>None</li>}
              </ul>
            </div>
          </div>
        </SwipeBack>
      )}

      {isAdmin && (
        <button onClick={() => onDelete(project.id)} className="text-xs text-[#B5533C] flex items-center gap-1">
          <Trash2 size={13} /> Delete this project
        </button>
      )}
    </SwipeBack>
  )
}



function ProjectPeoplePage({ project, isAdmin, companyUsers, onBack, onReload }) {
  const phases = project.phases || []
  const customerIds = (project.project_customers || []).map((c) => c.user_id)
  const customers = companyUsers.filter((u) => u.role === 'customer')
  const team = companyUsers.filter((u) => u.role === 'team')

  // Build map userId -> phase names assigned
  const teamByPhase = {}
  phases.forEach((ph) => {
    (ph.phase_team || []).forEach((m) => {
      if (!teamByPhase[m.user_id]) teamByPhase[m.user_id] = []
      teamByPhase[m.user_id].push(ph.name)
    })
  })

  return (
    <SwipeBack onBack={onBack}>
    <div>
      <button type="button" onClick={onBack} className="flex items-center gap-1 text-sm text-[#6B6E72] mb-4">
        <ChevronLeft size={16} /> Back to project
      </button>
      <h2 className="font-display text-2xl mb-1">Who’s on this project</h2>
      <p className="text-sm text-[#6B6E72] mb-6">{project.address}</p>

      <div className="bg-white border border-black rounded-md p-4 mb-4">
        <h3 className="text-[11px] font-mono uppercase text-[#6B6E72] mb-3">Customers</h3>
        {isAdmin && customers.length > 0 ? (
          <div className="space-y-2">
            {customers.map((u) => {
              const on = customerIds.includes(u.id)
              return (
                <label key={u.id} className="flex items-center gap-2 text-sm min-h-[40px] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={async () => {
                      if (on) await supabase.from('project_customers').delete().eq('project_id', project.id).eq('user_id', u.id)
                      else await supabase.from('project_customers').insert({ project_id: project.id, user_id: u.id })
                      onReload()
                    }}
                  />
                  <span className="truncate">{u.name || u.email}</span>
                </label>
              )
            })}
          </div>
        ) : (
          <ul className="text-sm space-y-1">
            {customers.filter((u) => customerIds.includes(u.id)).map((u) => (
              <li key={u.id}>{u.name || u.email}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="bg-white border border-black rounded-md p-4 mb-4">
        <h3 className="text-[11px] font-mono uppercase text-[#6B6E72] mb-1">Trade by phase</h3>
        {phases.length > 0 && isAdmin ? (
          <div className="space-y-4">
            {phases.map((ph) => {
              const assigned = (ph.phase_team || []).map((m) => m.user_id)
              return (
                <div key={ph.id} className="border border-[#E5E5E5] rounded p-3">
                  <div className="text-sm font-medium mb-2">{ph.name}</div>
                  {team.length > 0 && (
                    <div className="space-y-1.5">
                      {team.map((u) => {
                        const checked = assigned.includes(u.id)
                        return (
                          <label key={u.id} className="flex items-center gap-2 text-sm min-h-[36px] cursor-pointer">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={async () => {
                                if (checked) await supabase.from('phase_team').delete().eq('phase_id', ph.id).eq('user_id', u.id)
                                else await supabase.from('phase_team').insert({ phase_id: ph.id, user_id: u.id })
                                onReload()
                              }}
                            />
                            <span className="truncate">{u.name || u.email}</span>
                          </label>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <div className="space-y-2 text-sm">
            {team.filter((u) => teamByPhase[u.id]?.length).map((u) => (
              <div key={u.id}>
                <div className="font-medium">{u.name || u.email}</div>
                <div className="text-[11px] text-[#6B6E72]">{teamByPhase[u.id].join(', ')}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
    </SwipeBack>
  )
}



function PhaseTasks({ phase, project, isAdmin, profile, onReload, logActivity }) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [uploadingId, setUploadingId] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [editTitle, setEditTitle] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const tasks = phase.tasks || []

  const startEdit = (task) => {
    if (!isAdmin) return
    setEditingId(task.id)
    setEditTitle(task.title || '')
    setEditDescription(task.description || '')
  }

  const saveEdit = async (task) => {
    if (!isAdmin || !editTitle.trim()) return
    setEditSaving(true)
    const { error } = await supabase.from('tasks').update({
      title: editTitle.trim(),
      description: editDescription.trim() || null,
    }).eq('id', task.id)
    setEditSaving(false)
    if (error) {
      alert(error.message)
      return
    }
    setEditingId(null)
    await logActivity?.('edited task', editTitle.trim(), project.id, phase.name)
    onReload?.()
  }

  const createTask = async (e) => {
    e.preventDefault()
    if (!isAdmin || !title.trim()) return
    setSaving(true)
    const { error } = await supabase.from('tasks').insert({
      company_id: profile.company_id,
      project_id: project.id,
      phase_id: phase.id,
      title: title.trim(),
      description: description.trim() || null,
      status: 'open',
      created_by: profile.id,
    })
    setSaving(false)
    if (error) {
      alert(error.message)
      return
    }
    try {
      await supabase.rpc('notify_project_team', {
        p_company_id: profile.company_id,
        p_project_id: project.id,
        p_title: titleCase('New task'),
        p_body: (project.address ? project.address + '\n' : '') + 'Phase: ' + (phase.name || '—') + '\n' + title.trim(),
        p_kind: 'task',
      })
    } catch (_) {}
    await logActivity?.('created task', title.trim(), project.id, phase.name)
    setTitle('')
    setDescription('')
    onReload?.()
  }

  const markDone = async (task) => {
    if (!isAdmin) return
    const { error } = await supabase.from('tasks').update({
      status: 'done',
      completed_at: new Date().toISOString(),
    }).eq('id', task.id)
    if (error) {
      alert(error.message)
      return
    }
    await logActivity?.('completed task', task.title, project.id, phase.name)
    onReload?.()
  }

  const reopen = async (task) => {
    if (!isAdmin) return
    await supabase.from('tasks').update({ status: 'open', completed_at: null }).eq('id', task.id)
    onReload?.()
  }

  const deleteTask = async (task) => {
    if (!isAdmin) return
    if (!confirm('Delete this task?')) return
    const photos = task.task_photos || []
    const paths = photos.map((p) => p.storage_path).filter(Boolean)
    if (paths.length) await supabase.storage.from('project-photos').remove(paths)
    await supabase.from('tasks').delete().eq('id', task.id)
    onReload?.()
  }

  const uploadPhoto = async (task, e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploadingId(task.id)
    try {
      const safeName = (file.name || 'photo.jpg').replace(/[^a-zA-Z0-9._-]/g, '_')
      const path = profile.company_id + '/' + project.id + '/tasks/' + task.id + '/' + Date.now() + '-' + safeName
      const bytes = await file.arrayBuffer()
      const { error: upErr } = await supabase.storage.from('project-photos').upload(path, bytes, {
        contentType: file.type || 'image/jpeg',
      })
      if (upErr) throw upErr
      const { data: pub } = supabase.storage.from('project-photos').getPublicUrl(path)
      const { error: insErr } = await supabase.from('task_photos').insert({
        task_id: task.id,
        project_id: project.id,
        storage_path: path,
        public_url: pub.publicUrl,
        uploaded_by: profile.id,
      })
      if (insErr) throw insErr
      // One notification only (via logActivity for team/customer)
      await logActivity?.('uploaded task photo', task.title, project.id, phase.name)
      onReload?.()
    } catch (err) {
      alert(err.message || 'Upload failed')
    }
    setUploadingId(null)
  }

  return (
    <div className="bg-white border border-black rounded-md p-4 mb-4">
      <h3 className="text-[11px] font-mono uppercase text-[#6B6E72] mb-2">Tasks</h3>
      {tasks.length === 0 ? (
        <p className="text-xs text-[#8A8D91] mb-2">{isAdmin ? 'No tasks for this phase.' : 'No tasks.'}</p>
      ) : (
        <div className="space-y-3 mb-3">
          {tasks.map((task) => (
            <div key={task.id} className="border border-[#E5E5E5] rounded p-3">
              <div className="flex justify-between gap-2 items-start">
                <div className="min-w-0 flex-1">
                  {editingId === task.id ? (
                    <div className="space-y-2">
                      <input
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        className="w-full border border-black rounded px-2 py-1.5 text-sm"
                      />
                      <textarea
                        value={editDescription}
                        onChange={(e) => setEditDescription(e.target.value)}
                        rows={2}
                        className="w-full border border-black rounded px-2 py-1.5 text-sm"
                        placeholder="Description"
                      />
                      <div className="flex gap-2">
                        <button type="button" disabled={editSaving} className="text-xs text-white bg-black rounded px-3 py-1.5" onClick={() => saveEdit(task)}>
                          {editSaving ? 'Saving…' : 'Save'}
                        </button>
                        <button type="button" className="text-xs border border-black rounded px-3 py-1.5" onClick={() => setEditingId(null)}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="text-sm font-medium">{task.title}</div>
                      <span
                        className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded inline-block mt-1"
                        style={{
                          background: task.status === 'done' ? '#E1EDE4' : '#FFF8DB',
                          color: task.status === 'done' ? '#3F7D58' : '#8A6D00',
                        }}
                      >
                        {task.status}
                      </span>
                    </>
                  )}
                </div>
                {isAdmin && editingId !== task.id && (
                  <div className="flex gap-1 flex-shrink-0">
                    <button type="button" className="text-[#6B6E72] p-1 text-xs underline" onClick={() => startEdit(task)}>
                      Edit
                    </button>
                    <button type="button" className="text-[#B5533C] p-1" onClick={() => deleteTask(task)}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                )}
              </div>
              {editingId !== task.id && task.description && <p className="text-xs mt-2 whitespace-pre-wrap">{task.description}</p>}
              {(task.task_photos || []).length > 0 && (
                <div className="grid grid-cols-3 gap-2 mt-2">
                  {(task.task_photos || []).map((ph) => (
                    <a key={ph.id} href={ph.public_url} target="_blank" rel="noreferrer">
                      <img src={ph.public_url} alt="" className="w-full h-20 object-cover rounded border border-black" />
                    </a>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap gap-2 mt-3">
                {!isAdmin && (
                  <label className="text-xs border border-black rounded px-3 py-1.5 cursor-pointer">
                    {uploadingId === task.id ? 'Uploading…' : 'Attach photo'}
                    <input type="file" accept="image/*" capture="environment" className="hidden" disabled={uploadingId === task.id} onChange={(e) => uploadPhoto(task, e)} />
                  </label>
                )}
                {isAdmin && (
                  <label className="text-xs border border-black rounded px-3 py-1.5 cursor-pointer">
                    {uploadingId === task.id ? 'Uploading…' : 'Attach photo'}
                    <input type="file" accept="image/*" className="hidden" disabled={uploadingId === task.id} onChange={(e) => uploadPhoto(task, e)} />
                  </label>
                )}
                {isAdmin && task.status !== 'done' && (
                  <button type="button" className="text-xs text-white bg-black rounded px-3 py-1.5" onClick={() => markDone(task)}>
                    Mark done
                  </button>
                )}
                {isAdmin && task.status === 'done' && (
                  <button type="button" className="text-xs border border-black rounded px-3 py-1.5" onClick={() => reopen(task)}>
                    Reopen
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {isAdmin && (
        <form onSubmit={createTask} className="border border-dashed border-black rounded p-3 space-y-2">
          <div className="text-[11px] font-mono uppercase text-[#6B6E72]">New task for this phase</div>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What needs to be done?"
            className="w-full border border-black rounded px-3 py-2 text-sm"
            required
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Details (optional)"
            rows={2}
            className="w-full border border-black rounded px-3 py-2 text-sm"
          />
          <button type="submit" disabled={saving} className="w-full py-2 rounded text-sm text-white bg-black disabled:opacity-50">
            {saving ? 'Saving…' : 'Assign task'}
          </button>
        </form>
      )}
    </div>
  )
}

function ProjectActivity({ projectId }) {
  const [items, setItems] = useState([])
  useEffect(() => {
    if (!projectId) return
    supabase
      .from('activity')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(25)
      .then(({ data }) => setItems(data || []))
  }, [projectId])
  if (!items.length) return <p className="text-xs text-[#8A8D91]">No activity yet.</p>
  return (
    <div className="space-y-2 max-h-64 overflow-y-auto">
      {items.map((a) => (
        <div key={a.id} className="text-xs border-b border-[#E5E5E5] pb-2">
          <div className="font-medium">{a.action}{a.detail ? ` — ${a.detail}` : ''}</div>
          <div className="text-[10px] font-mono text-[#8A8D91]">{a.user_name || a.user_email} · {fmtDate(a.created_at)}</div>
        </div>
      ))}
    </div>
  )
}


function QuoteReplyForm({ changeOrder, profile, logActivity, onDone }) {
  const teamAmt = changeOrder.team_amount != null ? Number(changeOrder.team_amount) : null
  const [baseAmount, setBaseAmount] = useState(
    changeOrder.amount != null
      ? String(Number(changeOrder.amount) - (Number(changeOrder.admin_fee) || 0))
      : (teamAmt != null ? String(teamAmt) : '')
  )
  const [adminFee, setAdminFee] = useState(changeOrder.admin_fee != null ? String(changeOrder.admin_fee) : '0')
  const [reply, setReply] = useState(changeOrder.admin_reply || '')
  const [saving, setSaving] = useState(false)

  const baseN = parseFloat(baseAmount)
  const feeN = parseFloat(adminFee) || 0
  const totalN = (Number.isFinite(baseN) ? baseN : 0) + (Number.isFinite(feeN) ? feeN : 0)

  const submit = async (e) => {
    e.preventDefault()
    if (Number.isNaN(baseN) || baseN < 0) {
      alert('Enter a valid base amount.')
      return
    }
    if (feeN < 0) {
      alert('Contractor fee cannot be negative.')
      return
    }
    setSaving(true)
    const { error } = await supabase.from('change_orders').update({
      amount: totalN,
      admin_fee: feeN,
      admin_reply: reply.trim() || null,
      status: 'quoted',
      decided_at: null,
      decided_by: profile.id,
    }).eq('id', changeOrder.id)
    setSaving(false)
    if (error) {
      alert(error.message)
      return
    }
    await logActivity?.('quoted change order', changeOrder.title + ' — $' + totalN.toFixed(2))
    try {
      await supabase.rpc('notify_project_customers', {
        p_company_id: profile.company_id,
        p_project_id: changeOrder.project_id,
        p_title: titleCase('Change order quote'),
        p_body: changeOrder.title + ' — $' + totalN.toFixed(2),
        p_kind: 'change_order_quote',
      })
    } catch (_) {}
    onDone?.()
  }

  return (
    <form onSubmit={submit} className="mt-3 space-y-2 border-t border-[#E5E5E5] pt-3">
      {teamAmt != null && (
        <div className="text-xs text-[#6B6E72]">Trade requested ${teamAmt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
      )}
      <label className="block text-[11px] font-mono uppercase text-[#6B6E72]">Base amount for customer ($)</label>
      <input
        type="number"
        step="0.01"
        min="0"
        value={baseAmount}
        onChange={(e) => setBaseAmount(e.target.value)}
        required
        className="w-full border border-black rounded px-3 py-2 text-sm"
        placeholder="500.00"
      />
      <label className="block text-[11px] font-mono uppercase text-[#6B6E72]">Contractor fee ($)</label>
      <input
        type="number"
        step="0.01"
        min="0"
        value={adminFee}
        onChange={(e) => setAdminFee(e.target.value)}
        className="w-full border border-black rounded px-3 py-2 text-sm"
        placeholder="0.00"
      />
      <div className="text-sm font-medium">
        Customer total: ${totalN.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </div>
      <textarea
        value={reply}
        onChange={(e) => setReply(e.target.value)}
        rows={2}
        className="w-full border border-black rounded px-3 py-2 text-sm"
        placeholder="Note to customer (optional)"
      />
      <button type="submit" disabled={saving} className="w-full py-2 rounded text-sm text-white bg-black disabled:opacity-50">
        {saving ? 'Sending…' : 'Send quote to customer'}
      </button>
    </form>
  )
}

function ChangeOrderForm({ project, profile, isAdmin, isTeam = false, onDone, logActivity, defaultPhaseId }) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [phaseId, setPhaseId] = useState(defaultPhaseId || '')
  const [amount, setAmount] = useState('')
  const [file, setFile] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const phases = project.phases || []

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    if (!title.trim()) {
      setError('Enter a title for this change order.')
      return
    }
    let amountNum = null
    if (isAdmin || isTeam) {
      amountNum = parseFloat(String(amount).replace(/[^0-9.]/g, ''))
      if (isAdmin && (!Number.isFinite(amountNum) || amountNum < 0)) {
        setError('Enter the dollar amount for this offer to the customer.')
        return
      }
      if (isTeam && amount.trim() && (!Number.isFinite(amountNum) || amountNum < 0)) {
        setError('Enter a valid dollar amount.')
        return
      }
      if (isTeam && !amount.trim()) amountNum = null
    }
    setSaving(true)
    try {
      let storage_path = null
      let public_url = null
      if (file) {
        const safeName = (file.name || 'attachment').replace(/[^a-zA-Z0-9._-]/g, '_')
        const path = profile.company_id + '/' + project.id + '/change-orders/' + Date.now() + '-' + safeName
        const bytes = await file.arrayBuffer()
        const { error: upErr } = await supabase.storage.from('project-photos').upload(path, bytes, {
          contentType: file.type || 'application/octet-stream',
        })
        if (upErr) throw upErr
        const { data: pub } = supabase.storage.from('project-photos').getPublicUrl(path)
        storage_path = path
        public_url = pub.publicUrl
      }
      // Admin → offer (quoted). Team → pending team_request. Customer → pending request.
      const status = isAdmin ? 'quoted' : 'pending'
      const row = {
        project_id: project.id,
        phase_id: phaseId || null,
        title: title.trim(),
        description: description.trim() || null,
        storage_path,
        public_url,
        created_by: profile.id,
        status,
        origin: isAdmin ? 'admin_offer' : (isTeam ? 'team_request' : 'customer_request'),
      }
      if (isAdmin) {
        row.amount = amountNum
        row.admin_reply = description.trim() || null
      }
      if (isTeam && amountNum != null) {
        row.team_amount = amountNum
      }
      const { error: insErr } = await supabase.from('change_orders').insert(row)
      if (insErr) throw insErr
      await logActivity?.(
        isAdmin ? 'sent change order offer' : (isTeam ? 'trade change order request' : 'requested change order'),
        isAdmin
          ? (title.trim() + ' — $' + amountNum.toFixed(2))
          : (isTeam && amountNum != null ? title.trim() + ' — $' + amountNum.toFixed(2) : title.trim())
      )
      if (isAdmin) {
        try {
          await supabase.rpc('notify_project_customers', {
            p_company_id: profile.company_id,
            p_project_id: project.id,
            p_title: titleCase('Change order offer'),
            p_body: (project.address ? project.address + '\n' : '') + (phaseId ? 'Phase: ' + (phases.find((ph) => ph.id === phaseId)?.name || '') + '\n' : '') + title.trim() + ' — $' + amountNum.toFixed(2),
            p_kind: 'change_order_offer',
          })
        } catch (_) {}
      }
      setTitle('')
      setDescription('')
      setAmount('')
      setFile(null)
      if (!defaultPhaseId) setPhaseId('')
      onDone?.()
    } catch (err) {
      setError(err.message || 'Could not save change order.')
    }
    setSaving(false)
  }

  return (
    <form onSubmit={submit} className="border border-dashed border-black rounded p-3 space-y-2 mt-2">
      <div className="text-[11px] font-mono uppercase text-[#6B6E72]">
        {isAdmin ? 'Send offer to customer' : isTeam ? 'Request change order (to contractor)' : 'Request a change'}
      </div>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={isAdmin ? 'e.g. Foundation waterproofing' : 'Title'}
        className="w-full border border-black rounded px-3 py-2 text-sm"
      />
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder={isAdmin ? 'Why this work is recommended and what is included' : 'Description'}
        rows={3}
        className="w-full border border-black rounded px-3 py-2 text-sm"
      />
      {(isAdmin || isTeam) && (
        <div>
          <label className="block text-[11px] font-mono uppercase text-[#6B6E72] mb-1">
            {isAdmin ? 'Amount (required)' : 'Cost'}
          </label>
          <div className="flex items-center gap-2">
            <span className="text-sm">$</span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="flex-1 border border-black rounded px-3 py-2 text-sm"
            />
          </div>
        </div>
      )}
      {!defaultPhaseId && phases.length > 0 && (
        <select
          value={phaseId}
          onChange={(e) => setPhaseId(e.target.value)}
          className="w-full border border-black rounded px-3 py-2 text-sm bg-white"
        >
          <option value="">Whole project (no specific phase)</option>
          {phases.map((ph) => (
            <option key={ph.id} value={ph.id}>{ph.name}</option>
          ))}
        </select>
      )}
      <label className="block text-xs border border-black rounded px-3 py-2 cursor-pointer text-center">
        {file ? file.name : 'Optional attachment (photo or PDF)'}
        <input type="file" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
      </label>
      {error && <p className="text-xs text-[#B5533C]">{error}</p>}
      <button type="submit" disabled={saving} className="w-full py-2 rounded text-sm text-white bg-black disabled:opacity-50">
        {saving ? 'Saving…' : isAdmin ? 'Send offer to customer' : isTeam ? 'Send to contractor' : 'Submit request'}
      </button>
    </form>
  )
}


function parsePunchItems(raw) {
  if (!raw) return []
  try {
    const j = JSON.parse(raw)
    if (Array.isArray(j)) return j
  } catch (_) {}
  // legacy free-text → one open item per non-empty line
  return String(raw).split('\n').map((line) => line.trim()).filter(Boolean).map((text, i) => ({
    id: 'legacy-' + i,
    text,
    done: false,
  }))
}

function AdminPunchList({ phase, value, onChange, onSave }) {
  const [items, setItems] = useState(() => parsePunchItems(value))
  const [newItem, setNewItem] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState('')

  useEffect(() => {
    setItems(parsePunchItems(value))
  }, [phase.id, value])

  const persist = async (next) => {
    setItems(next)
    const json = JSON.stringify(next)
    onChange(json)
    setSaving(true)
    setSavedMsg('')
    // write directly so we don't depend on stale state in parent
    try {
      const { error } = await supabase.from('phases').update({ admin_notes: json }).eq('id', phase.id)
      if (error) {
        alert(error.message || 'Could not save. Ensure admin_notes column exists.')
      } else {
        setSavedMsg('Saved')
        setTimeout(() => setSavedMsg(''), 1500)
        await onSave?.()
      }
    } catch (err) {
      alert(err.message || 'Save failed')
    }
    setSaving(false)
  }

  const add = () => {
    const text = newItem.trim()
    if (!text) return
    persist([...items, { id: Date.now().toString(36), text, done: false }])
    setNewItem('')
  }

  return (
    <div>
      <label className="block text-[11px] font-mono uppercase text-[#6B6E72] mb-1">Contractor punch list (private)</label>
      <div className="space-y-2 mb-2">
        {items.length === 0 && <p className="text-xs text-[#8A8D91]">No punch items yet.</p>}
        {items.map((it) => (
          <div key={it.id} className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={!!it.done}
              onChange={() => persist(items.map((x) => x.id === it.id ? { ...x, done: !x.done } : x))}
              className="mt-1"
            />
            <span className={it.done ? 'line-through text-[#8A8D91] flex-1' : 'flex-1'}>{it.text}</span>
            <button
              type="button"
              className="text-[#B5533C] text-xs"
              onClick={() => persist(items.filter((x) => x.id !== it.id))}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
          placeholder="Add punch item"
          className="flex-1 border border-black rounded px-3 py-2 text-sm"
        />
        <button type="button" onClick={add} disabled={saving} className="px-3 rounded bg-black text-white text-sm disabled:opacity-50">
          Add
        </button>
      </div>
      {savedMsg && <p className="text-[10px] text-[#3F7D58] mt-1">{savedMsg}</p>}
    </div>
  )
}

function PhaseDetail({ phase, project, isAdmin, canUpload, isCustomer, profile, onBack, onReload, logActivity, onDeletePhase }) {
  const [caption, setCaption] = useState('')
  const [photoTag, setPhotoTag] = useState('')
  const [uploading, setUploading] = useState(false)
  const [trade, setTrade] = useState(phase.trade || '')
  const [phaseName, setPhaseName] = useState(phase.name || '')
  const [phaseStart, setPhaseStart] = useState(phase.start_date || '')
  const [phaseEnd, setPhaseEnd] = useState(phase.end_date || '')
  const [adminNotes, setAdminNotes] = useState(phase.admin_notes || '')
  const [lightboxIdx, setLightboxIdx] = useState(null)
  const [uploadingPhaseFile, setUploadingPhaseFile] = useState(false)
  const [showMarkup, setShowMarkup] = useState(false)
  const markupCanvasRef = useRef(null)
  const markupDrawing = useRef(false)
  const touchX = useRef(null)
  const photos = (phase.photos || []).slice().sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
  const phaseFiles = phase.phase_files || []
  const showPhaseFiles = isAdmin || (!isCustomer && canUpload)

  useEffect(() => {
    setTrade(phase.trade || '')
    setPhaseName(phase.name || '')
    setPhaseStart(phase.start_date || '')
    setPhaseEnd(phase.end_date || '')
    setAdminNotes(phase.admin_notes || '')
  }, [phase.id, phase.trade, phase.name, phase.start_date, phase.end_date, phase.admin_notes])

  const savePhaseDates = async () => {
    if (!isAdmin) return
    await supabase.from('phases').update({
      start_date: phaseStart || null,
      end_date: phaseEnd || null,
    }).eq('id', phase.id)
    onReload()
  }

  const isOverdue = phase.end_date && phase.status !== 'done' && new Date(phase.end_date + 'T23:59:59') < new Date()


  const savePhaseNameInside = async () => {
    if (!isAdmin) return
    const name = phaseName.trim()
    if (!name || name === phase.name) return
    const { error } = await supabase.from('phases').update({ name }).eq('id', phase.id)
    if (error) {
      alert(error.message)
      setPhaseName(phase.name || '')
      return
    }
    onReload()
  }

  const onTouchStart = (e) => {
    const t = e.touches[0]
    touchX.current = { x: t.clientX, y: t.clientY, edge: t.clientX <= 28 }
  }
  const onTouchEnd = (e) => {
    if (touchX.current == null) return
    const t = e.changedTouches[0]
    const dx = t.clientX - touchX.current.x
    const dy = t.clientY - touchX.current.y
    const fromEdge = touchX.current.edge
    touchX.current = null
    // Swipe photos in lightbox
    if (lightboxIdx != null) {
      if (Math.abs(dx) > Math.abs(dy) && dx < -50 && lightboxIdx < photos.length - 1) setLightboxIdx((i) => i + 1)
      else if (Math.abs(dx) > Math.abs(dy) && dx > 50 && lightboxIdx > 0) setLightboxIdx((i) => i - 1)
      return
    }
    // Back only from left edge + clear horizontal swipe
    if (fromEdge && dx > 100 && Math.abs(dx) > Math.abs(dy) * 2) onBack()
  }

  const lbTouchStart = (e) => { touchX.current = e.touches[0].clientX }
  const lbTouchEnd = (e) => {
    if (touchX.current == null || lightboxIdx == null) return
    const dx = e.changedTouches[0].clientX - touchX.current
    touchX.current = null
    if (dx < -50 && lightboxIdx < photos.length - 1) setLightboxIdx((i) => Math.min(photos.length - 1, i + 1))
    else if (dx > 50 && lightboxIdx > 0) setLightboxIdx((i) => Math.max(0, i - 1))
  }

  const uploadPhaseFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !showPhaseFiles) return
    setUploadingPhaseFile(true)
    try {
      const safeName = (file.name || 'plan.pdf').replace(/[^a-zA-Z0-9._-]/g, '_')
      const path = profile.company_id + '/' + project.id + '/phases/' + phase.id + '/files/' + Date.now() + '-' + safeName
      const bytes = await file.arrayBuffer()
      const { error: upErr } = await supabase.storage.from('project-photos').upload(path, bytes, {
        contentType: file.type || 'application/octet-stream',
      })
      if (upErr) throw upErr
      const { data: pub } = supabase.storage.from('project-photos').getPublicUrl(path)
      const { error: insErr } = await supabase.from('phase_files').insert({
        phase_id: phase.id,
        project_id: project.id,
        storage_path: path,
        public_url: pub.publicUrl,
        file_name: file.name,
        file_type: file.type,
        uploaded_by: profile.id,
      })
      if (insErr) throw insErr
      await logActivity?.('uploaded phase file', file.name, project.id, phase.name)
      onReload()
    } catch (err) {
      alert(err.message || 'Upload failed')
    }
    setUploadingPhaseFile(false)
  }

  const saveTrade = async () => {
    if (!isAdmin) return
    await supabase.from('phases').update({ trade }).eq('id', phase.id)
    onReload()
  }

  const saveNotes = async () => {
    if (!isAdmin) return
    try {
      const { error } = await supabase.from('phases').update({ admin_notes: adminNotes || null }).eq('id', phase.id)
      if (error) {
        alert(error.message || 'Could not save notes. Run SQL: alter table phases add column if not exists admin_notes text;')
        return false
      }
      onReload()
      return true
    } catch (err) {
      alert(err.message || 'Could not save notes')
      return false
    }
  }

  const uploadMedia = async (e) => {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (!files.length || !canUpload) return

    // Queue files so uploads continue if you leave the phase
    const queueItems = []
    for (const file of files) {
      if (!file.size) continue
      const isVideo = (file.type || '').startsWith('video/')
      const safeName = (file.name || (isVideo ? 'video.mp4' : 'photo.jpg')).replace(/[^a-zA-Z0-9._-]/g, '_')
      const path = profile.company_id + '/' + project.id + '/' + phase.id + '/' + Date.now() + '-' + Math.random().toString(36).slice(2, 6) + '-' + safeName
      try {
        const bytes = await file.arrayBuffer()
        // base64 for offline queue persistence
        let binary = ''
        const bytesArr = new Uint8Array(bytes)
        const chunk = 0x8000
        for (let i = 0; i < bytesArr.length; i += chunk) {
          binary += String.fromCharCode.apply(null, bytesArr.subarray(i, i + chunk))
        }
        const b64 = btoa(binary)
        queueItems.push({
          path,
          b64,
          contentType: file.type || (isVideo ? 'video/mp4' : 'image/jpeg'),
          phase_id: phase.id,
          project_id: project.id,
          caption: caption || null,
          tag: photoTag || null,
          media_type: isVideo ? 'video' : 'image',
        })
      } catch (err) {
        console.error(err)
      }
    }
    if (!queueItems.length) return

    // Merge into global upload queue
    try {
      const raw = localStorage.getItem(QUEUE_KEY)
      const existing = raw ? JSON.parse(raw) : []
      localStorage.setItem(QUEUE_KEY, JSON.stringify([...(Array.isArray(existing) ? existing : []), ...queueItems]))
    } catch (_) {}

    setUploading(true)
    setCaption('')
    // Process in background — user can leave phase
    ;(async () => {
      let ok = 0
      let left = []
      try {
        const raw = localStorage.getItem(QUEUE_KEY)
        const q = raw ? JSON.parse(raw) : []
        const mine = []
        const others = []
        for (const item of (Array.isArray(q) ? q : [])) {
          if (queueItems.some((qi) => qi.path === item.path)) mine.push(item)
          else others.push(item)
        }
        for (const item of mine) {
          try {
            const bin = Uint8Array.from(atob(item.b64), (c) => c.charCodeAt(0))
            const { error: upErr } = await supabase.storage.from('project-photos').upload(item.path, bin, {
              upsert: false,
              contentType: item.contentType,
              cacheControl: '3600',
            })
            if (upErr) { left.push(item); continue }
            const { data: pub } = supabase.storage.from('project-photos').getPublicUrl(item.path)
            const { error: insErr } = await supabase.from('photos').insert({
              phase_id: item.phase_id,
              project_id: item.project_id,
              storage_path: item.path,
              public_url: pub.publicUrl,
              caption: item.caption || null,
              tag: item.tag || null,
              media_type: item.media_type || 'image',
              uploaded_by: profile.id,
            })
            if (insErr) { left.push(item); continue }
            ok++
          } catch {
            left.push(item)
          }
        }
        localStorage.setItem(QUEUE_KEY, JSON.stringify([...others, ...left]))
        if (ok) {
          await logActivity('uploaded media', ok + ' file' + (ok > 1 ? 's' : ''), project.id, phase.name)
          onReload()
        }
        if (left.length) {
          // remaining will retry on online/flush
        }
      } catch (err) {
        console.error(err)
      }
      setUploading(false)
    })()
  }


  const openMarkup = () => {
    if (lightboxIdx == null) return
    setShowMarkup(true)
    setTimeout(() => {
      const canvas = markupCanvasRef.current
      const photo = photos[lightboxIdx]
      if (!canvas || !photo) return
      const ctx = canvas.getContext('2d')
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        const maxW = Math.min(window.innerWidth - 24, 900)
        const scale = Math.min(1, maxW / img.width)
        canvas.width = img.width * scale
        canvas.height = img.height * scale
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        ctx.strokeStyle = '#E6B800'
        ctx.lineWidth = 4
        ctx.lineCap = 'round'
      }
      img.src = photo.public_url
    }, 50)
  }

  const markupPointer = (e, type) => {
    const canvas = markupCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const rect = canvas.getBoundingClientRect()
    const point = e.touches ? e.touches[0] : e
    const x = (point.clientX - rect.left) * (canvas.width / rect.width)
    const y = (point.clientY - rect.top) * (canvas.height / rect.height)
    if (type === 'down') {
      markupDrawing.current = true
      ctx.beginPath()
      ctx.moveTo(x, y)
    } else if (type === 'move' && markupDrawing.current) {
      ctx.lineTo(x, y)
      ctx.stroke()
    } else if (type === 'up') {
      markupDrawing.current = false
    }
  }

  const saveMarkup = async () => {
    const canvas = markupCanvasRef.current
    const photo = photos[lightboxIdx]
    if (!canvas || !photo || !canUpload) return
    try {
      const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.92))
      if (!blob) throw new Error('Could not export image')
      const path = profile.company_id + '/' + project.id + '/' + phase.id + '/' + Date.now() + '-markup.jpg'
      const { error: upErr } = await supabase.storage.from('project-photos').upload(path, blob, { contentType: 'image/jpeg' })
      if (upErr) throw upErr
      const { data: pub } = supabase.storage.from('project-photos').getPublicUrl(path)
      await supabase.from('photos').insert({
        phase_id: phase.id,
        project_id: project.id,
        storage_path: path,
        public_url: pub.publicUrl,
        caption: (photo.caption ? photo.caption + ' ' : '') + '(markup)',
        tag: photo.tag || 'markup',
        media_type: 'image',
        uploaded_by: profile.id,
      })
      setShowMarkup(false)
      setLightboxIdx(null)
      await logActivity?.('uploaded media', 'markup', project.id, phase.name)
      onReload()
    } catch (err) {
      alert(err.message || 'Markup save failed')
    }
  }

  const deletePhoto = async (photo) => {
    if (!isAdmin) return
    if (!confirm('Delete this media?')) return
    try {
      if (photo.storage_path) {
        await supabase.storage.from('project-photos').remove([photo.storage_path])
      }
      const { error } = await supabase.from('photos').delete().eq('id', photo.id)
      if (error) throw error
      setLightboxIdx(null)
      onReload()
    } catch (err) {
      alert(err.message || 'Could not delete')
    }
  }

  const shareMedia = async (photo) => {
    if (!photo?.public_url) return
    try {
      const res = await fetch(photo.public_url)
      const blob = await res.blob()
      const isVideo = photo.media_type === 'video' || (blob.type || '').startsWith('video/')
      const ext = isVideo ? 'mp4' : 'jpg'
      const file = new File(
        [blob],
        (photo.caption || phase.name || 'photo').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 40) + '.' + ext,
        { type: blob.type || (isVideo ? 'video/mp4' : 'image/jpeg') }
      )
      const payload = {
        title: phase.name || 'Project photo',
        text: photo.caption || (project.address ? project.address + ' — ' + phase.name : phase.name),
        files: [file],
      }
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share(payload)
        return
      }
      if (navigator.share) {
        // Fallback: share URL only
        await navigator.share({
          title: payload.title,
          text: payload.text,
          url: photo.public_url,
        })
        return
      }
      // Desktop fallback: copy link
      await navigator.clipboard.writeText(photo.public_url)
      alert('Link copied. Paste it into Messages, WhatsApp, or email.')
    } catch (err) {
      if (err?.name === 'AbortError') return
      try {
        await navigator.clipboard.writeText(photo.public_url)
        alert('Could not open share sheet. Link copied instead.')
      } catch {
        alert(err.message || 'Sharing is not supported on this device.')
      }
    }
  }

  const deletePhase = async () => {
    if (!isAdmin) return
    if (!confirm('Delete phase "' + phase.name + '" and all its photos and files? This cannot be undone.')) return
    try {
      const paths = []
      ;(phase.photos || []).forEach((ph) => ph.storage_path && paths.push(ph.storage_path))
      ;(phase.phase_files || []).forEach((f) => f.storage_path && paths.push(f.storage_path))
      for (let i = 0; i < paths.length; i += 50) {
        await supabase.storage.from('project-photos').remove(paths.slice(i, i + 50))
      }
    } catch (_) {}
    const { error } = await supabase.from('phases').delete().eq('id', phase.id)
    if (error) {
      alert(error.message)
      return
    }
    await logActivity('deleted phase', phase.name, project.id, phase.name)
    onBack()
    onReload()
  }

  const lb = lightboxIdx != null ? photos[lightboxIdx] : null

  return (
    <SwipeBack onBack={onBack} disabled={lightboxIdx != null || showMarkup}>
            <button onClick={onBack} className="flex items-center gap-1 text-sm text-[#6B6E72] mb-4">
        <ChevronLeft size={16} /> All phases
      </button>

      <div className="bg-white border border-black rounded-md p-4 mb-4 overflow-hidden">
        <div className="flex justify-between items-start gap-3 mb-3">
          <div className="min-w-0 flex-1">
            {isAdmin ? (
              <div className="min-w-0">
                <label className="block text-[11px] font-mono uppercase text-[#6B6E72] mb-1">Phase name</label>
                <input
                  value={phaseName}
                  onChange={(e) => setPhaseName(e.target.value)}
                  onBlur={savePhaseNameInside}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.currentTarget.blur()
                    }
                  }}
                  className="w-full font-display text-xl border border-black rounded px-3 py-2"
                />
              </div>
            ) : (
              <h2 className="font-display text-xl">{phase.name}</h2>
            )}
          </div>
          <StatusBadge status={phase.status} map={PHASE_STATUS} />
        </div>
        {!isCustomer && (
          <div className="mb-3">
            <label className="block text-[11px] font-mono uppercase text-[#6B6E72] mb-1">Trade</label>
            {isAdmin ? (
              <input
                value={trade}
                onChange={(e) => setTrade(e.target.value)}
                onBlur={saveTrade}
                placeholder="e.g. Plumbing"
                className="w-full border border-black rounded px-3 py-2 text-sm"
              />
            ) : (
              <div className="text-sm py-1">{phase.trade || '—'}</div>
            )}
          </div>
        )}
        {isAdmin && (
          <div className="space-y-2 mb-3 w-full" style={{ maxWidth: '100%', overflow: 'hidden' }}>
            <div style={{ maxWidth: '100%', overflow: 'hidden' }}>
              <label className="block text-[11px] font-mono uppercase text-[#6B6E72] mb-1">Phase start</label>
              <input
                type="date"
                value={phaseStart || ''}
                onChange={(e) => setPhaseStart(e.target.value)}
                onBlur={savePhaseDates}
                className="border border-black rounded py-2 text-sm"
                style={{
                  display: 'block',
                  width: '100%',
                  maxWidth: '100%',
                  minWidth: 0,
                  boxSizing: 'border-box',
                  WebkitAppearance: 'none',
                  appearance: 'none',
                  paddingLeft: 8,
                  paddingRight: 8,
                }}
              />
            </div>
            <div style={{ maxWidth: '100%', overflow: 'hidden' }}>
              <label className="block text-[11px] font-mono uppercase text-[#6B6E72] mb-1">Phase end</label>
              <input
                type="date"
                value={phaseEnd || ''}
                onChange={(e) => setPhaseEnd(e.target.value)}
                onBlur={savePhaseDates}
                className="border border-black rounded py-2 text-sm"
                style={{
                  display: 'block',
                  width: '100%',
                  maxWidth: '100%',
                  minWidth: 0,
                  boxSizing: 'border-box',
                  WebkitAppearance: 'none',
                  appearance: 'none',
                  paddingLeft: 8,
                  paddingRight: 8,
                }}
              />
            </div>
          </div>
        )}
        {isOverdue && (
          <div className="text-xs text-[#B5533C] mb-3 font-medium">Overdue</div>
        )}
        {!isAdmin && (phase.start_date || phase.end_date) && (
          <div className="text-[11px] font-mono text-[#6B6E72] mb-3">
            {fmtDate(phase.start_date)} – {phase.end_date ? fmtDate(phase.end_date) : 'TBD'}
            {isOverdue ? ' · Overdue' : ''}
          </div>
        )}
        {isAdmin && (
          <AdminPunchList
            phase={phase}
            value={adminNotes}
            onChange={setAdminNotes}
            onSave={saveNotes}
          />
        )}
        {isAdmin && (
          <button type="button" onClick={deletePhase} className="mt-3 text-xs text-[#B5533C] flex items-center gap-1">
            <Trash2 size={13} /> Delete this phase
          </button>
        )}
      </div>

      {(isAdmin || isCustomer || (!isAdmin && !isCustomer)) && (
        <div className="bg-white border border-black rounded-md p-4 mb-4">
          <h3 className="text-[11px] font-mono uppercase text-[#6B6E72] mb-1">
            {isAdmin ? 'Change order for this phase' : (!isAdmin && !isCustomer) ? 'Request change order (to contractor)' : 'Request change for this phase'}
          </h3>
          <ChangeOrderForm
            project={project}
            profile={profile}
            isAdmin={isAdmin}
            isTeam={!isAdmin && !isCustomer}
            defaultPhaseId={phase.id}
            onDone={onReload}
            logActivity={logActivity}
          />
        </div>
      )}

      {(isAdmin || canUpload) && !isCustomer && (
        <PhaseTasks
          phase={phase}
          project={project}
          isAdmin={isAdmin}
          profile={profile}
          onReload={onReload}
          logActivity={logActivity}
        />
      )}

      {showPhaseFiles && (
        <div className="bg-white border border-black rounded-md p-4 mb-4">
          <h3 className="text-[11px] font-mono uppercase text-[#6B6E72] mb-1">Plans & files (this phase only)</h3>
          {phaseFiles.length > 0 && (
            <div className="space-y-2 mb-2">
              {phaseFiles.map((f) => (
                <div key={f.id} className="flex items-center justify-between gap-2 text-sm border-b border-[#E5E5E5] py-1.5">
                  <a href={f.public_url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 min-w-0 truncate underline">
                    <FileText size={14} /> <span className="truncate">{f.file_name || 'File'}</span>
                  </a>
                  {isAdmin && (
                    <button
                      type="button"
                      className="text-[#B5533C] flex-shrink-0"
                      onClick={async () => {
                        if (!confirm('Delete this file?')) return
                        if (f.storage_path) await supabase.storage.from('project-photos').remove([f.storage_path])
                        await supabase.from('phase_files').delete().eq('id', f.id)
                        onReload()
                      }}
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          <label className="w-full flex items-center justify-center gap-1.5 text-sm border border-black rounded px-3 py-2 cursor-pointer">
            {uploadingPhaseFile ? 'Uploading…' : 'Upload plan / file to this phase'}
            <input type="file" className="hidden" disabled={uploadingPhaseFile} onChange={uploadPhaseFile} />
          </label>
        </div>
      )}

      {canUpload && (
        <div className="bg-white border border-black rounded-md p-4 mb-4">
          <input
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Caption"
            className="w-full border border-black rounded px-3 py-2 text-sm mb-2"
          />
          <select value={photoTag} onChange={(e) => setPhotoTag(e.target.value)} className="w-full border border-black rounded px-3 py-2 text-sm mb-2 bg-white">
            <option value="">No tag</option>
            <option value="before">Before</option>
            <option value="after">After</option>
          </select>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex items-center justify-center gap-1.5 text-sm text-white font-medium bg-black rounded px-3 py-2.5 cursor-pointer min-h-[44px]">
              <Camera size={15} /> {uploading ? '…' : 'Take photo'}
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={uploadMedia}
                disabled={uploading}
              />
            </label>
            <label className="flex items-center justify-center gap-1.5 text-sm font-medium border border-black rounded px-3 py-2.5 cursor-pointer min-h-[44px]">
              {uploading ? 'Uploading…' : 'Library / video'}
              <input
                type="file"
                accept="image/*,video/*"
                multiple
                className="hidden"
                onChange={uploadMedia}
                disabled={uploading}
              />
            </label>
          </div>
        </div>
      )}

      {uploading && (
        <div className="text-xs text-[#8A6D00] bg-[#FFF8DB] border border-[#E6B800] rounded px-3 py-2 mb-3">
          Uploading in background — you can leave this phase
        </div>
      )}
      {photos.length === 0 ? (
        <div className="text-center py-10 text-[#6B6E72] text-sm">No media yet.</div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {photos.map((p, idx) => (
            <div key={p.id} className="bg-white border border-black rounded-md overflow-hidden relative">
              <button type="button" className="w-full block text-left" onClick={() => setLightboxIdx(idx)}>
                {p.media_type === 'video' ? (
                  <div className="w-full h-32 bg-black flex items-center justify-center text-white">
                    <Video size={28} />
                  </div>
                ) : (
                  <img src={p.public_url} alt="" className="w-full h-32 object-cover" />
                )}
              </button>
              <div className="p-2">
                <div className="flex justify-between items-center gap-1">
                  <span className="text-[10px] font-mono text-[#6B6E72]">{fmtDate(p.taken_at || p.created_at)}</span>
                  <div className="flex items-center gap-0.5">
                    <button type="button" onClick={() => shareMedia(p)} className="p-1.5 text-black" title="Share">
                      <Share2 size={14} />
                    </button>
                    {isAdmin && (
                      <button type="button" onClick={() => deletePhoto(p)} className="text-[#B5533C] p-1.5">
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                </div>
                {p.tag && <span className="text-[10px] font-mono uppercase text-[#6B6E72]">{p.tag}</span>}
                {p.caption && <p className="text-xs mt-0.5 break-words">{p.caption}</p>}
              </div>
            </div>
          ))}
        </div>
      )}

      {lb && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex flex-col"
          onTouchStart={(e) => { e.stopPropagation(); lbTouchStart(e) }}
          onTouchEnd={(e) => { e.stopPropagation(); lbTouchEnd(e) }}
          onTouchMove={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-4 py-3 text-white" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}>
            <span className="text-sm">{lightboxIdx + 1} / {photos.length}</span>
            <button type="button" onClick={() => setLightboxIdx(null)} className="p-2">
              <X size={22} />
            </button>
          </div>
          <div className="flex-1 flex items-center justify-center relative px-2 min-h-0">
            <button
              type="button"
              className="absolute left-2 z-10 bg-white/20 text-white rounded-full p-2 disabled:opacity-30"
              disabled={lightboxIdx <= 0}
              onClick={() => setLightboxIdx((i) => Math.max(0, i - 1))}
            >
              <ChevronLeft size={28} />
            </button>
            {lb.media_type === 'video' ? (
              <video src={lb.public_url} controls className="max-h-full max-w-full" playsInline />
            ) : (
              <img src={lb.public_url} alt="" className="max-h-full max-w-full object-contain" />
            )}
            <button
              type="button"
              className="absolute right-2 z-10 bg-white/20 text-white rounded-full p-2 disabled:opacity-30"
              disabled={lightboxIdx >= photos.length - 1}
              onClick={() => setLightboxIdx((i) => Math.min(photos.length - 1, i + 1))}
            >
              <ChevronRight size={28} />
            </button>
          </div>
          <div className="px-4 py-3 text-white text-center text-sm" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
            {lb.caption || ''}
            <div className="flex justify-center gap-4 mt-3">
              <button
                type="button"
                onClick={() => shareMedia(lb)}
                className="flex items-center gap-1.5 text-sm bg-white text-black px-4 py-2 rounded-full"
              >
                <Share2 size={16} /> Share
              </button>
              {canUpload && lb.media_type !== 'video' && (
                <button type="button" onClick={openMarkup} className="text-sm bg-white/20 text-white px-4 py-2 rounded-full">
                  Markup
                </button>
              )}
              {isAdmin && (
                <button type="button" onClick={() => deletePhoto(lb)} className="text-[#ff8a80] text-sm underline px-2">
                  Delete
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {showMarkup && (
        <div className="fixed inset-0 z-[60] bg-black/95 flex flex-col">
          <div className="flex justify-between items-center px-4 py-3 text-white" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}>
            <span className="text-sm">Draw on photo</span>
            <button type="button" onClick={() => setShowMarkup(false)} className="p-2"><X size={22} /></button>
          </div>
          <div className="flex-1 overflow-auto flex items-center justify-center p-2">
            <canvas
              ref={markupCanvasRef}
              className="max-w-full touch-none bg-black"
              onMouseDown={(e) => markupPointer(e, 'down')}
              onMouseMove={(e) => markupPointer(e, 'move')}
              onMouseUp={(e) => markupPointer(e, 'up')}
              onMouseLeave={(e) => markupPointer(e, 'up')}
              onTouchStart={(e) => { e.preventDefault(); markupPointer(e, 'down') }}
              onTouchMove={(e) => { e.preventDefault(); markupPointer(e, 'move') }}
              onTouchEnd={(e) => markupPointer(e, 'up')}
            />
          </div>
          <div className="p-4 flex gap-2" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
            <button type="button" onClick={() => setShowMarkup(false)} className="flex-1 py-2 rounded border border-white text-white text-sm">Cancel</button>
            <button type="button" onClick={saveMarkup} className="flex-1 py-2 rounded bg-white text-black text-sm">Save markup</button>
          </div>
        </div>
      )}
    </SwipeBack>
  )
}

