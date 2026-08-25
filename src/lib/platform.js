/** Platform (app-owner) super-admins — not company contractors */
export const FEEDBACK_EMAIL = 'buildwatchfeedback@gmail.com'

/** Add your login email(s) here so the Platform panel appears for you */
export const PLATFORM_ADMIN_EMAILS = [
  'buildwatchfeedback@gmail.com',
]

export function isPlatformAdmin(emailOrProfile) {
  const email = (
    typeof emailOrProfile === 'string'
      ? emailOrProfile
      : emailOrProfile?.email || ''
  )
    .trim()
    .toLowerCase()
  if (!email) {
    if (emailOrProfile && typeof emailOrProfile === 'object' && emailOrProfile.is_platform_admin) {
      return true
    }
    return false
  }
  if (PLATFORM_ADMIN_EMAILS.map((e) => e.toLowerCase()).includes(email)) return true
  if (emailOrProfile && typeof emailOrProfile === 'object' && emailOrProfile.is_platform_admin) {
    return true
  }
  return false
}

export function feedbackMailto({ subject, body, fromEmail }) {
  const s = encodeURIComponent(subject || 'BuildWatch feedback')
  const lines = []
  if (fromEmail) lines.push('From: ' + fromEmail)
  if (body) lines.push('', body)
  const b = encodeURIComponent(lines.join('\n'))
  return `mailto:${FEEDBACK_EMAIL}?subject=${s}&body=${b}`
}
