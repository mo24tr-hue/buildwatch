/* PWA service worker — never cache the HTML shell. Photos live in their own cache. */
const CACHE = 'BuildWatch-v12'
const PHOTO_CACHE = 'BuildWatch-photos-v1'

self.addEventListener('install', (event) => {
  self.skipWaiting()
  event.waitUntil(caches.open(CACHE).catch(() => {}))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE && k !== PHOTO_CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  )
})

async function photoResponse(req) {
  const cache = await caches.open(PHOTO_CACHE)
  const cached = await cache.match(req)
  const update = fetch(req)
    .then((res) => {
      if (res && res.ok) cache.put(req, res.clone()).catch(() => {})
      return res
    })
    .catch(() => cached || null)
  if (cached) {
    update.catch(() => {})
    return cached
  }
  const fresh = await update
  if (fresh) return fresh
  return new Response('', { status: 504, statusText: 'Offline' })
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)
  if (url.hostname.includes('supabase') && url.pathname.includes('/storage/')) {
    event.respondWith(photoResponse(req))
    return
  }
  if (url.hostname.includes('supabase') || url.pathname.startsWith('/auth')) return
  if (url.pathname.endsWith('/version.json') || url.pathname.endsWith('/sw.js')) return
  if (req.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('.html')) return

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok && url.origin === self.location.origin && url.pathname.startsWith('/assets/')) {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {})
        }
        return res
      })
      .catch(async () => {
        const cached = await caches.match(req)
        if (cached) return cached
        return new Response('', { status: 504, statusText: 'Gateway Timeout' })
      })
  )
})

self.addEventListener('push', (event) => {
  let data = { title: 'BuildWatch', body: 'New update' }
  try {
    if (event.data) data = { ...data, ...event.data.json() }
  } catch (_) {}
  event.waitUntil(
    self.registration.showNotification(data.title || 'BuildWatch', {
      body: data.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: data,
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const data = event.notification.data || {}
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.postMessage({ type: 'notification-click', data })
          return client.focus()
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow('/')
    })
  )
})

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'CACHE_PHOTOS') {
    const urls = event.data.urls || []
    event.waitUntil((async () => {
      const cache = await caches.open(PHOTO_CACHE)
      for (const url of urls) {
        if (!url || /\.(mp4|mov|webm)(\?|$)/i.test(url)) continue
        const hit = await cache.match(url)
        if (hit) continue
        try {
          const res = await fetch(url)
          if (res && res.ok) await cache.put(url, res)
        } catch (_) {}
      }
    })())
    return
  }
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting()
    return
  }
  if (event.data && event.data.type === 'show-notification') {
    const { title, body, data } = event.data
    event.waitUntil(
      self.registration.showNotification(title || 'BuildWatch', {
        body: body || '',
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        data: data || {},
      })
    )
  }
})
