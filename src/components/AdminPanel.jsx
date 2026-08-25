import { useEffect, useState } from 'react'
import { ChevronLeft } from 'lucide-react'
import { supabase } from '../lib/supabase'

export default function AdminPanel({ profile, company, onBack, onCompanyUpdate, digest = [], allProjects = [] }) {
  const [users, setUsers] = useState([])
  const [invites, setInvites] = useState([])
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState('team')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [companyName, setCompanyName] = useState(company?.name || '')
  const [appShareUrl, setAppShareUrl] = useState(company?.app_share_url || (typeof window !== 'undefined' ? window.location.origin : ''))
  const [logoPreview, setLogoPreview] = useState(company?.logo_url || null)
  const [headerColor, setHeaderColor] = useState(company?.header_color || '#000000')
  const [savingBrand, setSavingBrand] = useState(false)
  const [shareCopied, setShareCopied] = useState('')
  const [lastOtp, setLastOtp] = useState('')
  const [selectedUser, setSelectedUser] = useState(null)
  const [projects, setProjects] = useState([])
  const [assignBusy, setAssignBusy] = useState(false)
  const [calDate, setCalDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [calItems, setCalItems] = useState([])

  const load = async () => {
    const { data: members } = await supabase
      .from('profiles')
      .select('*')
      .eq('company_id', profile.company_id)
      .order('created_at')
    setUsers(members || [])
    const { data: inv } = await supabase
      .from('company_invites')
      .select('*')
      .eq('company_id', profile.company_id)
    setInvites(inv || [])
  }

  const loadProjects = async () => {
    const { data } = await supabase
      .from('projects')
      .select('id, address, style, start_date, end_date, status, phases(id, name, sort_order, status, start_date, end_date, phase_team(user_id)), project_customers(user_id)')
      .eq('company_id', profile.company_id)
      .order('created_at', { ascending: false })
    const normalized = (data || []).map((p) => ({
      ...p,
      phases: (p.phases || []).slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
    }))
    setProjects(normalized)
  }

  useEffect(() => {
    load()
    loadProjects()
    setCompanyName(company?.name || '')
    setAppShareUrl(company?.app_share_url || (typeof window !== 'undefined' ? window.location.origin : ''))
    setLogoPreview(company?.logo_url || null)
    setHeaderColor(company?.header_color || '#000000')
  }, [profile.company_id, company?.id, company?.header_color])

  useEffect(() => {
    const src = projects.length ? projects : allProjects
    const day = calDate
    const items = []
    src.forEach((pr) => {
      if (pr.start_date === day || pr.end_date === day) {
        items.push({ kind: 'project', label: pr.address, detail: pr.start_date === day && pr.end_date === day ? 'Start & end' : pr.start_date === day ? 'Project start' : 'Project end', status: pr.status })
      }
      ;(pr.phases || []).forEach((ph) => {
        if (ph.start_date === day || ph.end_date === day) {
          items.push({ kind: 'phase', label: pr.address + ' · ' + ph.name, detail: ph.start_date === day && ph.end_date === day ? 'Phase start & end' : ph.start_date === day ? 'Phase start' : 'Phase target end', status: ph.status })
        }
        // ongoing: start <= day <= end
        if (ph.start_date && ph.end_date && ph.start_date < day && ph.end_date > day && ph.status === 'active') {
          items.push({ kind: 'ongoing', label: pr.address + ' · ' + ph.name, detail: 'In progress', status: ph.status })
        }
      })
    })
    setCalItems(items)
  }, [calDate, projects, allProjects])

  const setUserRole = async (userId, newRole) => {
    const admins = users.filter((u) => u.role === 'admin')
    const target = users.find((u) => u.id === userId)
    if (target?.role === 'admin' && newRole !== 'admin' && admins.length <= 1) {
      if (!confirm('This is the last admin. Change their role anyway?')) return
    }
    await supabase.from('profiles').update({ role: newRole }).eq('id', userId)
    load()
    if (selectedUser?.id === userId) {
      setSelectedUser((u) => (u ? { ...u, role: newRole } : u))
    }
  }

  const removeUser = async (userId) => {
    const target = users.find((u) => u.id === userId)
    if (!target) return
    if (userId === profile.id) {
      alert('You cannot remove yourself.')
      return
    }
    const label = target.name || target.email
    if (!confirm('Remove ' + label + ' from this company?')) return
    const { error } = await supabase.rpc('admin_remove_user_from_company', {
      target_user_id: userId,
    })
    if (error) {
      alert(error.message)
      return
    }
    if (selectedUser?.id === userId) setSelectedUser(null)
    load()
  }

  const generateOtp = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    let s = ''
    for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)]
    return s
  }

  const inviteUser = async () => {
    setError('')
    setSuccess('')
    setLastOtp('')
    const clean = email.trim().toLowerCase()
    if (!clean.includes('@')) {
      setError('Enter a valid email.')
      return
    }
    const tempPassword = generateOtp()
    const { error: invErr } = await supabase.from('company_invites').upsert(
      {
        company_id: profile.company_id,
        email: clean,
        role,
        name: name.trim() || null,
        invited_by: profile.id,
        temp_password: tempPassword,
      },
      { onConflict: 'company_id,email' }
    )
    if (invErr) {
      setError(invErr.message)
      return
    }
    setLastOtp(tempPassword)
    setSuccess('Invite saved. Share the one-time password below with ' + clean)
    setEmail('')
    setName('')
    setRole('team')
    load()
  }

  const handleLogo = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const path = profile.company_id + '/logo-' + Date.now() + '.jpg'
    const { error: upErr } = await supabase.storage.from('project-photos').upload(path, file, { upsert: true })
    if (upErr) {
      alert(upErr.message)
      return
    }
    const { data: pub } = supabase.storage.from('project-photos').getPublicUrl(path)
    setLogoPreview(pub.publicUrl)
  }

  const saveBrand = async () => {
    setSavingBrand(true)
    setError('')
    const { error: err } = await supabase
      .from('companies')
      .update({
        name: companyName.trim() || company?.name,
        logo_url: logoPreview,
        app_share_url: (appShareUrl || '').trim() || null,
        header_color: headerColor || '#000000',
      })
      .eq('id', company.id)
    setSavingBrand(false)
    if (err) {
      setError(err.message)
      return
    }
    setSuccess('Company branding saved.')
    await onCompanyUpdate?.()
  }

  const toggleCustomerProject = async (projectId, userId, currentlyOn) => {
    setAssignBusy(true)
    if (currentlyOn) {
      await supabase.from('project_customers').delete().eq('project_id', projectId).eq('user_id', userId)
    } else {
      await supabase.from('project_customers').insert({ project_id: projectId, user_id: userId })
    }
    await loadProjects()
    setAssignBusy(false)
  }

  const togglePhaseTeam = async (phaseId, userId, currentlyOn) => {
    setAssignBusy(true)
    if (currentlyOn) {
      await supabase.from('phase_team').delete().eq('phase_id', phaseId).eq('user_id', userId)
    } else {
      await supabase.from('phase_team').insert({ phase_id: phaseId, user_id: userId })
    }
    await loadProjects()
    setAssignBusy(false)
  }

  const link = (appShareUrl || '').trim() || (typeof window !== 'undefined' ? window.location.origin : '')
  const message =
    'Hi — here\'s the project tracker for ' + (companyName || company?.name || 'our team') + '.\n\n' +
    'Open this link on your phone:\n' + link + '\n\n' +
    'Choose "I was invited" and create an account with the email and one-time password we sent you.'

  const copyText = async (text, label) => {
    try {
      await navigator.clipboard.writeText(text)
      setShareCopied(label)
      setTimeout(() => setShareCopied(''), 2000)
    } catch {
      prompt('Copy this:', text)
    }
  }

  // —— User assignment detail view ——
  if (selectedUser) {
    const u = selectedUser
    return (
      <div>
        <button
          onClick={() => setSelectedUser(null)}
          className="flex items-center gap-1 text-sm text-[#6B6E72] mb-4"
        >
          <ChevronLeft size={16} /> All users
        </button>
        <h2 className="font-display text-2xl mb-1">{u.name || u.email}</h2>
        <p className="text-sm text-[#6B6E72] mb-1">{u.email}</p>
        <p className="text-[11px] font-mono uppercase text-[#6B6E72] mb-6">Role: {u.role}</p>

        {u.role === 'customer' && (
          <div className="bg-white border border-black rounded-md p-4 mb-4">
            <h3 className="text-[11px] font-mono uppercase text-[#6B6E72] mb-2">Projects this customer can see</h3>
            {projects.length > 0 && (
              <div className="space-y-2">
                {projects.map((pr) => {
                  const on = (pr.project_customers || []).some((c) => c.user_id === u.id)
                  return (
                    <label key={pr.id} className="flex items-center gap-2 text-sm min-h-[40px] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={assignBusy}
                        onChange={() => toggleCustomerProject(pr.id, u.id, on)}
                      />
                      <span className="truncate">{pr.address}</span>
                    </label>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {u.role === 'team' && (
          <div className="bg-white border border-black rounded-md p-4 mb-4">
            <h3 className="text-[11px] font-mono uppercase text-[#6B6E72] mb-1">Phase assignments</h3>
            {projects.length > 0 && (
              <div className="space-y-4">
                {projects.map((pr) => (
                  <div key={pr.id} className="border border-[#E5E5E5] rounded p-3">
                    <div className="text-sm font-medium mb-2">{pr.address}</div>
                    {(pr.phases || []).length > 0 && (
                      <div className="space-y-1.5">
                        {(pr.phases || []).map((ph) => {
                          const on = (ph.phase_team || []).some((m) => m.user_id === u.id)
                          return (
                            <label key={ph.id} className="flex items-center gap-2 text-sm min-h-[36px] cursor-pointer">
                              <input
                                type="checkbox"
                                checked={on}
                                disabled={assignBusy}
                                onChange={() => togglePhaseTeam(ph.id, u.id, on)}
                              />
                              <span>{ph.name}</span>
                            </label>
                          )
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {u.role === 'admin' && (
          <p className="text-sm text-[#6B6E72]">Admins already have full access to all projects and phases.</p>
        )}
      </div>
    )
  }

  return (
    <div>
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-[#6B6E72] mb-4">
        <ChevronLeft size={16} /> Back to projects
      </button>
      <h2 className="font-display text-2xl mb-1">Admin</h2>
      <p className="text-sm text-[#6B6E72] mb-6">{company?.name}</p>

      <div className="bg-white border border-black rounded-md p-4 mb-5 space-y-3">
        <h3 className="text-[11px] font-mono uppercase text-[#6B6E72]">Your company name & logo</h3>
        <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} className="w-full border border-black rounded px-3 py-2 text-sm" placeholder="Company name" />
        <div className="flex items-center gap-3">
          {logoPreview && <img src={logoPreview} alt="" className="h-12 object-contain border border-black rounded" />}
          <label className="text-sm border border-black rounded px-3 py-2 cursor-pointer">
            Upload logo
            <input type="file" accept="image/*" className="hidden" onChange={handleLogo} />
          </label>
        </div>
        <div>
          <label className="block text-[11px] font-mono uppercase text-[#6B6E72] mb-1">Header color</label>
          <div className="flex items-center gap-3">
            <input type="color" value={headerColor || '#000000'} onChange={(e) => setHeaderColor(e.target.value)} className="h-10 w-14 border border-black rounded cursor-pointer" />
            <input value={headerColor || '#000000'} onChange={(e) => setHeaderColor(e.target.value)} className="flex-1 border border-black rounded px-3 py-2 text-sm font-mono" placeholder="#000000" />
          </div>
        </div>
        <input value={appShareUrl} onChange={(e) => setAppShareUrl(e.target.value)} className="w-full border border-black rounded px-3 py-2 text-sm" placeholder="https://your-app-url.com" />
        {error && <p className="text-xs text-[#B5533C]">{error}</p>}
        {success && <p className="text-xs text-[#3F7D58]">{success}</p>}
        <button onClick={saveBrand} disabled={savingBrand} className="w-full py-2 rounded text-sm text-white bg-black disabled:opacity-50">
          {savingBrand ? 'Saving…' : 'Save branding'}
        </button>
      </div>

      <div className="bg-white border border-black rounded-md p-4 mb-5 space-y-3">
        <h3 className="text-[11px] font-mono uppercase text-[#6B6E72]">Schedule calendar</h3>
        <input type="date" value={calDate} onChange={(e) => setCalDate(e.target.value)} className="w-full border border-black rounded px-3 py-2 text-sm" />
        {calItems.length === 0 ? (
          <p className="text-xs text-[#8A8D91]">Nothing scheduled for this day.</p>
        ) : (
          <div className="space-y-2">
            {calItems.map((it, i) => (
              <div key={i} className="text-sm border-b border-[#E5E5E5] pb-2">
                <div className="font-medium">{it.label}</div>
                <div className="text-xs text-[#6B6E72]">{it.detail}{it.status ? ' · ' + it.status : ''}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {(digest || []).length > 0 && (
        <div className="bg-white border border-black rounded-md p-4 mb-5">
          <h3 className="text-[11px] font-mono uppercase text-[#6B6E72] mb-2">This week</h3>
          <div className="space-y-2 max-h-56 overflow-auto">
            {digest.slice(0, 20).map((d) => (
              <div key={d.id} className="text-xs border-b border-[#E5E5E5] pb-1.5">
                <div className="font-medium">{d.action}</div>
                <div className="text-[#6B6E72]">{d.detail || d.user_name || d.user_email}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white border border-black rounded-md p-4 mb-5 space-y-3">
        <h3 className="text-[11px] font-mono uppercase text-[#6B6E72]">Send app link to customers</h3>
        <div className="text-xs bg-[#F5F5F5] border border-black rounded p-3 whitespace-pre-wrap">{message}</div>
        <button onClick={() => copyText(message, 'message')} className="w-full py-2.5 rounded text-sm text-white bg-black">
          {shareCopied === 'message' ? 'Copied message' : 'Copy invite message'}
        </button>
        <button onClick={() => copyText(link, 'link')} className="w-full py-2.5 rounded text-sm border border-black">
          {shareCopied === 'link' ? 'Copied link' : 'Copy link only'}
        </button>
      </div>

      <div className="bg-white border border-black rounded-md p-4 mb-5 space-y-3">
        <h3 className="text-[11px] font-mono uppercase text-[#6B6E72]">Invite user</h3>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@example.com" className="w-full border border-black rounded px-3 py-2 text-sm" />
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (optional)" className="w-full border border-black rounded px-3 py-2 text-sm" />
        <select value={role} onChange={(e) => setRole(e.target.value)} className="w-full border border-black rounded px-3 py-2 text-sm bg-white">
          <option value="team">Team</option>
          <option value="customer">Customer</option>
          <option value="admin">Admin</option>
        </select>
        <button onClick={inviteUser} className="w-full py-2 rounded text-sm text-white bg-black">Save invite</button>
      </div>

      {lastOtp && (
        <div className="bg-[#E1EDE4] border border-black rounded-md p-4 mb-5">
          <h3 className="text-[11px] font-mono uppercase text-[#3F7D58] mb-2">One-time password</h3>
          <p className="font-mono text-xl tracking-widest text-black mb-2">{lastOtp}</p>
          <button type="button" className="mt-2 text-sm underline" onClick={() => navigator.clipboard.writeText(lastOtp)}>
            Copy password
          </button>
        </div>
      )}

      {invites.length > 0 && (
        <div className="bg-white border border-black rounded-md p-4 mb-5">
          <h3 className="text-[11px] font-mono uppercase text-[#6B6E72] mb-3">Pending invites</h3>
          {invites.map((inv) => (
            <div key={inv.id || inv.email} className="text-sm py-2 border-b last:border-0">
              <span className="font-medium">{inv.email}</span>
              <span className="ml-2 text-[10px] font-mono uppercase px-1.5 py-0.5 bg-black text-white rounded">{inv.role}</span>
              {inv.temp_password && <div className="text-[11px] text-[#6B6E72] mt-1 font-mono">OTP: {inv.temp_password}</div>}
            </div>
          ))}
        </div>
      )}

      <div className="bg-white border border-black rounded-md p-4">
        <h3 className="text-[11px] font-mono uppercase text-[#6B6E72] mb-1">Users ({users.length})</h3>
        
      <div className="bg-white border border-black rounded-md p-4 mb-4">
        <h3 className="text-[11px] font-mono uppercase text-[#6B6E72] mb-2">Role checklist</h3>
        <div className="space-y-2">
          {users.map((u) => {
            const customerProjects = projects.filter((pr) => (pr.project_customers || []).some((c) => c.user_id === u.id))
            const teamPhases = projects.reduce((n, pr) => {
              return n + (pr.phases || []).filter((ph) => (ph.phase_team || []).some((m) => m.user_id === u.id)).length
            }, 0)
            return (
              <div key={u.id} className="text-xs border border-[#E5E5E5] rounded px-3 py-2 flex justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium truncate">{u.name || u.email}</div>
                  <div className="text-[#6B6E72] uppercase font-mono text-[10px]">{u.role}</div>
                </div>
                <div className="text-right text-[#6B6E72] flex-shrink-0">
                  {u.role === 'customer' && <div>{customerProjects.length} project{customerProjects.length !== 1 ? 's' : ''}</div>}
                  {u.role === 'team' && <div>{teamPhases} phase{teamPhases !== 1 ? 's' : ''}</div>}
                  {u.role === 'admin' && <div>All access</div>}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {users.map((u) => {
          let summary = ''
          if (u.role === 'customer') {
            const n = projects.filter((pr) => (pr.project_customers || []).some((c) => c.user_id === u.id)).length
            summary = n + ' project' + (n === 1 ? '' : 's')
          } else if (u.role === 'team') {
            let n = 0
            projects.forEach((pr) => (pr.phases || []).forEach((ph) => {
              if ((ph.phase_team || []).some((m) => m.user_id === u.id)) n++
            }))
            summary = n + ' phase' + (n === 1 ? '' : 's')
          } else {
            summary = 'Full access'
          }
          return (
          <div key={u.id} className="flex items-center justify-between gap-3 py-2 border-b last:border-0">
            <button type="button" className="min-w-0 text-left flex-1" onClick={() => setSelectedUser(u)}>
              <div className="text-sm font-medium truncate">{u.name || u.email}</div>
              <div className="text-[11px] text-[#6B6E72] truncate">{u.email}</div>
              <div className="text-[10px] text-[#6B6E72] mt-0.5">{summary}</div>
              <div className="text-[10px] text-black underline mt-0.5">Assign access →</div>
            </button>
            <div className="flex items-center gap-2 flex-shrink-0">
              <select value={u.role} onChange={(e) => setUserRole(u.id, e.target.value)} className="text-[11px] border border-black rounded px-2 py-1 bg-white">
                <option value="admin">Admin</option>
                <option value="team">Team</option>
                <option value="customer">Customer</option>
              </select>
              {u.id !== profile.id && (
                <button type="button" onClick={() => removeUser(u.id)} className="text-[10px] text-[#B5533C] underline">
                  Remove
                </button>
              )}
            </div>
          </div>
        )})}
      </div>
    </div>
  )
}
