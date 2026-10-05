import { useEffect, useRef } from 'react'

const stack = []
let bound = false

function topLayer() {
  for (let i = stack.length - 1; i >= 0; i--) {
    const rec = stack[i]
    if (!rec.disabled && rec.onBack.current) return rec
  }
  return null
}

function paint(node, x, animate) {
  if (!node) return
  node.style.transition = animate ? 'transform 160ms ease-out' : 'none'
  node.style.transform = x ? `translate3d(${Math.max(0, x)}px,0,0)` : ''
}

function bind() {
  if (bound || typeof window === 'undefined') return
  bound = true
  let active = null

  const start = (e) => {
    if (!e.touches || e.touches.length !== 1) return
    const rec = topLayer()
    if (!rec || !rec.el.current) return
    const node = rec.el.current
    if (!(node === e.target || node.contains(e.target))) return
    if (e.target.closest && e.target.closest('input, textarea, select, [data-no-swipe], [data-swipe-delete]')) return
    const t = e.touches[0]
    active = {
      rec,
      x: t.clientX,
      y: t.clientY,
      t: performance.now(),
      fromEdge: t.clientX <= 36,
      lock: null,
    }
    paint(node, 0, false)
  }

  const move = (e) => {
    if (!active || !e.touches) return
    const rec = topLayer()
    if (!rec || rec !== active.rec) {
      active = null
      return
    }
    const t = e.touches[0]
    const rawX = t.clientX - active.x
    const rawY = t.clientY - active.y
    if (!active.lock) {
      if (Math.abs(rawX) < 8 && Math.abs(rawY) < 8) return
      active.lock = rawX > 8 && rawX > Math.abs(rawY) * 0.65 ? 'h' : 'v'
    }
    if (active.lock !== 'h' || rawX <= 0) return
    if (e.cancelable) e.preventDefault()
    paint(rec.el.current, rawX, false)
  }

  const end = (e) => {
    if (!active) return
    const rec = active.rec
    const t = e.changedTouches?.[0]
    const rawX = t ? t.clientX - active.x : 0
    const dt = Math.max(16, performance.now() - active.t)
    const horizontal = active.lock === 'h'
    const fromEdge = active.fromEdge
    active = null
    const go = horizontal && rawX > 0 && (rawX > 64 || (fromEdge && rawX > 28) || rawX / dt > 0.45)
    if (!go) {
      paint(rec.el.current, 0, true)
      return
    }
    paint(rec.el.current, window.innerWidth, true)
    rec.onBack.current?.()
    setTimeout(() => paint(rec.el.current, 0, false), 180)
  }

  const cancel = () => {
    if (!active) return
    paint(active.rec.el.current, 0, true)
    active = null
  }

  window.addEventListener('touchstart', start, { capture: true, passive: true })
  window.addEventListener('touchmove', move, { capture: true, passive: false })
  window.addEventListener('touchend', end, { capture: true, passive: true })
  window.addEventListener('touchcancel', cancel, { capture: true, passive: true })
}

export default function SwipeBack({ onBack, children, className = '', disabled = false, fromAnywhere = true }) {
  const el = useRef(null)
  const onBackRef = useRef(onBack)
  onBackRef.current = onBack

  useEffect(() => {
    bind()
    const rec = { el, onBack: onBackRef, disabled, fromAnywhere }
    stack.push(rec)
    return () => {
      const i = stack.indexOf(rec)
      if (i >= 0) stack.splice(i, 1)
      if (el.current) el.current.style.transform = ''
    }
  }, [disabled, fromAnywhere])

  return (
    <div ref={el} className={className} style={{ touchAction: 'pan-y', minHeight: '100%', width: '100%' }}>
      {children}
    </div>
  )
}
