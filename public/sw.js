/* PWA service worker — never cache the HTML shell */
const CACHE = 'BuildWatch-v10'

self.addEventListener('install', (event) => {
  self.skipWaiting()
  event.waitUntil(caches.open(CACHE).catch(() => {}))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)
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
