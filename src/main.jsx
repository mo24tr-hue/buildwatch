import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

const compiled = typeof __BW_BUILD__ !== 'undefined' ? String(__BW_BUILD__) : ''

async function hardReload(next) {
  const lock = 'bw_hard_reload_' + (next || '')
  if (sessionStorage.getItem(lock) === '1') return
  sessionStorage.setItem(lock, '1')
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations()
      await Promise.all(regs.map((r) => r.unregister()))
    }
    if (window.caches) {
      const keys = await caches.keys()
      await Promise.all(keys.map((k) => caches.delete(k)))
    }
  } catch (_) {}
  const url = new URL(window.location.href)
  url.searchParams.set('bwv', next || String(Date.now()))
  window.location.replace(url.toString())
}

async function checkBuild() {
  try {
    const res = await fetch('/version.json?t=' + Date.now(), {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
    })
    if (!res.ok) return
    const data = await res.json()
    const next = String(data.v || '')
    if (!next) return
    if (compiled && next !== compiled) {
      await hardReload(next)
    }
  } catch (_) {}
}

if ('serviceWorker' in navigator) {
  let reloading = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return
    reloading = true
    window.location.reload()
  })
  const attach = (reg) => {
    const kick = () => { if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' }) }
    kick()
    reg.addEventListener('updatefound', () => {
      const w = reg.installing
      if (!w) return
      w.addEventListener('statechange', () => { if (w.state === 'installed') kick() })
    })
    setInterval(() => { reg.update().catch(() => {}) }, 15 * 1000)
  }
  navigator.serviceWorker.register('/sw.js').then(attach).catch(() => {})
}

checkBuild()
setInterval(checkBuild, 10 * 1000)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') checkBuild()
})
window.addEventListener('focus', checkBuild)
window.addEventListener('pageshow', (e) => {
  if (e.persisted) checkBuild()
  else checkBuild()
})
