import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function SetupCompany({ user, profile, onDone }) {
  const [name, setName] = useState(() => sessionStorage.getItem('pending_company_name') || '')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [checkingInvite, setCheckingInvite] = useState(true)
  const [inviteMsg, setInviteMsg] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const email = (user.email || '').toLowerCase()
      const { data: inv } = await supabase
        .from('company_invites')
        .select('*')
        .eq('email', email)
        .maybeSingle()

      if (cancelled) return

      if (inv?.company_id) {
        setInviteMsg('Joining as ' + (inv.role || 'team') + '…')
        const { error: pErr } = await supabase
          .from('profiles')
          .update({
            company_id: inv.company_id,
            role: inv.role || 'team',
            name: inv.name || profile?.name || user.user_metadata?.name || email.split('@')[0],
            email: user.email,
          })
          .eq('id', user.id)

        if (!pErr) {
          await supabase.from('company_invites').delete().eq('company_id', inv.company_id).eq('email', email)
          sessionStorage.removeItem('pending_company_name')
          await onDone?.()
          return
        }
        setError(pErr.message)
      }
      setCheckingInvite(false)
    })()
    return () => { cancelled = true }
  }, [user.id])

  const handleCreate = async (e) => {
    e.preventDefault()
    setError('')
    const companyName = name.trim()
    if (!companyName) {
      setError('Enter your company name.')
      return
    }
    setLoading(true)
    try {
      const { data: company, error: cErr } = await supabase
        .from('companies')
        .insert({ name: companyName })
        .select()
        .single()
      if (cErr) throw cErr

      const { error: pErr } = await supabase
        .from('profiles')
        .update({
          company_id: company.id,
          role: 'admin',
          name: profile?.name || user.user_metadata?.name || user.email?.split('@')[0],
          email: user.email,
        })
        .eq('id', user.id)
      if (pErr) throw pErr

      sessionStorage.removeItem('pending_company_name')
      await onDone?.()
    } catch (err) {
      setError(err.message || 'Could not create company.')
    }
    setLoading(false)
  }

  if (checkingInvite) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-[#6B6E72]">
        {inviteMsg || 'Checking invites…'}
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <div className="bg-black text-white px-5 pb-6" style={{ paddingTop: "max(1.5rem, env(safe-area-inset-top))" }}>
        <div className="max-w-md mx-auto text-center">
          <h1 className="font-display text-xl tracking-wide">Set up your company</h1>
        </div>
      </div>
      <div className="flex-1 flex items-center justify-center px-4 py-10">
        <form onSubmit={handleCreate} className="w-full max-w-sm space-y-4">
          <p className="text-sm text-[#6B6E72] text-center mb-2">
            No invite found for your email. Creating a company makes you the contractor of a <strong>new</strong> workspace.
            If you were invited, sign out and sign up again with the exact invited email and the one-time password from your contractor.
          </p>
          <div>
            <label className="block text-[11px] font-mono uppercase text-[#6B6E72] mb-1">Company name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. your company name"
              className="w-full border border-black rounded px-3 py-2.5 text-sm"
              autoFocus
            />
          </div>
          {error && <p className="text-xs text-[#B5533C]">{error}</p>}
          <button type="submit" disabled={loading} className="w-full py-2.5 rounded text-sm font-medium text-white bg-black disabled:opacity-50">
            {loading ? 'Creating…' : 'Create company workspace'}
          </button>
          <button type="button" onClick={() => supabase.auth.signOut()} className="w-full text-xs text-[#6B6E72] underline">
            Sign out
          </button>
        </form>
      </div>
    </div>
  )
}
