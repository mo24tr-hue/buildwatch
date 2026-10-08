import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

function fitScreen() {
  const h = window.visualViewport?.height || window.innerHeight
  const w = window.visualViewport?.width || window.innerWidth
  document.documentElement.style.setProperty('--app-h', Math.round(h) + 'px')
  document.documentElement.style.setProperty('--app-w', Math.round(w) + 'px')
}
fitScreen()
window.addEventListener('resize', fitScreen)
window.addEventListener('orientationchange', () => {
  fitScreen()
  setTimeout(fitScreen, 60)
  setTimeout(fitScreen, 250)
})
window.visualViewport?.addEventListener('resize', fitScreen)
window.visualViewport?.addEventListener('scroll', fitScreen)

const compiled = typeof __BW_BUILD__ !== 'undefined' ? String(__BW_BUILD__) : ''

async function hardReload(next) {
  const url = new URL(window.location.href)
  if (url.searchParams.get('v') === next) return
  try {
    if (window.caches) {
      const keys = await caches.keys()
      await Promise.all(keys.map((k) => caches.delete(k)))
    }
  } catch (_) {}
  url.searchParams.set('v', next)
  window.location.replace(url.toString())
}

async function checkBuild() {
  try {
    const res = await fetch('/version.json?t=' + Date.now(), { cache: 'no-store' })
    if (!res.ok) return
    const data = await res.json()
    const next = String(data.v || '')
    if (!next || next === 'bootstrap' || !compiled || next === compiled) return
    await hardReload(next)
  } catch (_) {}
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').then((reg) => {
    setInterval(() => { reg.update().catch(() => {}) }, 30000)
  }).catch(() => {})
}

setTimeout(checkBuild, 4000)
setInterval(checkBuild, 30000)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') checkBuild()
})
window.addEventListener('pageshow', () => checkBuild())
