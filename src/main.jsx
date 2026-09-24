import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

const BUILD_KEY = 'bw_build_id'

async function hardReload() {
  if (sessionStorage.getItem('bw_hard_reload') === '1') return
  sessionStorage.setItem('bw_hard_reload', '1')
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
  window.location.reload()
}

async function checkBuild() {
  try {
    const res = await fetch('/version.json?t=' + Date.now(), { cache: 'no-store' })
    if (!res.ok) return
    const data = await res.json()
    const next = String(data.v || '')
    if (!next) return
    const prev = localStorage.getItem(BUILD_KEY)
    if (!prev) {
      localStorage.setItem(BUILD_KEY, next)
      return
    }
    if (prev !== next) {
      localStorage.setItem(BUILD_KEY, next)
      await hardReload()
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
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      const kick = () => { if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' }) }
      kick()
      reg.addEventListener('updatefound', () => {
        const w = reg.installing
        if (!w) return
        w.addEventListener('statechange', () => { if (w.state === 'installed') kick() })
      })
      setInterval(() => { reg.update().catch(() => {}) }, 30 * 1000)
    }).catch(() => {})
  })
}

checkBuild()
setInterval(checkBuild, 20 * 1000)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') checkBuild()
})
window.addEventListener('focus', checkBuild)
