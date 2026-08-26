import { useEffect, useRef, useState } from 'react'
import { supabase } from './lib/supabase'
import AuthScreen from './pages/AuthScreen'
import SetupCompany from './pages/SetupCompany'
import Dashboard from './pages/Dashboard'
import PlatformAdmin from './components/PlatformAdmin'
import { isPlatformAdmin } from './lib/platform'

const PROFILE_CACHE_KEY = 'bw_profile_cache'

function readCachedProfile(userId) {
  try {
    const raw = localStorage.getItem(PROFILE_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (parsed?.userId === userId && parsed?.profile?.company_id) return parsed
  } catch (_) {}
  return null
}

function writeCachedProfile(userId, profile, company) {
  try {
    if (userId && profile?.company_id) {
      localStorage.setItem(
        PROFILE_CACHE_KEY,
        JSON.stringify({ userId, profile, company: company || null, at: Date.now() })
      )
    }
  } catch (_) {}
}

function clearCachedProfile() {
  try {
    localStorage.removeItem(PROFILE_CACHE_KEY)
  } catch (_) {}
}

const WORKSPACE_KEY = 'bw_platform_workspace'
const RECOVERY_KEY = 'bw_password_recovery'

function markPasswordRecovery() {
  try {
    sessionStorage.setItem(RECOVERY_KEY, '1')
  } catch (_) {}
}

function clearPasswordRecoveryFlag() {
  try {
    sessionStorage.removeItem(RECOVERY_KEY)
  } catch (_) {}
}

function isPasswordRecoveryMarked() {
  try {
    return sessionStorage.getItem(RECOVERY_KEY) === '1'
  } catch {
    return false
  }
}

function urlLooksLikeRecovery() {
  try {
    const hash = window.location.hash || ''
    const search = window.location.search || ''
    const full = (hash + ' ' + search).toLowerCase()
    return (
      full.includes('type=recovery') ||
      full.includes('type%3drecovery') ||
      full.includes('type=recovery'.toLowerCase())
    )
  } catch {
    return false
  }
}

function SetNewPasswordScreen({ onDone }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    if (password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setLoading(true)
    const { error: err } = await supabase.auth.updateUser({ password })
    setLoading(false)
    if (err) {
      setError(err.message || 'Could not update password')
      return
    }
    setDone(true)
    clearPasswordRecoveryFlag()
    // Clear recovery tokens from URL
    try {
      window.history.replaceState({}, '', window.location.pathname)
    } catch (_) {}
    setTimeout(() => onDone?.(), 800)
  }

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <h1 className="font-display text-2xl mb-1 text-center">Set a new password</h1>
        <p className="text-sm text-[#6B6E72] text-center mb-6">
          Choose a password you will use to sign in to BuildWatch.
        </p>
        {done ? (
          <p className="text-sm text-center text-[#3F7D58]">Password updated. Opening your account…</p>
        ) : (
          <form onSubmit={submit} className="bg-white border border-black rounded-md p-4 space-y-3">
            <div>
              <label className="block text-[11px] font-mono uppercase text-[#6B6E72] mb-1">New password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                className="w-full border border-black rounded px-3 py-2.5 text-sm"
                autoComplete="new-password"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-[11px] font-mono uppercase text-[#6B6E72] mb-1">Confirm password</label>
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
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded text-sm font-medium text-white bg-black disabled:opacity-50"
            >
              {loading ? 'Saving…' : 'Save new password'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

export default function App() {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [company, setCompany] = useState(null)
  const [loading, setLoading] = useState(true)
  const [profileReady, setProfileReady] = useState(false)
  const [passwordRecovery, setPasswordRecovery] = useState(() => {
    if (typeof window === 'undefined') return false
    if (urlLooksLikeRecovery()) {
      markPasswordRecovery()
      return true
    }
    return isPasswordRecoveryMarked()
  })
  const [platformWorkspace, setPlatformWorkspace] = useState(() => {
    try {
      return localStorage.getItem(WORKSPACE_KEY) === '1'
    } catch {
      return false
    }
  })
  const loadGen = useRef(0)

  const loadProfile = async (userId, { soft = false } = {}) => {
    if (!userId) return
    const gen = ++loadGen.current

    // Soft: keep existing UI while refreshing
    if (!soft) {
      const cached = readCachedProfile(userId)
      if (cached) {
        setProfile(cached.profile)
        setCompany(cached.company)
      }
    }

    try {
      const { data: prof, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle()

      if (gen !== loadGen.current) return // stale response

      if (error) {
        console.error('profile load', error)
        // Do NOT clear a known-good profile on transient errors
        if (!profile?.company_id) {
          const cached = readCachedProfile(userId)
          if (cached) {
            setProfile(cached.profile)
            setCompany(cached.company)
          }
        }
        setProfileReady(true)
        return
      }

      if (!prof) {
        // Profile row missing — only clear if we never had a company
        const cached = readCachedProfile(userId)
        if (cached?.profile?.company_id) {
          setProfile(cached.profile)
          setCompany(cached.company)
        } else {
          setProfile(null)
          setCompany(null)
        }
        setProfileReady(true)
        return
      }

      setProfile(prof)

      if (prof.company_id) {
        const { data: comp, error: compErr } = await supabase
          .from('companies')
          .select('*')
          .eq('id', prof.company_id)
          .maybeSingle()

        if (gen !== loadGen.current) return

        if (compErr) {
          console.error('company load', compErr)
          // Keep previous company / cache if network blip
          const cached = readCachedProfile(userId)
          if (cached?.company) setCompany(cached.company)
        } else {
          setCompany(comp || null)
          writeCachedProfile(userId, prof, comp || null)
        }
      } else {
        setCompany(null)
        // Truly no company — clear cache so setup can run
        clearCachedProfile()
      }
    } catch (err) {
      console.error('loadProfile', err)
      const cached = readCachedProfile(userId)
      if (cached) {
        setProfile(cached.profile)
        setCompany(cached.company)
      }
    }

    if (gen === loadGen.current) setProfileReady(true)
  }

  useEffect(() => {
    let mounted = true

    const enterRecovery = () => {
      markPasswordRecovery()
      if (mounted) setPasswordRecovery(true)
    }

    if (urlLooksLikeRecovery()) enterRecovery()

    // Newer Supabase email links: ?token_hash=...&type=recovery
    ;(async () => {
      try {
        const params = new URLSearchParams(window.location.search || '')
        const token_hash = params.get('token_hash')
        const type = params.get('type')
        if (token_hash && type === 'recovery') {
          enterRecovery()
          const { error } = await supabase.auth.verifyOtp({ token_hash, type: 'recovery' })
          if (error) console.error('recovery verifyOtp', error)
          try {
            window.history.replaceState({}, '', window.location.pathname)
          } catch (_) {}
        }
      } catch (err) {
        console.error('recovery parse', err)
      }
    })()

    supabase.auth.getSession().then(({ data: { session: s } }) => {
      if (!mounted) return
      if (urlLooksLikeRecovery() || isPasswordRecoveryMarked()) enterRecovery()
      setSession(s)
      if (s?.user) {
        const cached = readCachedProfile(s.user.id)
        if (cached) {
          setProfile(cached.profile)
          setCompany(cached.company)
        }
        loadProfile(s.user.id).finally(() => {
          if (mounted) setLoading(false)
        })
      } else {
        setLoading(false)
        setProfileReady(true)
      }
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') {
        enterRecovery()
      }
      // SIGNED_IN from a recovery link also carries type=recovery in the URL momentarily
      if (event === 'SIGNED_IN' && (urlLooksLikeRecovery() || isPasswordRecoveryMarked())) {
        enterRecovery()
      }
      setSession(s)
      if (!s?.user) {
        setProfile(null)
        setCompany(null)
        clearCachedProfile()
        setProfileReady(true)
        clearPasswordRecoveryFlag()
        setPasswordRecovery(false)
        return
      }
      const soft = event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED'
      loadProfile(s.user.id, { soft })
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  const refreshProfile = () => {
    if (session?.user) return loadProfile(session.user.id, { soft: true })
  }

  if (!session && !loading) {
    return <AuthScreen />
  }

  if (loading || !session) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-[#6B6E72]">
        Loading…
      </div>
    )
  }

  // Password reset link — always show set-password before dashboard
  if (passwordRecovery || isPasswordRecoveryMarked()) {
    return (
      <SetNewPasswordScreen
        onDone={() => {
          clearPasswordRecoveryFlag()
          setPasswordRecovery(false)
        }}
      />
    )
  }

  const handleLogout = async () => {
    clearCachedProfile()
    try {
      localStorage.removeItem(WORKSPACE_KEY)
    } catch (_) {}
    setPlatformWorkspace(false)
    await supabase.auth.signOut()
    try {
      if (navigator.clearAppBadge) await navigator.clearAppBadge()
    } catch (_) {}
  }

  const enterPlatformWorkspace = async () => {
    const { data, error } = await supabase.rpc('ensure_showcase_workspace')
    if (error) {
      alert(error.message + '\n\nRun showcase-workspace.sql in Supabase first.')
      return
    }
    try {
      localStorage.setItem(WORKSPACE_KEY, '1')
    } catch (_) {}
    setPlatformWorkspace(true)
    await loadProfile(session.user.id)
  }

  const leavePlatformWorkspace = async () => {
    try {
      await supabase.rpc('leave_showcase_workspace')
    } catch (_) {}
    try {
      localStorage.removeItem(WORKSPACE_KEY)
    } catch (_) {}
    setPlatformWorkspace(false)
    clearCachedProfile()
    setCompany(null)
    if (session?.user?.id) await loadProfile(session.user.id)
  }

  // Platform owner: platform panel by default; optional full workspace (Acme Builders)
  const platformOwner =
    isPlatformAdmin(session.user?.email) ||
    isPlatformAdmin(profile) ||
    !!profile?.is_platform_admin

  if (platformOwner && !platformWorkspace) {
    return (
      <PlatformAdmin
        profile={profile}
        session={session}
        onLogout={handleLogout}
        onOpenWorkspace={enterPlatformWorkspace}
      />
    )
  }

  if (!profileReady && !profile?.company_id) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-[#6B6E72]">
        Loading…
      </div>
    )
  }

  // Only show setup when we are sure profile has no company (not on a failed fetch)
  if (profileReady && profile && !profile.company_id) {
    return (
      <SetupCompany
        user={session.user}
        profile={profile}
        onDone={refreshProfile}
      />
    )
  }

  // Profile still resolving but we have cached company — stay on dashboard
  if (!profile?.company_id) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-[#6B6E72]">
        Loading…
      </div>
    )
  }

  return (
    <Dashboard
      session={session}
      profile={profile}
      company={company}
      onCompanyUpdate={refreshProfile}
      onLogout={handleLogout}
      platformOwner={platformOwner}
      onLeavePlatformWorkspace={platformOwner ? leavePlatformWorkspace : undefined}
    />
  )
}
