import { useState } from 'react'
import { ChevronLeft, AlertCircle } from 'lucide-react'
import { supabase } from '../lib/supabase'

export default function AuthScreen() {
  // choose | login | signup (new company) | join (invited customer/team)
  const [mode, setMode] = useState('choose') // choose | login | signup | join | reset
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  const goChoose = () => {
    setMode('choose')
    setError('')
    setMessage('')
    setEmail('')
    setPassword('')
    setName('')
    setCompanyName('')
  }

  const handleReset = async (e) => {
    e.preventDefault()
    setError('')
    setMessage('')
    const cleanEmail = email.trim().toLowerCase()
    if (!cleanEmail.includes('@')) {
      setError('Enter your email.')
      return
    }
    setLoading(true)
    const { error: err } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
      redirectTo:
        typeof window !== 'undefined'
          ? window.location.origin + '/'
          : undefined,
    })
    setLoading(false)
    if (err) setError(err.message)
    else setMessage('Check your email for a reset link.')
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setMessage('')
    setLoading(true)

    const cleanEmail = email.trim().toLowerCase()
    if (mode === 'reset') {
      setLoading(false)
      return handleReset(e)
    }
    if (!cleanEmail || !password) {
      setError('Email and password are required.')
      setLoading(false)
      return
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.')
      setLoading(false)
      return
    }

    try {
      if (mode === 'login') {
        const { error: err } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password,
        })
        if (err) {
          if (/invalid login credentials/i.test(err.message)) {
            setError(
              'No account found with that email/password. Invited users must use “I was invited” first (create account with the one-time password), not Log in.'
            )
          } else {
            setError(err.message)
          }
          setLoading(false)
          return
        }
      } else if (mode === 'join') {
        // Invited team/customer: create auth account, then SetupCompany attaches invite
        const { data, error: err } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
          options: {
            data: {
              name: name.trim() || cleanEmail.split('@')[0],
              role: 'team',
            },
          },
        })
        if (err) {
          if (/already registered|already been registered/i.test(err.message)) {
            // Account exists — try login with same password
            const { error: loginErr } = await supabase.auth.signInWithPassword({
              email: cleanEmail,
              password,
            })
            if (loginErr) {
              setError(
                'An account already exists for this email, but the password does not match. Use Log in with the password you created, or reset password in Supabase.'
              )
              setLoading(false)
              return
            }
          } else {
            throw err
          }
        } else if (data.user && !data.session) {
          setMessage(
            'Account created. If email confirmation is required, check your inbox, then use Log in. For testing, turn off Confirm email in Supabase → Authentication → Providers → Email.'
          )
          setLoading(false)
          return
        }
      } else {
        // signup = new company admin
        if (!companyName.trim()) {
          setError('Enter your company name.')
          setLoading(false)
          return
        }
        const { data, error: err } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
          options: {
            data: {
              name: name.trim() || cleanEmail.split('@')[0],
              role: 'admin',
              pending_company_name: companyName.trim(),
            },
          },
        })
        if (err) throw err
        sessionStorage.setItem('pending_company_name', companyName.trim())
        if (data.user && !data.session) {
          setMessage(
            'Check your email to confirm, then sign in. Or turn off Confirm email in Supabase Auth for testing.'
          )
        }
      }
    } catch (err) {
      setError(err.message || 'Something went wrong.')
    }
    setLoading(false)
  }

  const title =
    mode === 'login'
      ? 'Log in'
      : mode === 'join'
        ? 'I was invited'
        : 'Start a new company'

  const subtitle =
    mode === 'login'
      ? 'Only if you already created an account'
      : mode === 'reset'
        ? 'Enter your email to receive a reset link'
        : mode === 'join'
        ? 'Use the email and one-time password from your admin'
        : 'Create a private workspace. You will be the admin.'

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <div className="bg-black text-white px-5 pb-8" style={{ paddingTop: 'max(2rem, env(safe-area-inset-top))' }}>
        <div className="max-w-md mx-auto text-center">
          <h1 className="font-display text-2xl tracking-wide">Project Tracker</h1>
          <p className="text-white/60 text-xs mt-1 uppercase tracking-widest">Multi-company construction log</p>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          {mode === 'choose' ? (
            <>
              <h2 className="font-display text-2xl text-black text-center mb-2">Welcome</h2>
              <p className="text-sm text-[#6B6E72] text-center mb-8">Choose how you want to get started</p>
              <div className="space-y-3">
                <button
                  type="button"
                  onClick={() => { setMode('join'); setError(''); setMessage('') }}
                  className="w-full text-left border-2 border-black rounded-md p-4 hover:bg-gray-50"
                >
                  <div className="font-display text-lg">I was invited</div>
                  <div className="text-xs text-[#6B6E72] mt-1">
                    Customer or team: create your account with the email + one-time password your admin sent.
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => { setMode('login'); setError(''); setMessage('') }}
                  className="w-full text-left border-2 border-black rounded-md p-4 hover:bg-gray-50"
                >
                  <div className="font-display text-lg">Log in</div>
                  <div className="text-xs text-[#6B6E72] mt-1">
                    Already created an account before? Sign in here.
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => { setMode('signup'); setError(''); setMessage('') }}
                  className="w-full text-left border-2 border-black rounded-md p-4 hover:bg-gray-50"
                >
                  <div className="font-display text-lg">Start a new company</div>
                  <div className="text-xs text-[#6B6E72] mt-1">For company owners / admins only.</div>
                </button>
              </div>
            </>
          ) : (
            <>
              <button type="button" onClick={goChoose} className="text-sm text-[#6B6E72] mb-4 flex items-center gap-1">
                <ChevronLeft size={16} /> Back
              </button>
              <h2 className="font-display text-2xl text-black text-center mb-1">{title}</h2>
              <p className="text-sm text-[#6B6E72] text-center mb-6">{subtitle}</p>

              <form onSubmit={handleSubmit} className="space-y-4">
                {(mode === 'signup' || mode === 'join') && (
                  <div>
                    <label className="block text-[11px] font-mono uppercase text-[#6B6E72] mb-1">Your name</label>
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full border border-black rounded px-3 py-2.5 text-sm"
                      placeholder="e.g. Alex"
                    />
                  </div>
                )}
                {mode === 'signup' && (
                  <div>
                    <label className="block text-[11px] font-mono uppercase text-[#6B6E72] mb-1">Company name</label>
                    <input
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                      required
                      className="w-full border border-black rounded px-3 py-2.5 text-sm"
                      placeholder="e.g. your company name"
                    />
                  </div>
                )}
                <div>
                  <label className="block text-[11px] font-mono uppercase text-[#6B6E72] mb-1">Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="w-full border border-black rounded px-3 py-2.5 text-sm"
                    placeholder="you@email.com"
                  />
                </div>
                {mode !== 'reset' && (
                <div>
                  <label className="block text-[11px] font-mono uppercase text-[#6B6E72] mb-1">
                    {mode === 'join' ? 'One-time password from admin' : 'Password'}
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required={mode !== 'reset'}
                    className="w-full border border-black rounded px-3 py-2.5 text-sm"
                    placeholder="••••••••"
                  />
                </div>
                )}
                {error && (
                  <div className="flex items-start gap-1.5 text-[#B5533C] text-xs">
                    <AlertCircle size={13} className="flex-shrink-0 mt-0.5" /> {error}
                  </div>
                )}
                {message && <p className="text-xs text-[#3F7D58]">{message}</p>}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-2.5 rounded text-sm font-medium text-white bg-black disabled:opacity-50"
                >
                  {loading
                    ? 'Please wait…'
                    : mode === 'login'
                      ? 'Sign in'
                      : mode === 'reset'
                        ? 'Send reset link'
                        : mode === 'join'
                          ? 'Create my account'
                          : 'Create company'}
                </button>
                {mode === 'login' && (
                  <button
                    type="button"
                    onClick={() => { setMode('reset'); setError(''); setMessage(''); setPassword('') }}
                    className="w-full text-center text-xs text-[#6B6E72] underline py-1"
                  >
                    Forgot password
                  </button>
                )}
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
