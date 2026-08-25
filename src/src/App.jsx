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

export default function App() {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [company, setCompany] = useState(null)
  const [loading, setLoading] = useState(true)
  const [profileReady, setProfileReady] = useState(false)
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

    supabase.auth.getSession().then(({ data: { session: s } }) => {
      if (!mounted) return
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
      setSession(s)
      if (!s?.user) {
        setProfile(null)
        setCompany(null)
        clearCachedProfile()
        setProfileReady(true)
        return
      }
      // TOKEN_REFRESHED / USER_UPDATED: soft reload — never flash setup
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

  if (loading || (session && !profileReady && !profile?.company_id)) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-[#6B6E72]">
        Loading…
      </div>
    )
  }

  if (!session) {
    return <AuthScreen />
  }

  const handleLogout = async () => {
    clearCachedProfile()
    await supabase.auth.signOut()
    try {
      if (navigator.clearAppBadge) await navigator.clearAppBadge()
    } catch (_) {}
  }

  // Platform owner: separate screen — companies + feedback only, no projects
  const platformOwner =
    isPlatformAdmin(profile) || isPlatformAdmin(session.user?.email)

  if (platformOwner && profileReady) {
    return (
      <PlatformAdmin
        profile={profile}
        session={session}
        onLogout={handleLogout}
      />
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
    />
  )
}
