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
const APPLIED = 'bw_applied_build'
const standalone =
  (typeof window !== 'undefined' &&
    (window.navigator.standalone === true ||
      window.matchMedia('(display-mode: standalone)').matches))

async function hardReload(next) {
  if (sessionStorage.getItem('bw_reloading') === '1') return
  sessionStorage.setItem('bw_reloading', '1')
  localStorage.setItem(APPLIED, next)
  if (standalone) {
    window.location.reload()
    return
  }
  try {
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
    if (!next || next === 'bootstrap') return
    if (compiled && next === compiled) {
      localStorage.setItem(APPLIED, next)
      return
    }
    const applied = localStorage.getItem(APPLIED)
    if (applied === next && compiled && compiled !== next) {
      // last reload did not pick up new JS; try once more after a short wait
    }
    if (compiled && next !== compiled) {
      await hardReload(next)
      return
    }
    if (!compiled && applied && applied !== next) {
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
  navigator.serviceWorker.register('/sw.js').then((reg) => {
    const kick = () => { if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' }) }
    kick()
    reg.addEventListener('updatefound', () => {
      const w = reg.installing
      if (!w) return
      w.addEventListener('statechange', () => { if (w.state === 'installed') kick() })
    })
    setInterval(() => { reg.update().catch(() => {}) }, 20 * 1000)
  }).catch(() => {})
}

checkBuild()
setInterval(checkBuild, 15 * 1000)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') checkBuild()
})
window.addEventListener('focus', checkBuild)
window.addEventListener('pageshow', () => checkBuild())
