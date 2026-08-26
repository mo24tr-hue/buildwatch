import { useCallback, useEffect, useState, useRef } from 'react'
import { HardHat, Plus, Image as ImageIcon, MapPin, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Camera, Trash2, Check, FileText, X, Video, Menu, Share2, Bell, Search, Copy, Archive, Printer, CalendarDays, Users, FolderOpen, DollarSign, Activity, CircleDot } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { STYLES, PROJECT_STATUS, PHASE_STATUS, nextPhaseStatus, fmtDate, fmtDateTime, isFinishingPhase, FINISHING_PHASES, finishingLabel, roleLabel } from '../lib/styles'
import AdminPanel from '../components/AdminPanel'
import PlatformAdmin from '../components/PlatformAdmin'
import FeedbackPanel from '../components/FeedbackPanel'
import { isPlatformAdmin } from '../lib/platform'

const QUEUE_KEY = 'ay_upload_queue'

/** Compress images before upload so galleries stay fast (max edge 1600px, JPEG ~0.72). */
async function compressImageFile(file, maxEdge = 1600, quality = 0.72) {
  if (!file || !(file.type || '').startsWith('image/')) return file
  if ((file.type || '').includes('svg')) return file
  try {
    const bitmap = await createImageBitmap(file)
    const w = bitmap.width
    const h = bitmap.height
    const scale = Math.min(1, maxEdge / Math.max(w, h))
    const tw = Math.max(1, Math.round(w * scale))
    const th = Math.max(1, Math.round(h * scale))
    // Skip if already small
    if (scale >= 0.98 && file.size < 450000) {
      bitmap.close?.()
      return file
    }
    const canvas = document.createElement('canvas')
    canvas.width = tw
    canvas.height = th
    const ctx = canvas.getContext('2d')
    ctx.drawImage(bitmap, 0, 0, tw, th)
    bitmap.close?.()
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
    if (!blob || blob.size >= file.size * 0.95) return file
    const name = (file.name || 'photo.jpg').replace(/\.[^.]+$/, '') + '.jpg'
    return new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() })
  } catch {
    return file
  }
}

/** Prefer smaller display URL when Supabase image transforms are available; otherwise original. */
function photoDisplayUrl(url, width = 900) {
  if (!url || typeof url !== 'string') return url
  if (url.startsWith('/acme/') || url.startsWith('data:')) return url
  // Supabase Storage image transformation (works when enabled on the project)
  if (url.includes('/storage/v1/object/public/')) {
    const base = url.replace('/object/public/', '/render/image/public/')
    const sep = base.includes('?') ? '&' : '?'
    return `${base}${sep}width=${width}&quality=70&resize=contain`
  }
  return url
}

function SwipeBack({ onBack, children, className = '', disabled = false }) {
  const start = useRef(null)
  // Wider edge + clearer horizontal swipe so back works without fighting scroll
  const EDGE = 48
  const MIN_DX = 72
  const onTouchStart = (e) => {
    if (disabled) return
    const t = e.touches[0]
    if (t.clientX > EDGE) {
      start.current = null
      return
    }
    start.current = { x: t.clientX, y: t.clientY, t: Date.now() }
  }
  const onTouchMove = (e) => {
    if (!start.current) return
    const t = e.touches[0]
    const dx = t.clientX - start.current.x
    const dy = t.clientY - start.current.y
    // Cancel if clearly scrolling vertically
    if (Math.abs(dy) > 18 && Math.abs(dy) > Math.abs(dx) * 1.1) {
      start.current = null
    }
  }
  const onTouchEnd = (e) => {
    if (disabled || !start.current) return
    const t = e.changedTouches[0]
    const dx = t.clientX - start.current.x
    const dy = t.clientY - start.current.y
    const dt = Date.now() - (start.current.t || Date.now())
    start.current = null
    // Rightward swipe from left edge; allow quicker flicks with slightly less distance
    const quick = dt < 280 && dx > 48
    const long = dx >= MIN_DX
    if ((quick || long) && dx > Math.abs(dy) * 1.4) onBack?.()
  }
  return (
    <div
      className={className}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={() => { start.current = null }}
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

export default function Dashboard({ session, profile, company, onCompanyUpdate, onLogout, platformOwner = false, onLeavePlatformWorkspace }) {
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [digest, setDigest] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [showNew, setShowNew] = useState(false)
  const [showAdmin, setShowAdmin] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showCalendar, setShowCalendar] = useState(false)
  const [showPlatform, setShowPlatform] = useState(false)
  const [showFeedback, setShowFeedback] = useState(false)
  const [showWeek, setShowWeek] = useState(false)
  const [homeTab, setHomeTab] = useState('projects')
  const [menuOpen, setMenuOpen] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [headerCompany, setHeaderCompany] = useState(company)
  const [searchQ, setSearchQ] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [showArchived, setShowArchived] = useState(false)
  const [notifications, setNotifications] = useState([])
  const [showNotifs, setShowNotifs] = useState(false)

  const isAdmin = profile?.role === 'admin'
  const isCustomer = profile?.role === 'customer'
  const platformAdmin = isPlatformAdmin(profile)
  const canUpload = profile?.role === 'admin' || profile?.role === 'team'

  const goTab = (tab) => {
    setHomeTab(tab)
    setShowCalendar(tab === 'calendar')
    setShowWeek(tab === 'week')
    setShowAdmin(tab === 'users')
    setShowPassword(false)
    setShowPlatform(false)
    setShowFeedback(false)
    setShowHelp(false)
    setShowNotifs(false)
    setShowNew(false)
    setActiveId(null)
    setMenuOpen(false)
  }

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
      let q = supabase.from('projects').select(fullSelect).order('created_at', { ascending: false })
      // Always scope to this company so platform admins never see other companies' jobs
      if (profile?.company_id) q = q.eq('company_id', profile.company_id)
      const res = await q
      data = res.data
      error = res.error
      if (error) {
        console.warn('full select failed, retry basic', error.message)
        let q2 = supabase.from('projects').select(basicSelect).order('created_at', { ascending: false })
        if (profile?.company_id) q2 = q2.eq('company_id', profile.company_id)
        const res2 = await q2
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
      // Always merge photos from a direct query (nested embed often returns [] under RLS)
      try {
        const phaseIds = list.flatMap((p) => (p.phases || []).map((ph) => ph.id)).filter(Boolean)
        const projectIds = list.map((p) => p.id).filter(Boolean)
        if (phaseIds.length || projectIds.length) {
          let photoRows = []
          // batch phase_id IN queries (Supabase has URL limits)
          for (let i = 0; i < phaseIds.length; i += 80) {
            const chunk = phaseIds.slice(i, i + 80)
            const { data, error: phErr } = await supabase.from('photos').select('*').in('phase_id', chunk)
            if (phErr) console.warn('photos by phase', phErr.message)
            if (data?.length) photoRows = photoRows.concat(data)
          }
          // also by project_id in case phase_id is null on older rows
          for (let i = 0; i < projectIds.length; i += 40) {
            const chunk = projectIds.slice(i, i + 40)
            const { data, error: pjErr } = await supabase.from('photos').select('*').in('project_id', chunk)
            if (pjErr) console.warn('photos by project', pjErr.message)
            if (data?.length) {
              const seen = new Set(photoRows.map((r) => r.id))
              data.forEach((r) => { if (!seen.has(r.id)) photoRows.push(r) })
            }
          }
          if (photoRows.length) {
            const byPhase = {}
            const byProject = {}
            photoRows.forEach((ph) => {
              if (ph.phase_id) {
                if (!byPhase[ph.phase_id]) byPhase[ph.phase_id] = []
                byPhase[ph.phase_id].push(ph)
              }
              if (ph.project_id) {
                if (!byProject[ph.project_id]) byProject[ph.project_id] = []
                byProject[ph.project_id].push(ph)
              }
            })
            list = list.map((p) => ({
              ...p,
              phases: (p.phases || []).map((ph) => {
                const fromPhase = byPhase[ph.id] || []
                const nested = Array.isArray(ph.photos) ? ph.photos : []
                // prefer direct query results; merge unique by id
                const map = new Map()
                ;[...nested, ...fromPhase].forEach((x) => { if (x?.id) map.set(x.id, x) })
                return { ...ph, photos: Array.from(map.values()) }
              }),
            }))
          }
        }
      } catch (e) {
        console.warn('photo load', e)
      }
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
  }, [profile?.id, profile?.role, profile?.company_id])

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
    const a = (action || '').toLowerCase()

    // Notify company admins for non-admin actions (photos, CO requests, etc.)
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
        'accepted change order',
      ]
      if (shareWithAdmins.some((k) => a.includes(k))) {
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

    // Customer-visible events: payments, approved/declined change orders
    const customerKinds = [
      'recorded payment',
      'accepted change order',
      'approved change order',
      'declined change order',
      'rejected change order',
      'sent change order offer',
      'quoted change order',
    ]
    if (pid && profile?.company_id && customerKinds.some((k) => a.includes(k))) {
      try {
        await supabase.rpc('notify_project_customers', {
          p_company_id: profile.company_id,
          p_project_id: pid,
          p_title: notifTitle,
          p_body: notifBody,
          p_kind: action,
        })
      } catch (_) {}
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

    const baseCost =
      form.baseCost != null && form.baseCost !== ''
        ? Number(form.baseCost)
        : null
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
        base_cost: baseCost != null && !Number.isNaN(baseCost) ? baseCost : null,
        amount_paid: 0,
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
                  {platformAdmin && (
                    <button
                      type="button"
                      className="w-full text-left px-3 py-2.5 text-sm hover:bg-[#F5F5F5]"
                      onClick={() => {
                        setMenuOpen(false)
                        setShowPlatform(true)
                        setShowFeedback(false)
                        setShowAdmin(false)
                        setShowPassword(false)
                        setShowCalendar(false)
                        setShowWeek(false)
                        setActiveId(null)
                        setShowNew(false)
                      }}
                    >
                      Platform
                    </button>
                  )}
                  <button
                    type="button"
                    className="w-full text-left px-3 py-2.5 text-sm hover:bg-[#F5F5F5]"
                    onClick={() => {
                      setMenuOpen(false)
                      setShowFeedback(true)
                      setShowPlatform(false)
                      setShowAdmin(false)
                      setShowPassword(false)
                      setShowCalendar(false)
                      setShowWeek(false)
                      setActiveId(null)
                      setShowNew(false)
                    }}
                  >
                    Send feedback
                  </button>
                  <button
                    type="button"
                    className="w-full text-left px-3 py-2.5 text-sm hover:bg-[#F5F5F5]"
                    onClick={() => {
                      setMenuOpen(false)
                      setShowPassword(true)
                      setShowAdmin(false)
                      setShowCalendar(false)
                      setShowWeek(false)
                      setShowPlatform(false)
                      setShowFeedback(false)
                      setShowHelp(false)
                      setActiveId(null)
                      setShowNew(false)
                    }}
                  >
                    Change password
                  </button>
                  {isAdmin && (
                    <button
                      type="button"
                      className="w-full text-left px-3 py-2.5 text-sm hover:bg-[#F5F5F5]"
                      onClick={() => {
                        setMenuOpen(false)
                        setShowHelp(true)
                        setShowPassword(false)
                        setShowAdmin(false)
                        setShowCalendar(false)
                        setShowWeek(false)
                        setShowPlatform(false)
                        setShowFeedback(false)
                        setActiveId(null)
                        setShowNew(false)
                      }}
                    >
                      How to invite
                    </button>
                  )}
                  {platformOwner && onLeavePlatformWorkspace && (
                    <button
                      type="button"
                      className="w-full text-left px-3 py-2.5 text-sm hover:bg-[#F5F5F5] border-t border-[#E5E5E5]"
                      onClick={() => {
                        setMenuOpen(false)
                        onLeavePlatformWorkspace()
                      }}
                    >
                      Platform panel
                    </button>
                  )}
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
      <main className="max-w-2xl mx-auto px-4 py-5 pb-28">
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
        ) : showPlatform && platformAdmin ? (
          <PlatformAdmin
            profile={profile}
            onBack={() => setShowPlatform(false)}
          />
        ) : showFeedback ? (
          <FeedbackPanel
            profile={profile}
            company={headerCompany || company}
            onBack={() => setShowFeedback(false)}
          />
        ) : showPassword ? (
          <ChangePasswordPanel
            email={profile?.email}
            onBack={() => setShowPassword(false)}
          />
        ) : showHelp ? (
          <InviteHelpGuide
            company={headerCompany || company}
            onBack={() => setShowHelp(false)}
          />
        ) : showCalendar ? (
          <AdminCalendarView
            projects={projects}
            role={profile?.role}
            onBack={() => goTab('projects')}
            hideBack
            onOpenProject={(id) => {
              setShowCalendar(false)
              setShowWeek(false)
              setShowAdmin(false)
              setHomeTab('projects')
              setActiveId(id)
            }}
          />
        ) : showWeek && isAdmin ? (
          <ThisWeekView
            digest={digest}
            projects={projects}
            onBack={() => goTab('projects')}
            hideBack
            onOpenProject={(id) => {
              setShowWeek(false)
              setShowCalendar(false)
              setShowAdmin(false)
              setHomeTab('projects')
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
              goTab('projects')
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
                          <img src={photoDisplayUrl(thumb, 320)} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
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

      {!showNotifs && !showPlatform && !showFeedback && !showPassword && !showHelp && (
        <nav
          className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-black"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          <div className="max-w-2xl mx-auto flex">
            <button
              type="button"
              onClick={() => goTab('projects')}
              className={`flex-1 py-2.5 flex flex-col items-center gap-0.5 text-[10px] font-mono uppercase ${homeTab === 'projects' && !showCalendar && !showWeek && !showAdmin ? 'text-black' : 'text-[#8A8D91]'}`}
            >
              <HardHat size={18} />
              Projects
            </button>
            <button
              type="button"
              onClick={() => goTab('calendar')}
              className={`flex-1 py-2.5 flex flex-col items-center gap-0.5 text-[10px] font-mono uppercase ${homeTab === 'calendar' ? 'text-black' : 'text-[#8A8D91]'}`}
            >
              <CalendarDays size={18} />
              Calendar
            </button>
            {isAdmin && (
              <button
                type="button"
                onClick={() => goTab('week')}
                className={`flex-1 py-2.5 flex flex-col items-center gap-0.5 text-[10px] font-mono uppercase ${homeTab === 'week' ? 'text-black' : 'text-[#8A8D91]'}`}
              >
                <Activity size={18} />
                This week
              </button>
            )}
            {isAdmin && (
              <button
                type="button"
                onClick={() => goTab('users')}
                className={`flex-1 py-2.5 flex flex-col items-center gap-0.5 text-[10px] font-mono uppercase ${homeTab === 'users' ? 'text-black' : 'text-[#8A8D91]'}`}
              >
                <Users size={18} />
                Users
              </button>
            )}
          </div>
        </nav>
      )}
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


function AdminCalendarView({ projects, role, onBack, onOpenProject, hideBack }) {
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth()) // 0-11
  const [selected, setSelected] = useState(today.toISOString().slice(0, 10))
  const isTrade = role === 'team'
  const isCustomer = role === 'customer'
  // projects list is already scoped: customers → assigned jobs; trade → assigned phases only

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
  const mark = (dateStr, info) => {
    if (!dateStr) return
    if (!marks[dateStr]) marks[dateStr] = []
    marks[dateStr].push(info)
  }
  ;(projects || []).forEach((pr) => {
    // Customer + contractor: project-level schedule
    if (!isTrade) {
      mark(pr.start_date, { projectId: pr.id, label: pr.address, detail: 'Project start', status: pr.status })
      mark(pr.end_date, { projectId: pr.id, label: pr.address, detail: 'Project end', status: pr.status })
    }
    ;(pr.phases || []).forEach((ph) => {
      // Trade: only their phase start/end (list already filtered to assigned phases)
      // Customer/contractor: all phases on visible projects
      mark(ph.start_date, {
        projectId: pr.id,
        label: isTrade ? (ph.name || 'Phase') : (pr.address + ' · ' + ph.name),
        detail: isTrade ? 'Your start' : 'Phase start',
        status: ph.status,
      })
      mark(ph.end_date, {
        projectId: pr.id,
        label: isTrade ? (ph.name || 'Phase') : (pr.address + ' · ' + ph.name),
        detail: isTrade ? 'Your end' : 'Phase end',
        status: ph.status,
      })
    })
  })

  const dayItems = []
  const day = selected
  ;(projects || []).forEach((pr) => {
    if (!isTrade && (pr.start_date === day || pr.end_date === day)) {
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
          label: isTrade ? (ph.name || 'Phase') : (pr.address + ' · ' + ph.name),
          detail: isTrade
            ? (ph.start_date === day && ph.end_date === day ? 'Your start & end' : ph.start_date === day ? 'Your start' : 'Your end')
            : (ph.start_date === day && ph.end_date === day ? 'Start & end' : ph.start_date === day ? 'Phase start' : 'Phase target end'),
          status: ph.status,
        })
      }
      if (!isTrade && ph.start_date && ph.end_date && ph.start_date < day && ph.end_date > day && ph.status === 'active') {
        dayItems.push({
          projectId: pr.id,
          label: pr.address + ' · ' + ph.name,
          detail: 'In progress',
          status: ph.status,
        })
      }
      if (isTrade && ph.start_date && ph.end_date && ph.start_date < day && ph.end_date > day && ph.status === 'active') {
        dayItems.push({
          projectId: pr.id,
          label: ph.name || 'Phase',
          detail: 'In progress (your phase)',
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
    <SwipeBack onBack={hideBack ? undefined : onBack} disabled={hideBack}>
      {!hideBack && (
        <button type="button" onClick={onBack} className="flex items-center gap-1 text-sm text-[#6B6E72] mb-4">
          <ChevronLeft size={16} /> Back
        </button>
      )}
      <h2 className="font-display text-2xl mb-1">Calendar</h2>
      <p className="text-xs text-[#6B6E72] mb-4">
        {isTrade ? 'Your phase start and end dates' : isCustomer ? 'Schedule for your projects' : 'All project and phase dates'}
      </p>
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

function ThisWeekView({ digest, projects, onBack, onOpenProject, hideBack }) {
  return (
    <SwipeBack onBack={hideBack ? undefined : onBack} disabled={hideBack}>
      {!hideBack && (
        <button type="button" onClick={onBack} className="flex items-center gap-1 text-sm text-[#6B6E72] mb-4">
          <ChevronLeft size={16} /> Back
        </button>
      )}
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
  const [baseCost, setBaseCost] = useState('')

  const uploadCover = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !companyId) return
    setUploadingCover(true)
    try {
      const compressed = await compressImageFile(file, 1600, 0.75)
      const safeName = (compressed.name || file.name || 'cover.jpg').replace(/[^a-zA-Z0-9._-]/g, '_')
      const path = companyId + '/covers/' + Date.now() + '-' + safeName
      const bytes = await compressed.arrayBuffer()
      const { error: upErr } = await supabase.storage.from('project-photos').upload(path, bytes, {
        upsert: false,
        contentType: compressed.type || 'image/jpeg',
        cacheControl: '31536000',
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
        baseCost,
      })
      return
    }
    onCreate({ address: address.trim(), style, startDate, endDate, coverPhotoUrl: coverUrl, baseCost })
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
        <div>
          <label className="block text-[11px] font-mono uppercase text-[#6B6E72] mb-1">Cost of construction (optional)</label>
          <div className="flex items-center gap-2">
            <span className="text-sm text-[#6B6E72]">$</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={baseCost}
              onChange={(e) => setBaseCost(e.target.value)}
              className="w-full border border-black rounded px-3 py-2 text-sm"
              placeholder="0.00"
            />
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


function money(n) {
  if (n == null || Number.isNaN(Number(n))) return '—'
  return '$' + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** Contractor + customer only. Total = base_cost + approved change orders. Receipts from payment history. */
function ProjectCostSection({ project, isAdmin, profile, onReload, logActivity }) {
  const [editing, setEditing] = useState(false)
  const [recordingPay, setRecordingPay] = useState(false)
  const [baseInput, setBaseInput] = useState(
    project.base_cost != null ? String(project.base_cost) : ''
  )
  const [payAmount, setPayAmount] = useState('')
  const [payNote, setPayNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [payments, setPayments] = useState([])
  const [receipt, setReceipt] = useState(null)
  const [companyInfo, setCompanyInfo] = useState(null)

  useEffect(() => {
    setBaseInput(project.base_cost != null ? String(project.base_cost) : '')
  }, [project.id, project.base_cost])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data } = await supabase
        .from('project_payments')
        .select('*')
        .eq('project_id', project.id)
        .order('created_at', { ascending: false })
      if (!cancelled) setPayments(data || [])
      if (profile?.company_id) {
        const { data: co } = await supabase
          .from('companies')
          .select('name, logo_url')
          .eq('id', profile.company_id)
          .maybeSingle()
        if (!cancelled) setCompanyInfo(co)
      }
    })()
    return () => { cancelled = true }
  }, [project.id, project.amount_paid, profile?.company_id])

  const approvedCos = (project.change_orders || []).filter(
    (c) => (c.status || '') === 'approved' && c.amount != null
  )
  const changeOrderTotal = approvedCos.reduce((s, c) => s + (Number(c.amount) || 0), 0)
  const base = project.base_cost != null ? Number(project.base_cost) : null
  const total =
    base != null || changeOrderTotal
      ? (base || 0) + changeOrderTotal
      : null
  const paid = Number(project.amount_paid) || 0
  const remaining = total != null ? total - paid : null

  const saveBase = async () => {
    setSaving(true)
    const baseVal = baseInput === '' ? null : Number(baseInput)
    if (baseVal != null && (Number.isNaN(baseVal) || baseVal < 0)) {
      alert('Enter a valid construction cost.')
      setSaving(false)
      return
    }
    const { error } = await supabase
      .from('projects')
      .update({ base_cost: baseVal })
      .eq('id', project.id)
    setSaving(false)
    if (error) {
      alert(error.message)
      return
    }
    await logActivity?.('updated project cost', project.address)
    setEditing(false)
    onReload()
  }

  const recordPayment = async () => {
    const amt = Number(payAmount)
    if (!amt || Number.isNaN(amt) || amt <= 0) {
      alert('Enter a payment amount greater than zero.')
      return
    }
    setSaving(true)
    const newPaid = paid + amt
    const remAfter = total != null ? total - newPaid : null
    const { data: payRow, error: payErr } = await supabase
      .from('project_payments')
      .insert({
        project_id: project.id,
        company_id: profile.company_id,
        amount: amt,
        note: payNote.trim() || null,
        total_at_payment: total,
        paid_after: newPaid,
        remaining_after: remAfter,
        recorded_by: profile.id,
      })
      .select()
      .single()
    if (payErr) {
      setSaving(false)
      alert(payErr.message)
      return
    }
    const { error } = await supabase
      .from('projects')
      .update({ amount_paid: newPaid })
      .eq('id', project.id)
    setSaving(false)
    if (error) {
      alert(error.message)
      return
    }
    await logActivity?.('recorded payment ' + money(amt), project.address)
    setPayAmount('')
    setPayNote('')
    setRecordingPay(false)
    setPayments((prev) => [payRow, ...prev])
    setReceipt(payRow)
    onReload()
  }

  const openReceipt = (p) => setReceipt(p)

  const receiptPlainText = (r) => {
    const lines = [
      (companyInfo?.name || 'BuildWatch') + ' — Payment receipt',
      'Project: ' + (project.address || ''),
      'Date: ' + (fmtDateTime(r.created_at) || fmtDate(r.created_at) || ''),
      r.note ? 'Note: ' + r.note : null,
      'Payment received: ' + money(r.amount),
      r.total_at_payment != null ? 'Project total: ' + money(r.total_at_payment) : null,
      r.paid_after != null ? 'Total paid to date: ' + money(r.paid_after) : null,
      r.remaining_after != null ? 'Balance remaining: ' + money(r.remaining_after) : null,
      'Receipt ID: ' + String(r.id).slice(0, 8),
    ]
    return lines.filter(Boolean).join('\n')
  }

  const printReceipt = (r) => {
    const companyName = companyInfo?.name || 'BuildWatch'
    const logo = companyInfo?.logo_url
      ? `<img src="${companyInfo.logo_url}" alt="" style="height:48px;margin:0 auto 8px;display:block;object-fit:contain;" />`
      : ''
    const noteRow = r.note
      ? `<div style="display:flex;justify-content:space-between;gap:12px;margin:6px 0;"><span style="color:#6B6E72;">Note</span><span style="text-align:right;">${String(r.note).replace(/</g, '&lt;')}</span></div>`
      : ''
    const totalRow = r.total_at_payment != null
      ? `<div style="display:flex;justify-content:space-between;gap:12px;margin:6px 0;"><span style="color:#6B6E72;">Project total</span><span>${money(r.total_at_payment)}</span></div>`
      : ''
    const paidRow = r.paid_after != null
      ? `<div style="display:flex;justify-content:space-between;gap:12px;margin:6px 0;"><span style="color:#6B6E72;">Total paid to date</span><span>${money(r.paid_after)}</span></div>`
      : ''
    const remRow = r.remaining_after != null
      ? `<div style="display:flex;justify-content:space-between;gap:12px;margin:10px 0 0;padding-top:10px;border-top:1px solid #ddd;"><span style="font-weight:600;">Balance remaining</span><span style="font-weight:600;">${money(r.remaining_after)}</span></div>`
      : ''
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Payment receipt</title>
      <style>
        body{font-family:system-ui,-apple-system,sans-serif;color:#000;margin:24px;background:#fff;}
        .box{border:1px solid #000;border-radius:8px;padding:24px;max-width:420px;margin:0 auto;}
        .title{font-size:20px;font-weight:600;text-align:center;}
        .sub{font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#6B6E72;text-align:center;margin-top:4px;}
        .row{display:flex;justify-content:space-between;gap:12px;margin:6px 0;font-size:14px;}
        .muted{color:#6B6E72;}
        .amt{font-size:18px;font-weight:700;}
        .foot{font-size:10px;color:#6B6E72;text-align:center;margin-top:28px;}
        @media print{body{margin:0;}}
      </style></head><body>
      <div class="box">
        ${logo}
        <div class="title">${String(companyName).replace(/</g, '&lt;')}</div>
        <div class="sub">Payment receipt</div>
        <div style="margin-top:24px;">
          <div class="row"><span class="muted">Project</span><span style="font-weight:500;text-align:right;">${String(project.address || '').replace(/</g, '&lt;')}</span></div>
          <div class="row"><span class="muted">Date</span><span>${fmtDateTime(r.created_at) || fmtDate(r.created_at) || ''}</span></div>
          ${noteRow}
        </div>
        <div style="border-top:1px solid #ccc;margin-top:16px;padding-top:16px;">
          <div class="row"><span class="muted">Payment received</span><span class="amt">${money(r.amount)}</span></div>
          ${totalRow}${paidRow}${remRow}
        </div>
        <p class="foot">Generated by BuildWatch · Receipt ID ${String(r.id).slice(0, 8)}</p>
      </div>
      <script>
        window.onload = function(){
          setTimeout(function(){ window.focus(); window.print(); }, 250);
        };
      <\/script>
      </body></html>`
    const w = window.open('', '_blank', 'noopener,noreferrer,width=480,height=720')
    if (!w) {
      // Popup blocked — fall back to on-page print
      window.print()
      return
    }
    w.document.open()
    w.document.write(html)
    w.document.close()
  }

  const buildReceiptImage = async (r) => {
    const W = 720
    const PAD = 56
    const companyName = companyInfo?.name || 'BuildWatch'
    const dateStr = fmtDateTime(r.created_at) || fmtDate(r.created_at) || ''
    const rows = [
      { label: 'Project', value: project.address || '', muted: true },
      { label: 'Date', value: dateStr, muted: true },
    ]
    if (r.note) rows.push({ label: 'Note', value: r.note, muted: true })
    const moneyRows = [
      { label: 'Payment received', value: money(r.amount), big: true },
      r.total_at_payment != null ? { label: 'Project total', value: money(r.total_at_payment) } : null,
      r.paid_after != null ? { label: 'Total paid to date', value: money(r.paid_after) } : null,
      r.remaining_after != null ? { label: 'Balance remaining', value: money(r.remaining_after), bold: true } : null,
    ].filter(Boolean)

    // Load logo if present
    let logoImg = null
    if (companyInfo?.logo_url) {
      try {
        logoImg = await new Promise((resolve, reject) => {
          const img = new Image()
          img.crossOrigin = 'anonymous'
          img.onload = () => resolve(img)
          img.onerror = () => resolve(null)
          img.src = companyInfo.logo_url
        })
      } catch {
        logoImg = null
      }
    }

    // Measure height
    let y = PAD
    y += logoImg ? 72 : 0
    y += 36 // company name
    y += 28 // PAYMENT RECEIPT
    y += 36
    y += rows.length * 40
    y += 28 // line
    y += moneyRows.length * 44
    y += 56 // footer
    y += PAD
    const H = Math.max(y, 900)

    const canvas = document.createElement('canvas')
    canvas.width = W
    canvas.height = H
    const ctx = canvas.getContext('2d')

    // Background gradient-ish white
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, W, H)
    const grd = ctx.createLinearGradient(0, 0, 0, 120)
    grd.addColorStop(0, '#f7f7f7')
    grd.addColorStop(1, '#ffffff')
    ctx.fillStyle = grd
    ctx.fillRect(0, 0, W, 160)

    let cy = PAD

    if (logoImg) {
      const maxH = 64
      const maxW = 120
      const scale = Math.min(maxW / logoImg.width, maxH / logoImg.height, 1)
      const lw = logoImg.width * scale
      const lh = logoImg.height * scale
      ctx.drawImage(logoImg, (W - lw) / 2, cy, lw, lh)
      cy += lh + 20
    }

    ctx.fillStyle = '#000000'
    ctx.font = '600 32px "Cinzel", "Times New Roman", serif'
    ctx.textAlign = 'center'
    ctx.fillText(companyName.toUpperCase(), W / 2, cy + 28)
    cy += 48

    ctx.fillStyle = '#9A9A9A'
    ctx.font = '500 14px system-ui, -apple-system, sans-serif'
    ctx.letterSpacing = '2px'
    ctx.fillText('PAYMENT RECEIPT', W / 2, cy)
    cy += 48

    const drawRow = (label, value, opts = {}) => {
      ctx.textAlign = 'left'
      ctx.fillStyle = opts.mutedLabel !== false ? '#9A9A9A' : '#000000'
      ctx.font = (opts.bold ? '600 ' : '400 ') + (opts.big ? '18px' : '16px') + ' system-ui, -apple-system, sans-serif'
      ctx.fillText(label, PAD, cy)
      ctx.textAlign = 'right'
      ctx.fillStyle = '#000000'
      ctx.font = (opts.big || opts.bold ? '700 ' : '500 ') + (opts.big ? '28px' : '16px') + ' system-ui, -apple-system, sans-serif'
      const maxValW = W - PAD * 2 - 180
      let val = value || ''
      while (ctx.measureText(val).width > maxValW && val.length > 3) val = val.slice(0, -2) + '…'
      ctx.fillText(val, W - PAD, cy)
      cy += opts.big ? 48 : 40
    }

    rows.forEach((row) => drawRow(row.label, row.value, { mutedLabel: true }))

    cy += 8
    ctx.strokeStyle = '#E5E5E5'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(PAD, cy)
    ctx.lineTo(W - PAD, cy)
    ctx.stroke()
    cy += 36

    moneyRows.forEach((row, i) => {
      if (row.bold && i > 0) {
        ctx.strokeStyle = '#E5E5E5'
        ctx.beginPath()
        ctx.moveTo(PAD, cy - 16)
        ctx.lineTo(W - PAD, cy - 16)
        ctx.stroke()
      }
      drawRow(row.label, row.value, { big: row.big, bold: row.bold, mutedLabel: !row.bold })
    })

    cy = H - PAD - 8
    ctx.textAlign = 'center'
    ctx.fillStyle = '#B0B0B0'
    ctx.font = '400 12px system-ui, -apple-system, sans-serif'
    ctx.fillText(
      'Generated by BuildWatch · Receipt ID ' + String(r.id).slice(0, 8),
      W / 2,
      cy
    )

    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/png')
    })
  }

  const shareReceipt = async (r) => {
    let blob = null
    try {
      blob = await buildReceiptImage(r)
    } catch (e) {
      console.warn('receipt image failed', e)
    }
    const fileName = 'receipt-' + String(r.id).slice(0, 8) + '.png'
    try {
      if (blob && navigator.share && navigator.canShare) {
        const file = new File([blob], fileName, { type: 'image/png' })
        // Image only — no accompanying text
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file] })
          return
        }
      }
    } catch (err) {
      if (err && err.name === 'AbortError') return
    }
    // Fallback: download the image so user can share from Photos
    if (blob) {
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 2000)
      alert('Receipt image saved. Open it from Downloads/Files to share.')
      return
    }
    alert('Could not create receipt image.')
  }

  if (receipt) {
    return (
      <div className="fixed inset-0 z-[80] bg-white flex flex-col">
        <div className="print-hide flex items-center justify-between gap-2 px-4 py-3 border-b border-black" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}>
          <button type="button" onClick={() => setReceipt(null)} className="flex items-center gap-1 text-sm text-[#6B6E72]">
            <ChevronLeft size={16} /> Back
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => shareReceipt(receipt)}
              className="flex items-center gap-1.5 text-sm px-3 py-1.5 border border-black rounded"
            >
              <Share2 size={14} /> Share
            </button>
            <button
              type="button"
              onClick={() => printReceipt(receipt)}
              className="flex items-center gap-1.5 text-sm px-3 py-1.5 bg-black text-white rounded"
            >
              <Printer size={14} /> Print / PDF
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-6 max-w-lg mx-auto w-full" id="payment-receipt-print">
          <div className="border border-black rounded-md p-6">
            <div className="text-center mb-6">
              {companyInfo?.logo_url && (
                <img src={companyInfo.logo_url} alt="" className="h-12 mx-auto mb-2 object-contain" />
              )}
              <div className="font-display text-xl">{companyInfo?.name || 'BuildWatch'}</div>
              <div className="text-[11px] font-mono uppercase text-[#6B6E72] mt-1">Payment receipt</div>
            </div>
            <div className="space-y-2 text-sm mb-6">
              <div className="flex justify-between gap-3">
                <span className="text-[#6B6E72]">Project</span>
                <span className="font-medium text-right">{project.address}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-[#6B6E72]">Date</span>
                <span>{fmtDateTime(receipt.created_at) || fmtDate(receipt.created_at)}</span>
              </div>
              {receipt.note && (
                <div className="flex justify-between gap-3">
                  <span className="text-[#6B6E72]">Note</span>
                  <span className="text-right">{receipt.note}</span>
                </div>
              )}
            </div>
            <div className="border-t border-black/20 pt-4 space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <span className="text-[#6B6E72]">Payment received</span>
                <span className="font-semibold text-lg tabular-nums">{money(receipt.amount)}</span>
              </div>
              {receipt.total_at_payment != null && (
                <div className="flex justify-between gap-3">
                  <span className="text-[#6B6E72]">Project total</span>
                  <span className="tabular-nums">{money(receipt.total_at_payment)}</span>
                </div>
              )}
              {receipt.paid_after != null && (
                <div className="flex justify-between gap-3">
                  <span className="text-[#6B6E72]">Total paid to date</span>
                  <span className="tabular-nums">{money(receipt.paid_after)}</span>
                </div>
              )}
              {receipt.remaining_after != null && (
                <div className="flex justify-between gap-3 border-t border-black/10 pt-2">
                  <span className="font-medium">Balance remaining</span>
                  <span className="font-semibold tabular-nums">{money(receipt.remaining_after)}</span>
                </div>
              )}
            </div>
            <p className="text-[10px] text-[#6B6E72] mt-8 text-center">
              Generated by BuildWatch · Receipt ID {String(receipt.id).slice(0, 8)}
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white border border-black rounded-md p-4 mb-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h3 className="text-[11px] font-mono uppercase text-[#6B6E72]">Cost of construction</h3>
        {isAdmin && !editing && !recordingPay && (
          <div className="flex gap-3">
            <button type="button" onClick={() => setRecordingPay(true)} className="text-xs underline text-[#6B6E72]">
              Record payment
            </button>
            <button type="button" onClick={() => setEditing(true)} className="text-xs underline text-[#6B6E72]">
              Edit contract
            </button>
          </div>
        )}
      </div>

      {recordingPay && isAdmin ? (
        <div className="space-y-3">
          <div>
            <label className="block text-[11px] font-mono uppercase text-[#6B6E72] mb-1">Payment amount</label>
            <div className="flex items-center gap-2">
              <span className="text-sm">$</span>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                className="w-full border border-black rounded px-3 py-2 text-sm"
                placeholder="0.00"
                autoFocus
              />
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-mono uppercase text-[#6B6E72] mb-1">Note (optional)</label>
            <input
              value={payNote}
              onChange={(e) => setPayNote(e.target.value)}
              className="w-full border border-black rounded px-3 py-2 text-sm"
              placeholder="e.g. Deposit, Progress draw 2"
            />
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setRecordingPay(false)} className="flex-1 py-2 border border-black rounded text-sm">
              Cancel
            </button>
            <button type="button" disabled={saving} onClick={recordPayment} className="flex-1 py-2 bg-black text-white rounded text-sm disabled:opacity-50">
              {saving ? 'Saving…' : 'Save & receipt'}
            </button>
          </div>
        </div>
      ) : editing && isAdmin ? (
        <div className="space-y-3">
          <div>
            <label className="block text-[11px] font-mono uppercase text-[#6B6E72] mb-1">Original contract</label>
            <div className="flex items-center gap-2">
              <span className="text-sm">$</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={baseInput}
                onChange={(e) => setBaseInput(e.target.value)}
                className="w-full border border-black rounded px-3 py-2 text-sm"
                placeholder="0.00"
              />
            </div>
          </div>
          <p className="text-xs text-[#6B6E72]">
            Use Record payment to log payments and generate receipts. Approved change orders add to the total automatically.
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={() => setEditing(false)} className="flex-1 py-2 border border-black rounded text-sm">
              Cancel
            </button>
            <button type="button" disabled={saving} onClick={saveBase} className="flex-1 py-2 bg-black text-white rounded text-sm disabled:opacity-50">
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2 text-sm">
          <div className="flex justify-between gap-3">
            <span className="text-[#6B6E72]">Original contract</span>
            <span className="font-medium tabular-nums">{money(base)}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-[#6B6E72]">
              Approved change orders{approvedCos.length ? ` (${approvedCos.length})` : ''}
            </span>
            <span className="font-medium tabular-nums">
              {changeOrderTotal ? '+' + money(changeOrderTotal) : money(0)}
            </span>
          </div>
          <div className="flex justify-between gap-3 border-t border-black/10 pt-2">
            <span className="font-medium">Total</span>
            <span className="font-semibold tabular-nums">{money(total)}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-[#6B6E72]">Paid</span>
            <span className="font-medium tabular-nums text-[#3F7D58]">{money(paid)}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-[#6B6E72]">Remaining</span>
            <span
              className={
                'font-semibold tabular-nums ' +
                (remaining != null && remaining > 0 ? 'text-[#B5533C]' : 'text-[#3F7D58]')
              }
            >
              {money(remaining)}
            </span>
          </div>
          {payments.length > 0 && (
            <div className="pt-3 mt-1 border-t border-black/10">
              <div className="text-[11px] font-mono uppercase text-[#6B6E72] mb-2">Payment receipts</div>
              <div className="space-y-1.5">
                {payments.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => openReceipt(p)}
                    className="w-full flex justify-between items-center gap-2 text-left text-sm py-1.5 px-2 rounded border border-black/15 hover:border-black"
                  >
                    <span className="text-[#6B6E72] text-xs">{fmtDate(p.created_at)}{p.note ? ` · ${p.note}` : ''}</span>
                    <span className="font-medium tabular-nums">{money(p.amount)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {base == null && !changeOrderTotal && (
            <p className="text-xs text-[#6B6E72] pt-1">
              {isAdmin ? 'Set the original contract amount to track costs.' : 'No cost set yet.'}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function ProjectNavRow({ icon, label, count, extra, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full py-3 px-4 rounded border border-black bg-white text-left flex items-center gap-3 hover:bg-[#F5F5F5]"
    >
      <span className="text-black">{icon}</span>
      <span className="flex-1 text-sm font-medium">{label}</span>
      {extra ? <span className="text-[11px] font-mono text-[#6B6E72]">{extra}</span> : null}
      {count ? <span className="text-[10px] font-mono uppercase bg-[#E6B800] text-black px-1.5 py-0.5 rounded">{count}</span> : null}
      <ChevronRight size={16} className="text-[#8A8D91]" />
    </button>
  )
}

function ProjectChangeOrdersBlock({ project, isAdmin, isCustomer, profile, onReload, logActivity }) {
  return (
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
                    <a href={co.public_url} target="_blank" rel="noreferrer" className="text-xs underline mt-2 inline-block">View attachment</a>
                  )}
                  {isAdmin && co.team_amount != null && co.team_amount !== '' && (
                    <div className="text-xs mt-2 text-[#6B6E72]">Trade request: ${Number(co.team_amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                  )}
                  {(isAdmin || isCustomer) && (co.amount != null && co.amount !== '') && (
                    <div className="text-sm mt-1 font-medium">
                      {isCustomer ? 'Amount' : (co.origin === 'admin_offer' ? 'Customer offer' : 'Customer total')}: ${Number(co.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  )}
                  {!isAdmin && !isCustomer && co.team_amount != null && co.team_amount !== '' && (
                    <div className="text-sm mt-2 font-medium">Cost: ${Number(co.team_amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                  )}
                  {isAdmin && st === 'pending' && (
                    <QuoteReplyForm changeOrder={co} profile={profile} logActivity={logActivity} onDone={onReload} />
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
  const [projectPage, setProjectPage] = useState(null)
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

  if (showPeople || projectPage === 'people') {
    return (
      <ProjectPeoplePage
        project={project}
        isAdmin={isAdmin}
        companyUsers={companyUsers}
        onBack={() => { setShowPeople(false); setProjectPage(null) }}
        onReload={onReload}
      />
    )
  }

  const doneCount = phases.filter((p) => p.status === 'done').length

  const setStatus = async (status) => {
    if (!isAdmin) return
    await supabase.from('projects').update({ status }).eq('id', project.id)
    await logActivity('updated project status', status)
    if (status === 'done' && !project.archived) {
      if (confirm('Project marked complete. Archive it so it leaves the active list? You can restore it anytime from Archived.')) {
        await supabase.from('projects').update({ archived: true }).eq('id', project.id)
      }
    }
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
    const compressed = await compressImageFile(file, 1600, 0.75)
    const safeName = (compressed.name || file.name || 'cover.jpg').replace(/[^a-zA-Z0-9._-]/g, '_')
    const path = profile.company_id + '/' + project.id + '/covers/' + Date.now() + '-' + safeName
    const bytes = await compressed.arrayBuffer()
    const { error: upErr } = await supabase.storage.from('project-photos').upload(path, bytes, {
      contentType: compressed.type || 'image/jpeg',
      cacheControl: '31536000',
    })
    if (upErr) {
      alert(upErr.message)
      return
    }
    const { data: pub } = supabase.storage.from('project-photos').getPublicUrl(path)
    setEditCover(pub.publicUrl)
  }

  const pageBack = (
    <button type="button" onClick={() => { setProjectPage(null); setShowExport(false) }} className="flex items-center gap-1 text-sm text-[#6B6E72] mb-4">
      <ChevronLeft size={16} /> {project.address}
    </button>
  )

  if (projectPage === 'files') {
    return (
      <SwipeBack onBack={() => setProjectPage(null)}>
        {pageBack}
        <h2 className="font-display text-2xl mb-4">Plans & files</h2>
        <div className="bg-white border border-black rounded-md p-4 mb-4">
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
      </SwipeBack>
    )
  }

  if (projectPage === 'changeOrders') {
    return (
      <SwipeBack onBack={() => setProjectPage(null)}>
        {pageBack}
        <h2 className="font-display text-2xl mb-4">Change orders</h2>
        <ProjectChangeOrdersBlock
          project={project}
          isAdmin={isAdmin}
          isCustomer={isCustomer}
          profile={profile}
          onReload={onReload}
          logActivity={logActivity}
        />
      </SwipeBack>
    )
  }

  if (projectPage === 'cost') {
    return (
      <SwipeBack onBack={() => setProjectPage(null)}>
        {pageBack}
        <h2 className="font-display text-2xl mb-4">Cost of construction</h2>
        <ProjectCostSection
          project={project}
          isAdmin={isAdmin}
          profile={profile}
          onReload={onReload}
          logActivity={logActivity}
        />
      </SwipeBack>
    )
  }

  if (projectPage === 'activity') {
    return (
      <SwipeBack onBack={() => setProjectPage(null)}>
        {pageBack}
        <h2 className="font-display text-2xl mb-4">Activity</h2>
        <div className="bg-white border border-black rounded-md p-4 mb-4">
          <ProjectActivity projectId={project.id} />
        </div>
      </SwipeBack>
    )
  }

  if (projectPage === 'status') {
    return (
      <SwipeBack onBack={() => setProjectPage(null)}>
        {pageBack}
        <h2 className="font-display text-2xl mb-4">Project status</h2>
        <div className="bg-white border border-black rounded-md p-4 mb-4">
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
      </SwipeBack>
    )
  }

  return (
    <SwipeBack onBack={onBack}>
            <button onClick={onBack} className="flex items-center gap-1 text-sm text-[#6B6E72] mb-4">
        <ChevronLeft size={16} /> All projects
      </button>

      <div className="bg-white border border-black rounded-md overflow-hidden mb-4">
        {(editingProject ? editCover : project.cover_photo_url) && (
          <img src={photoDisplayUrl(editingProject ? editCover : project.cover_photo_url, 800)} alt="" decoding="async" className="w-full h-44 object-cover" />
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

      <div className="space-y-2 mb-6">
        <ProjectNavRow icon={<FolderOpen size={16} />} label="Plans & files" count={files.length || null} onClick={() => setProjectPage('files')} />
        <ProjectNavRow
          icon={<FileText size={16} />}
          label="Change orders"
          count={(project.change_orders || []).filter((c) => ['pending', 'quoted'].includes(c.status || '')).length || null}
          onClick={() => setProjectPage('changeOrders')}
        />
        {(isAdmin || isCustomer) && (
          <ProjectNavRow icon={<DollarSign size={16} />} label="Cost of construction" onClick={() => setProjectPage('cost')} />
        )}
        {(isAdmin || isCustomer) && (
          <ProjectNavRow icon={<Activity size={16} />} label="Activity" onClick={() => setProjectPage('activity')} />
        )}
        {isAdmin && (
          <ProjectNavRow icon={<CircleDot size={16} />} label="Project status" extra={PROJECT_STATUS[project.status]?.label} onClick={() => setProjectPage('status')} />
        )}
        {!isCustomer && (
          <ProjectNavRow icon={<Users size={16} />} label="Who’s on this project" onClick={() => { setShowPeople(true); setProjectPage('people') }} />
        )}
        {(isAdmin || isCustomer) && (
          <ProjectNavRow icon={<Printer size={16} />} label="Project summary" onClick={() => setShowExport(true)} />
        )}
        {isAdmin && (
          <button
            type="button"
            className="w-full py-3 px-4 rounded border border-black bg-white text-left flex items-center gap-3 hover:bg-[#F5F5F5]"
            onClick={async () => {
              if (!project.archived && !confirm('Archive this project? You can restore it from Archived.')) return
              await supabase.from('projects').update({ archived: !project.archived }).eq('id', project.id)
              onReload()
              onBack()
            }}
          >
            <Archive size={16} />
            <span className="flex-1 text-sm font-medium">{project.archived ? 'Unarchive project' : 'Archive project'}</span>
            <ChevronRight size={16} className="text-[#8A8D91]" />
          </button>
        )}
        {isAdmin && project.status === 'done' && !(project.phases || []).some((ph) => /punch/i.test(ph.name || '')) && (
          <button
            type="button"
            className="w-full py-3 px-4 rounded border border-black bg-white text-left flex items-center gap-3 hover:bg-[#F5F5F5]"
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
            <Check size={16} />
            <span className="flex-1 text-sm font-medium">Add punch list</span>
          </button>
        )}
      </div>


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
              <h1 className="font-display text-2xl mb-1">{project.address}</h1>
              <p className="text-sm text-[#6B6E72] mb-1">{formatStyleLabel(project.style)} · {PROJECT_STATUS[project.status]?.label || project.status}</p>
              <p className="text-sm text-[#6B6E72] mb-4">
                {fmtDate(project.start_date)} – {project.end_date ? fmtDate(project.end_date) : 'TBD'} · {doneCount}/{phases.length} phases complete
              </p>
              {(isAdmin || isCustomer) && (
                <div className="mb-6 text-sm border border-black rounded p-3 space-y-1">
                  <h2 className="text-sm font-medium mb-2">Cost summary</h2>
                  {(() => {
                    const cos = (project.change_orders || []).filter((c) => c.status === 'approved' && c.amount != null)
                    const coSum = cos.reduce((s, c) => s + (Number(c.amount) || 0), 0)
                    const base = project.base_cost != null ? Number(project.base_cost) : null
                    const total = base != null || coSum ? (base || 0) + coSum : null
                    const paid = Number(project.amount_paid) || 0
                    return (
                      <>
                        <div className="flex justify-between"><span>Original contract</span><span>{money(base)}</span></div>
                        <div className="flex justify-between"><span>Approved change orders</span><span>{money(coSum)}</span></div>
                        <div className="flex justify-between font-medium"><span>Total</span><span>{money(total)}</span></div>
                        <div className="flex justify-between"><span>Paid</span><span>{money(paid)}</span></div>
                        <div className="flex justify-between font-medium"><span>Remaining</span><span>{money(total != null ? total - paid : null)}</span></div>
                      </>
                    )
                  })()}
                </div>
              )}
              <h2 className="text-sm font-medium mb-2">Phases</h2>
              <ul className="text-sm space-y-1 mb-6">
                {phases.map((ph) => (
                  <li key={ph.id}>{ph.name} — {ph.status}{(ph.photos || []).length ? ` · ${(ph.photos || []).length} photos` : ''}</li>
                ))}
              </ul>
              <h2 className="text-sm font-medium mb-2">Approved change orders</h2>
              <ul className="text-sm space-y-1 mb-6">
                {(project.change_orders || []).filter((c) => (c.status || '') === 'approved').length
                  ? (project.change_orders || []).filter((c) => (c.status || '') === 'approved').map((c) => (
                      <li key={c.id}>{c.title}{c.amount != null ? ` — $${Number(c.amount).toFixed(2)}` : ''}</li>
                    ))
                  : <li>None</li>}
              </ul>
              <h2 className="text-sm font-medium mb-2">Key photos</h2>
              <div className="grid grid-cols-2 gap-2">
                {phases.flatMap((ph) => (ph.photos || []).map((p) => ({ ...p, phaseName: ph.name }))).slice(0, 12).map((p) => (
                  <div key={p.id} className="border border-black/20 rounded overflow-hidden">
                    <img src={photoDisplayUrl(p.url || p.dataUrl, 480)} alt="" loading="lazy" decoding="async" className="w-full h-28 object-cover" />
                    <div className="text-[10px] p-1 text-[#6B6E72]">{p.phaseName}</div>
                  </div>
                ))}
                {phases.every((ph) => !(ph.photos || []).length) && <p className="text-sm text-[#6B6E72]">No photos yet.</p>}
              </div>
              <p className="text-[10px] text-[#6B6E72] mt-8 text-center">BuildWatch project summary · {new Date().toLocaleDateString()}</p>
            </div>
          </div>
        </SwipeBack>
      )}

      {isAdmin && (
        <button
          onClick={() => {
            if (!confirm('Permanently delete this project and all photos, files, and history? Prefer Archive if you only want it off the active list.')) return
            onDelete(project.id)
          }}
          className="text-xs text-[#B5533C] flex items-center gap-1"
        >
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
      const compressed = await compressImageFile(file)
      const safeName = (compressed.name || file.name || 'photo.jpg').replace(/[^a-zA-Z0-9._-]/g, '_')
      const path = profile.company_id + '/' + project.id + '/tasks/' + task.id + '/' + Date.now() + '-' + safeName
      const bytes = await compressed.arrayBuffer()
      const { error: upErr } = await supabase.storage.from('project-photos').upload(path, bytes, {
        contentType: compressed.type || 'image/jpeg',
        cacheControl: '31536000',
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
                      <img src={photoDisplayUrl(ph.public_url, 400)} alt="" loading="lazy" decoding="async" className="w-full h-20 object-cover rounded border border-black" />
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
      .limit(40)
      .then(({ data }) => setItems(data || []))
  }, [projectId])
  if (!items.length) return <p className="text-xs text-[#8A8D91]">No activity yet.</p>
  return (
    <div className="space-y-2 max-h-64 overflow-y-auto">
      {items.map((a) => (
        <div key={a.id} className="text-xs border-b border-[#E5E5E5] pb-2">
          <div className="font-medium">{a.action}{a.detail ? ` — ${a.detail}` : ''}</div>
          <div className="text-[10px] font-mono text-[#8A8D91]">{a.user_name || a.user_email} · {fmtDateTime(a.created_at) || fmtDate(a.created_at)}</div>
        </div>
      ))}
    </div>
  )
}

function InviteHelpGuide({ company, onBack }) {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://your-app.vercel.app'
  const shareUrl = company?.app_share_url || origin
  return (
    <SwipeBack onBack={onBack}>
      <button type="button" onClick={onBack} className="flex items-center gap-1 text-sm text-[#6B6E72] mb-4">
        <ChevronLeft size={16} /> Back
      </button>
      <h2 className="font-display text-2xl mb-2">How to invite</h2>
      <p className="text-sm text-[#6B6E72] mb-4">Share BuildWatch with customers and trades in a few steps.</p>
      <div className="space-y-4 text-sm">
        <div className="border border-black rounded-md p-4">
          <div className="text-[11px] font-mono uppercase text-[#6B6E72] mb-1">1. App link</div>
          <p className="mb-2">Send this link so they can open the app on any phone or computer:</p>
          <code className="block text-xs bg-[#F5F5F5] border border-black/20 rounded px-2 py-2 break-all">{shareUrl}</code>
        </div>
        <div className="border border-black rounded-md p-4">
          <div className="text-[11px] font-mono uppercase text-[#6B6E72] mb-1">2. Invite by email</div>
          <p>In the menu open <strong>Users / Contractor</strong>. Enter their email and choose a role:</p>
          <ul className="list-disc ml-5 mt-2 space-y-1">
            <li><strong>Contractor</strong> — full access (same as you)</li>
            <li><strong>Trade</strong> — only projects and phases you assign; can upload photos</li>
            <li><strong>Customer</strong> — only projects you add them to; photos, progress, costs, change orders</li>
          </ul>
        </div>
        <div className="border border-black rounded-md p-4">
          <div className="text-[11px] font-mono uppercase text-[#6B6E72] mb-1">3. What they do next</div>
          <p>They open the link, choose join / invited, sign up with the <strong>same email</strong> you invited, then set a personal password when prompted.</p>
        </div>
        <div className="border border-black rounded-md p-4">
          <div className="text-[11px] font-mono uppercase text-[#6B6E72] mb-1">4. Attach to a project</div>
          <p>Open the project → <strong>Who’s on this project</strong> → assign the customer to the job or the trade to specific phases.</p>
        </div>
      </div>
    </SwipeBack>
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
    touchX.current = { x: t.clientX, y: t.clientY, edge: t.clientX <= 48, t: Date.now() }
  }
  const onTouchEnd = (e) => {
    if (touchX.current == null) return
    const t = e.changedTouches[0]
    const dx = t.clientX - touchX.current.x
    const dy = t.clientY - touchX.current.y
    const fromEdge = touchX.current.edge
    const dt = Date.now() - (touchX.current.t || Date.now())
    touchX.current = null
    // Swipe photos in lightbox (anywhere)
    if (lightboxIdx != null) {
      if (Math.abs(dx) > Math.abs(dy) && dx < -50 && lightboxIdx < photos.length - 1) setLightboxIdx((i) => i + 1)
      else if (Math.abs(dx) > Math.abs(dy) && dx > 50 && lightboxIdx > 0) setLightboxIdx((i) => i - 1)
      return
    }
    // Back only from left edge + clear horizontal swipe
    const quick = dt < 280 && dx > 48
    const long = dx >= 72
    if (fromEdge && (quick || long) && dx > Math.abs(dy) * 1.4) onBack()
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
    if (!files.length) return
    if (!canUpload) {
      alert('You do not have permission to upload photos on this phase.')
      return
    }
    if (!profile?.company_id || !project?.id || !phase?.id) {
      alert('Missing project or phase — try reopening this phase.')
      return
    }

    setUploading(true)
    const cap = caption || null
    const tag = photoTag || null
    setCaption('')

    let ok = 0
    const errors = []

    for (const file of files) {
      if (!file.size) {
        errors.push('Empty file skipped')
        continue
      }
      const isVideo = (file.type || '').startsWith('video/')
      // Shrink phone photos so grids load quickly (videos left as-is)
      const uploadFile = isVideo ? file : await compressImageFile(file)
      const safeName = (uploadFile.name || file.name || (isVideo ? 'video.mp4' : 'photo.jpg')).replace(/[^a-zA-Z0-9._-]/g, '_')
      const path =
        String(profile.company_id) +
        '/' +
        String(project.id) +
        '/' +
        String(phase.id) +
        '/' +
        Date.now() +
        '-' +
        Math.random().toString(36).slice(2, 6) +
        '-' +
        safeName
      const contentType = uploadFile.type || file.type || (isVideo ? 'video/mp4' : 'image/jpeg')
      try {
        let upErr = null
        // Prefer raw bytes — more reliable on iOS / HEIC / large files than File object quirks
        try {
          const bytes = await uploadFile.arrayBuffer()
          const res = await supabase.storage.from('project-photos').upload(path, bytes, {
            upsert: true,
            contentType,
            cacheControl: '31536000',
          })
          upErr = res.error
        } catch (inner) {
          const res2 = await supabase.storage.from('project-photos').upload(path, uploadFile, {
            upsert: true,
            contentType,
            cacheControl: '31536000',
          })
          upErr = res2.error || inner
        }
        if (upErr) {
          errors.push((upErr.message || String(upErr)) + ' (storage)')
          continue
        }
        const { data: pub } = supabase.storage.from('project-photos').getPublicUrl(path)
        const { error: insErr } = await supabase.from('photos').insert({
          phase_id: phase.id,
          project_id: project.id,
          storage_path: path,
          public_url: pub.publicUrl,
          caption: cap,
          tag: tag,
          media_type: isVideo ? 'video' : 'image',
          uploaded_by: profile.id,
        })
        if (insErr) {
          errors.push((insErr.message || 'Could not save photo record') + ' (database)')
          continue
        }
        ok++
      } catch (err) {
        console.error(err)
        errors.push(err.message || 'Upload failed')
      }
    }

    setUploading(false)
    if (ok) {
      await logActivity('uploaded media', ok + ' file' + (ok > 1 ? 's' : ''), project.id, phase.name)
      onReload()
    }
    if (errors.length) {
      alert(
        (ok ? ok + ' uploaded. ' : '') +
          'Upload problem: ' +
          errors.slice(0, 3).join(' · ')
      )
    } else if (!ok) {
      alert('No photos were uploaded.')
    }
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
                  <img src={photoDisplayUrl(p.public_url, 480)} alt="" loading="lazy" decoding="async" className="w-full h-32 object-cover" />
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
              <img src={photoDisplayUrl(lb.public_url, 1400)} alt="" decoding="async" className="max-h-full max-w-full object-contain" />
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

