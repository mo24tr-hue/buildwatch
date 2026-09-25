import { useRef } from 'react'

export default function SwipeBack({ onBack, children, className = '', disabled = false, fromAnywhere = true }) {
  const start = useRef(null)
  const EDGE = 48
  const onTouchStart = (e) => {
    if (disabled || !onBack) return
    const el = e.target
    if (el && el.closest && el.closest('input, textarea, select, [data-no-swipe]')) return
    const t = e.touches[0]
    const fromEdge = t.clientX <= EDGE
    if (!fromEdge && !fromAnywhere) {
      start.current = null
      return
    }
    start.current = { x: t.clientX, y: t.clientY, t: Date.now(), fromEdge }
  }
  const onTouchMove = (e) => {
    if (!start.current) return
    const t = e.touches[0]
    const dx = t.clientX - start.current.x
    const dy = t.clientY - start.current.y
    if (Math.abs(dy) > 18 && Math.abs(dy) > Math.abs(dx)) {
      start.current = null
    }
  }
  const onTouchEnd = (e) => {
    if (disabled || !start.current || !onBack) return
    const t = e.changedTouches[0]
    const dx = t.clientX - start.current.x
    const dy = t.clientY - start.current.y
    const dt = Date.now() - (start.current.t || Date.now())
    const fromEdge = start.current.fromEdge
    start.current = null
    if (dx <= 0) return
    if (Math.abs(dy) >= dx * 0.75) return
    const ok = fromEdge
      ? dx > 40 || (dt < 300 && dx > 28)
      : dx > 72 || (dt < 280 && dx > 56)
    if (!ok) return
    if (typeof window !== 'undefined' && window.__bwDirty) {
      if (!window.confirm('Leave without saving?')) return
      window.__bwDirty = false
    }
    onBack()
  }
  return (
    <div
      className={className}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={() => { start.current = null }}
    >
      {children}
    </div>
  )
}
