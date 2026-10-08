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
const APPLIED = 'bw_applied_build'

async function hardReload(next) {
  const url = new URL(window.location.href)
  if (url.searchParams.get('v') === next) return
  try { localStorage.setItem(APPLIED, next) } catch (_) {}
  url.searchParams.set('v', next)
  window.location.replace(url.toString())
}

async function checkBuild() {
  try {
    const res = await fetch('/version.json?t=' + Date.now(), { cache: 'no-store' })
    if (!res.ok) return
    const data = await res.json()
    const next = String(data.v || '')
    if (!next || next === 'bootstrap') return
    if (!compiled || next === compiled) {
      try { localStorage.setItem(APPLIED, next) } catch (_) {}
      return
    }
    const applied = localStorage.getItem(APPLIED)
    if (applied === next) return
    await hardReload(next)
  } catch (_) {}
}

if ('serviceWorker' in navigator) {
  let ready = false
  setTimeout(() => { ready = true }, 4000)
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!ready) return
    const applied = localStorage.getItem(APPLIED)
    if (applied && applied === compiled) return
    window.location.reload()
  })
  navigator.serviceWorker.register('/sw.js').catch(() => {})
}

setTimeout(checkBuild, 2500)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') checkBuild()
})
