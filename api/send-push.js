import webpush from 'web-push'

function json(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'POST only' })
  const secret = process.env.PUSH_WEBHOOK_SECRET
  if (secret && req.headers['x-push-secret'] !== secret) return json(res, 401, { error: 'Unauthorized' })

  const publicKey = process.env.VITE_VAPID_PUBLIC_KEY || process.env.VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT || 'mailto:buildwatchfeedback@gmail.com'
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!publicKey || !privateKey || !supabaseUrl || !serviceKey) {
    return json(res, 500, { error: 'Missing push or Supabase server keys' })
  }

  const record = req.body?.record || req.body?.notification || req.body || {}
  const userId = record.user_id
  if (!userId) return json(res, 200, { skipped: 'no user' })

  const body = record.body && String(record.body).includes('—')
    ? record.body
    : [record.title, record.body].filter(Boolean).join(' — ') || 'Update'

  webpush.setVapidDetails(subject, publicKey, privateKey)

  const url = supabaseUrl.replace(/\/$/, '') + '/rest/v1/push_subscriptions?user_id=eq.' + userId + '&select=endpoint,p256dh,auth'
  const listRes = await fetch(url, {
    headers: { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey },
  })
  const subs = await listRes.json()
  if (!Array.isArray(subs) || !subs.length) return json(res, 200, { sent: 0 })

  let sent = 0
  for (const row of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
        JSON.stringify({ title: 'BuildWatch', body })
      )
      sent += 1
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        await fetch(supabaseUrl.replace(/\/$/, '') + '/rest/v1/push_subscriptions?endpoint=eq.' + encodeURIComponent(row.endpoint), {
          method: 'DELETE',
          headers: { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey },
        })
      }
    }
  }
  return json(res, 200, { sent })
}
