export const TRIAL_DAYS = 14

export function companyAccess(company) {
  if (!company) return { ok: true, plan: 'unknown' }
  if (company.billing_exempt) return { ok: true, plan: 'free' }
  if ((company.plan || '') === 'paid') return { ok: true, plan: 'paid' }
  const raw = company.trial_ends_at
  if (!raw) return { ok: true, plan: 'legacy' }
  const end = new Date(raw)
  if (Number.isNaN(end.getTime())) return { ok: true, plan: 'legacy' }
  if (end.getTime() > Date.now()) return { ok: true, plan: 'trial', ends: end }
  return { ok: false, plan: 'expired', ends: end }
}

export function trialLabel(company) {
  const a = companyAccess(company)
  if (a.plan === 'free') return 'Complimentary'
  if (a.plan === 'paid') return 'Paid'
  if (a.plan === 'trial' && a.ends) {
    const days = Math.max(0, Math.ceil((a.ends.getTime() - Date.now()) / 86400000))
    return days + ' day' + (days === 1 ? '' : 's') + ' left on trial'
  }
  if (a.plan === 'expired') return 'Trial ended'
  return ''
}
