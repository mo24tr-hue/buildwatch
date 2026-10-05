import { useEffect, useRef } from 'react'

export default function SwipeBack({ onBack, children, className = '', disabled = false, fromAnywhere = true }) {
  const el = useRef(null)
  const start = useRef(null)
  const dx = useRef(0)
  const lock = useRef(null)
  const onBackRef = useRef(onBack)
  onBackRef.current = onBack

  const paint = (x, animate) => {
    const node = el.current
    if (!node) return
    node.style.transition = animate ? 'transform 180ms cubic-bezier(.2,.8,.2,1)' : 'none'
    node.style.transform = x ? `translate3d(${x}px,0,0)` : ''
  }

  useEffect(() => {
    const node = el.current
    if (!node) return

    const startTouch = (e) => {
      if (disabled || !onBackRef.current) return
      const target = e.target
      if (target && target.closest && target.closest('input, textarea, select, [data-no-swipe]')) return
      const t = e.touches[0]
      const fromEdge = t.clientX <= 36
      if (!fromEdge && !fromAnywhere) return
      start.current = { x: t.clientX, y: t.clientY, t: performance.now(), fromEdge }
      dx.current = 0
      lock.current = null
      paint(0, false)
    }

    const move = (e) => {
      if (!start.current) return
      const t = e.touches[0]
      const rawX = t.clientX - start.current.x
      const rawY = t.clientY - start.current.y
      if (!lock.current) {
        if (Math.abs(rawX) < 8 && Math.abs(rawY) < 8) return
        lock.current = Math.abs(rawX) > Math.abs(rawY) ? 'h' : 'v'
      }
      if (lock.current === 'v' || rawX <= 0) {
        if (lock.current === 'v') start.current = null
        return
      }
      if (e.cancelable) e.preventDefault()
      dx.current = rawX
      paint(rawX, false)
    }

    const end = (e) => {
      if (!start.current) return
      const t = e.changedTouches[0]
      const rawX = t.clientX - start.current.x
      const dt = Math.max(16, performance.now() - start.current.t)
      const fromEdge = start.current.fromEdge
      const vx = rawX / dt
      start.current = null
      const go = lock.current === 'h' && rawX > 0 && (rawX > 64 || (fromEdge && rawX > 28) || vx > 0.45)
      lock.current = null
      if (!go) {
        paint(0, true)
        return
      }
      if (typeof window !== 'undefined' && window.__bwDirty) {
        paint(0, true)
        if (!window.confirm('Leave without saving?')) return
        window.__bwDirty = false
      }
      paint(window.innerWidth, true)
      onBackRef.current?.()
    }

    node.addEventListener('touchstart', startTouch, { passive: true })
    node.addEventListener('touchmove', move, { passive: false })
    node.addEventListener('touchend', end, { passive: true })
    node.addEventListener('touchcancel', () => { start.current = null; lock.current = null; paint(0, true) }, { passive: true })
    return () => {
      node.removeEventListener('touchstart', startTouch)
      node.removeEventListener('touchmove', move)
      node.removeEventListener('touchend', end)
    }
  }, [disabled, fromAnywhere])

  return (
    <div ref={el} className={className} style={{ touchAction: 'pan-y', willChange: 'transform' }}>
      {children}
    </div>
  )
}
