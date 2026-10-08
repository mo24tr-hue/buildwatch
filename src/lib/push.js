import { supabase } from './supabase'

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

export async function enablePush(profile) {
  if (!profile?.id) return { ok: false, reason: 'Sign in first' }
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || typeof Notification === 'undefined') {
    return { ok: false, reason: 'This phone cannot take closed-app alerts' }
  }
  const standalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches
  if (!standalone) return { ok: false, reason: 'Add BuildWatch to the Home Screen, then open it from the icon' }
  const key = import.meta.env.VITE_VAPID_PUBLIC_KEY
  if (!key) return { ok: false, reason: 'Push key is not set on the server yet' }
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return { ok: false, reason: 'Notifications are blocked' }
  const reg = await navigator.serviceWorker.ready
  const existing = await reg.pushManager.getSubscription()
  const sub = existing || await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(key),
  })
  const json = sub.toJSON()
  const { error } = await supabase.from('push_subscriptions').upsert({
    user_id: profile.id,
    company_id: profile.company_id || null,
    endpoint: json.endpoint,
    p256dh: json.keys?.p256dh || null,
    auth: json.keys?.auth || null,
  }, { onConflict: 'endpoint' })
  if (error) return { ok: false, reason: error.message }
  return { ok: true }
}
