import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'

const field = 'w-full border border-black rounded px-3 py-2 text-sm bg-white'

function keyFor(projectId, url, page) {
  return 'bw_plan_' + projectId + '_' + page + '_' + url
}

function formatDim(feet) {
  if (feet == null || !Number.isFinite(feet)) return ''
  const totalEighths = Math.round(feet * 12 * 8)
  const sign = totalEighths < 0 ? '-' : ''
  const abs = Math.abs(totalEighths)
  const ft = Math.floor(abs / (12 * 8))
  let inches = Math.floor((abs % (12 * 8)) / 8)
  let eighths = abs % 8
  if (eighths === 8) {
    inches += 1
    eighths = 0
  }
  const frac = eighths === 0 ? '' : eighths === 2 ? ' 1/4' : eighths === 4 ? ' 1/2' : eighths === 6 ? ' 3/4' : ' ' + eighths + '/8'
  return sign + ft + "'-" + inches + frac + '"'
}

function lockAxis(start, p) {
  const dx = Math.abs(p.x - start.x)
  const dy = Math.abs(p.y - start.y)
  if (dx >= dy) return { x2: p.x, y2: start.y }
  return { x2: start.x, y2: p.y }
}

function measureFeet(line, sheet, scale) {
  const dxIn = ((line.x2 - line.x) / 100) * sheet.w
  const dyIn = ((line.y2 - line.y) / 100) * sheet.h
  const paperInches = Math.hypot(dxIn, dyIn)
  if (!scale?.inchesPerFoot || paperInches < 0.01) return null
  return paperInches / scale.inchesPerFoot
}
function parseFeet(raw) {
  const s = String(raw || '')
  const m = s.match(/(\d+)\s*'\s*-?\s*(\d+)?(?:\s*(\d+)\s*\/\s*(\d+))?\s*"?/)
  if (!m) return null
  const feet = Number(m[1]) || 0
  const inches = Number(m[2]) || 0
  const frac = m[3] && m[4] ? Number(m[3]) / Number(m[4]) : 0
  return Math.round((feet + (inches + frac) / 12) * 100) / 100
}

const SCALES = [
  { id: '1/8', label: '1/8" = 1\'', inchesPerFoot: 1 / 8 },
  { id: '3/16', label: '3/16" = 1\'', inchesPerFoot: 3 / 16 },
  { id: '1/4', label: '1/4" = 1\'', inchesPerFoot: 1 / 4 },
  { id: '3/8', label: '3/8" = 1\'', inchesPerFoot: 3 / 8 },
  { id: '1/2', label: '1/2" = 1\'', inchesPerFoot: 1 / 2 },
  { id: '1', label: '1" = 1\'', inchesPerFoot: 1 },
]

const SHEETS = [
  { id: 'ARCH-D', label: 'Arch D 24×36', w: 36, h: 24 },
  { id: 'ARCH-C', label: 'Arch C 18×24', w: 24, h: 18 },
  { id: 'ARCH-B', label: 'Arch B 12×18', w: 18, h: 12 },
  { id: 'ARCH-E', label: 'Arch E 36×48', w: 48, h: 36 },
  { id: 'ARCH-E1', label: 'Arch E1 30×42', w: 42, h: 30 },
  { id: 'ANSI-B', label: 'Tabloid 11×17', w: 17, h: 11 },
  { id: 'LETTER', label: 'Letter 8.5×11', w: 11, h: 8.5 },
]

function nearestSheet(w, h) {
  if (!w || !h) return SHEETS[0]
  const a = Math.max(w, h)
  const b = Math.min(w, h)
  let best = SHEETS[0]
  let bestScore = Infinity
  for (const s of SHEETS) {
    const sw = Math.max(s.w, s.h)
    const sh = Math.min(s.w, s.h)
    const score = Math.abs(a - sw) / sw + Math.abs(b - sh) / sh
    if (score < bestScore) {
      best = s
      bestScore = score
    }
  }
  return bestScore < 0.12 ? best : SHEETS[0]
}

const PX_PER_INCH = 42

export default function PlanEditor({ project, profile, isAdmin, onBack }) {
  const files = [
    ...(project.project_files || []),
    ...(project.phases || []).flatMap((ph) => (ph.phase_files || []).map((f) => ({ ...f, phase_name: ph.name }))),
  ].filter((f) => f.public_url)
  const [fileUrl, setFileUrl] = useState(files[0]?.public_url || '')
  const [page, setPage] = useState(1)
  const [pageCount, setPageCount] = useState(1)
  const [img, setImg] = useState('')
  const [zoom, setZoom] = useState(1)
  const [tool, setTool] = useState('pan')
  const [toolsOpen, setToolsOpen] = useState(false)
  const [items, setItems] = useState([])
  const [scale, setScale] = useState(null)
  const [text, setText] = useState('')
  const [sheetScale, setSheetScale] = useState('1/8')
  const [sheetSize, setSheetSize] = useState('ARCH-D')
  const [sheetText, setSheetText] = useState([])
  const pageIn = useRef(null)
  const pinch = useRef(null)
  const scroller = useRef(null)
  const drag = useRef(null)
  const view = useRef(null)
  const content = useRef(null)
  const zoomRef = useRef(1)
  const lastTouch = useRef(0)
  const [draft, setDraft] = useState(null)
  const eraseAt = (p, list) => list.filter((it) => {
    if (it.points) return !it.points.some((pt) => Math.hypot(pt.x - p.x, pt.y - p.y) < 1.4)
    const pts = [{ x: it.x, y: it.y }]
    if (it.x2 != null) pts.push({ x: it.x2, y: it.y2 })
    return !pts.some((pt) => Math.hypot(pt.x - p.x, pt.y - p.y) < 1.4)
  })
  const [measureStep, setMeasureStep] = useState(0)

  const file = files.find((f) => f.public_url === fileUrl)
  const isPdf = /\.pdf(\?|$)/i.test(fileUrl) || (file?.file_name || '').toLowerCase().endsWith('.pdf')

  useEffect(() => {
    let dead = false
    async function loadPage() {
      if (!fileUrl) return
      if (!isPdf) {
        setImg(fileUrl)
        setPageCount(1)
        return
      }
      setImg('')
      const pdfjs = await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs')
      pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs'
      const doc = await pdfjs.getDocument(fileUrl).promise
      if (dead) return
      setPageCount(doc.numPages)
      const pg = await doc.getPage(Math.min(page, doc.numPages))
      const base = pg.getViewport({ scale: 1 })
      pageIn.current = { w: 36, h: 24 }
      if (!dead) setSheetSize('ARCH-D')
      const content = await pg.getTextContent()
      const found = []
      for (const item of content.items || []) {
        const feet = parseFeet(item.str)
        if (feet == null || feet <= 0 || feet > 500) continue
        const x = ((item.transform?.[4] || 0) / base.width) * 100
        const y = (1 - (item.transform?.[5] || 0) / base.height) * 100
        found.push({ x, y, feet, text: item.str })
      }
      if (!dead) setSheetText(found)
      const viewport = pg.getViewport({ scale: 2.4 })
      const canvas = document.createElement('canvas')
      canvas.width = viewport.width
      canvas.height = viewport.height
      await pg.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
      if (!dead) setImg(canvas.toDataURL('image/jpeg', 0.85))
    }
    loadPage().catch(() => setImg(''))
    return () => { dead = true }
  }, [fileUrl, page, isPdf])

  useEffect(() => {
    let dead = false
    async function loadMarks() {
      const local = localStorage.getItem(keyFor(project.id, fileUrl, page))
      if (local) {
        try {
          const parsed = JSON.parse(local)
          if (!dead) {
            setItems(parsed.items || [])
            setScale(parsed.scale || null)
          }
        } catch (_) {}
      } else if (!dead) {
        setItems([])
        setScale(null)
      }
      const { data, error } = await supabase
        .from('plan_markups')
        .select('data')
        .eq('project_id', project.id)
        .eq('file_url', fileUrl)
        .eq('page', page)
        .maybeSingle()
      if (!dead && !error && data?.data) {
        setItems(data.data.items || [])
        setScale(data.data.scale || null)
      }
    }
    if (fileUrl) loadMarks()
    return () => { dead = true }
  }, [fileUrl, page, project.id])

  const save = async (nextItems, nextScale) => {
    const data = { items: nextItems, scale: nextScale }
    setItems(nextItems)
    setScale(nextScale)
    try { localStorage.setItem(keyFor(project.id, fileUrl, page), JSON.stringify(data)) } catch (_) {}
    await supabase.from('plan_markups').upsert({
      company_id: profile.company_id,
      project_id: project.id,
      file_url: fileUrl,
      page,
      data,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'project_id,file_url,page' }).then(() => {}, () => {})
  }

  const point = (e) => {
    const box = view.current?.getBoundingClientRect()
    if (!box) return null
    const src = e.touches ? e.touches[0] : e
    const lift = e.touches ? 36 : 0
    const x = src.clientX
    const y = src.clientY - lift
    return {
      x: Math.min(100, Math.max(0, ((x - box.left) / box.width) * 100)),
      y: Math.min(100, Math.max(0, ((y - box.top) / box.height) * 100)),
      fx: src.clientX,
      fy: src.clientY,
    }
  }

  const down = (e) => {
    if (e.touches) lastTouch.current = Date.now()
    if (!e.touches && Date.now() - lastTouch.current < 700) return
    if (!isAdmin || tool === 'pan' || (e.touches && e.touches.length > 1)) {
      if (e.touches && e.touches.length > 1) {
        drag.current = null
        if (tool !== 'measure' || measureStep !== 1) setDraft(null)
      }
      return
    }
    const p = point(e)
    if (!p) return
    if (tool === 'erase') {
      drag.current = { end: 'erase', fx: p.fx, fy: p.fy }
      const next = eraseAt(p, items)
      if (next.length !== items.length) save(next, scale)
      setDraft({ end: 'erase', x: p.x, y: p.y, x2: p.x, y2: p.y, fx: p.fx, fy: p.fy })
      return
    }
    if (tool === 'text') {
      const label = text.trim()
      if (!label) return
      save([...items, { id: crypto.randomUUID(), type: 'text', ...p, text: label }], scale)
      return
    }
    if (tool === 'measure' && measureStep === 1 && draft) {
      drag.current = { ...draft, end: 'b' }
      setDraft({ ...draft, x2: p.x, y2: p.y, fx: p.fx, fy: p.fy, end: 'b' })
      return
    }
    drag.current = { ...p, end: tool === 'measure' ? 'a' : 'mark', points: [{ x: p.x, y: p.y }] }
    setDraft({ ...p, x2: p.x, y2: p.y, end: tool === 'measure' ? 'a' : 'mark' })
  }
  const move = (e) => {
    if (!drag.current || (e.touches && e.touches.length > 1)) return
    const p = point(e)
    if (!p) return
    if (drag.current.end === 'b') {
      const locked = lockAxis(drag.current, p)
      setDraft({ ...drag.current, ...locked, fx: p.fx, fy: p.fy, end: 'b' })
      return
    }
    if (drag.current.end === 'a') {
      setDraft({ ...p, x2: p.x, y2: p.y, fx: p.fx, fy: p.fy, end: 'a' })
      return
    }
    if (drag.current.end === 'erase') {
      setItems((list) => eraseAt(p, list))
      setDraft({ end: 'erase', x: p.x, y: p.y, x2: p.x, y2: p.y, fx: p.fx, fy: p.fy })
      return
    }
    const points = [...(drag.current.points || []), { x: p.x, y: p.y }]
    drag.current = { ...drag.current, points, x2: p.x, y2: p.y, fx: p.fx, fy: p.fy }
    setDraft({ ...drag.current })
  }
  const up = () => {
    if (!drag.current || !draft) {
      drag.current = null
      return
    }
    if (tool === 'erase') {
      save(items, scale)
      drag.current = null
      setDraft(null)
      return
    }
    if (tool === 'measure' && drag.current.end === 'a') {
      setMeasureStep(1)
      setDraft({ ...draft, end: 'b' })
      drag.current = null
      return
    }
    const chosen = SHEETS.find((s) => s.id === sheetSize) || SHEETS[0]
    const wide = chosen.w >= chosen.h
    const shownWide = (view.current?.clientWidth || 1) >= (view.current?.clientHeight || 1)
    const sheet = wide === shownWide ? chosen : { w: chosen.h, h: chosen.w }
    pageIn.current = { w: sheet.w, h: sheet.h }
    const ratio = SCALES.find((s) => s.id === sheetScale) || SCALES[0]
    const feet = tool === 'measure' ? measureFeet(draft, sheet, ratio) : null
    if (tool === 'pen' && (draft.points || []).length > 1) {
      save([...items, { id: crypto.randomUUID(), type: 'pen', points: draft.points }], scale)
    } else if (tool === 'measure' && feet) {
      save([...items, {
        id: crypto.randomUUID(),
        type: 'dim',
        x: draft.x, y: draft.y, x2: draft.x2, y2: draft.y2,
        feet,
      }], scale)
    }
    drag.current = null
    setDraft(null)
    setMeasureStep(0)
  }

  const onPinchStart = (e) => {
    if (e.touches.length !== 2) return
    const a = e.touches[0]
    const b = e.touches[1]
    pinch.current = {
      d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
      z: zoomRef.current,
      x: (a.clientX + b.clientX) / 2,
      y: (a.clientY + b.clientY) / 2,
    }
  }
  const onPinchMove = (e) => {
    if (!pinch.current || e.touches.length !== 2) return
    e.preventDefault()
    const a = e.touches[0]
    const b = e.touches[1]
    const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
    const next = Math.min(8, Math.max(1, pinch.current.z * (d / pinch.current.d)))
    const sc = scroller.current
    if (!sc) {
      zoomRef.current = next
      setZoom(next)
      return
    }
    const rect = sc.getBoundingClientRect()
    const cx = pinch.current.x
    const cy = pinch.current.y
    const relX = cx - rect.left + sc.scrollLeft
    const relY = cy - rect.top + sc.scrollTop
    const ratio = next / (zoomRef.current || 1)
    zoomRef.current = next
    setZoom(next)
    requestAnimationFrame(() => {
      sc.scrollLeft = relX * ratio - (cx - rect.left)
      sc.scrollTop = relY * ratio - (cy - rect.top)
    })
  }

  const chosenSheet = SHEETS.find((s) => s.id === sheetSize) || SHEETS[0]
  const [vp, setVp] = useState({ w: 390, h: 700 })
  useEffect(() => {
    const read = () => {
      setVp((prev) => {
        const w = Math.round(window.innerWidth)
        const h = Math.round(window.innerHeight)
        if (prev && h < prev.h - 80) return { ...prev, w }
        return { w, h }
      })
    }
    read()
    window.addEventListener('resize', read)
    window.addEventListener('orientationchange', read)
    window.visualViewport?.addEventListener('resize', read)
    window.visualViewport?.addEventListener('scroll', read)
    return () => {
      window.removeEventListener('resize', read)
      window.removeEventListener('orientationchange', read)
      window.visualViewport?.removeEventListener('resize', read)
      window.visualViewport?.removeEventListener('scroll', read)
    }
  }, [])
  const fit = Math.min(vp.w / chosenSheet.w, vp.h / chosenSheet.h)
  const sheetW = Math.max(1, chosenSheet.w * fit * zoom)
  const sheetH = Math.max(1, chosenSheet.h * fit * zoom)
  const btn = 'h-7 px-2 text-[10px] rounded-full whitespace-nowrap border border-white bg-black text-white'

  return createPortal(
    <div className="fixed bg-black" data-no-swipe style={{ top: 0, left: 0, width: vp.w, height: vp.h, zIndex: 200 }}>
      <button
        type="button"
        onClick={onBack}
        className="absolute z-[90] right-3 w-8 h-8 rounded-full bg-black text-white text-lg leading-none border border-white"
        style={{ top: 'max(12px, env(safe-area-inset-top))' }}
      >
        ×
      </button>
      {!files.length ? (
        <p className="text-sm text-white p-6">Upload a plan first.</p>
      ) : (
        <>
          <div
            ref={scroller}
            className="absolute inset-0 overflow-auto bg-black"
            data-no-swipe
            onTouchStart={onPinchStart}
            onTouchMove={onPinchMove}
            onTouchEnd={() => { pinch.current = null }}
          >
            <div style={{ width: Math.max(vp.w, sheetW), height: Math.max(vp.h, sheetH), position: 'relative' }}>
              <div ref={content} style={{ width: sheetW, height: sheetH, position: 'absolute', left: Math.max(0, (vp.w - sheetW) / 2), top: Math.max(0, (vp.h - sheetH) / 2) }}>
                {img ? <img src={img} alt="" className="w-full h-full block select-none object-fill" draggable={false} /> : <div className="p-6 text-sm text-white">Opening plan…</div>}
                <svg
                  ref={view}
                  className="absolute inset-0 w-full h-full"
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                  style={{ touchAction: 'none', WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none' }}
                  onContextMenu={(e) => e.preventDefault()}
                  onMouseDown={down}
                  onMouseMove={move}
                  onMouseUp={up}
                  onMouseLeave={up}
                  onTouchStart={(e) => { e.preventDefault(); down(e) }}
                  onTouchMove={(e) => { e.preventDefault(); move(e) }}
                  onTouchEnd={(e) => { e.preventDefault(); up() }}
                >
                  {items.map((it) => it.type === 'text' ? (
                    <text key={it.id} x={it.x} y={it.y} fill="#16324F" fontSize="2.2" fontFamily="Montserrat, sans-serif" fontWeight="500">{it.text}</text>
                  ) : it.points ? (
                    <polyline key={it.id} points={it.points.map((pt) => pt.x + ',' + pt.y).join(' ')} fill="none" stroke="#E6B800" strokeWidth="0.28" strokeLinecap="round" strokeLinejoin="round" />
                  ) : (
                    <g key={it.id}>
                      <line x1={it.x} y1={it.y} x2={it.x2} y2={it.y2} stroke={it.type === 'dim' ? '#7EB6FF' : '#E6B800'} strokeWidth="0.22" />
                      {it.type === 'dim' && (
                        <>
                          <line x1={it.x - (Math.abs(it.x2 - it.x) >= Math.abs(it.y2 - it.y) ? 0 : 0.7)} y1={it.y - (Math.abs(it.x2 - it.x) >= Math.abs(it.y2 - it.y) ? 0.7 : 0)} x2={it.x + (Math.abs(it.x2 - it.x) >= Math.abs(it.y2 - it.y) ? 0 : 0.7)} y2={it.y + (Math.abs(it.x2 - it.x) >= Math.abs(it.y2 - it.y) ? 0.7 : 0)} stroke="#7EB6FF" strokeWidth="0.22" />
                          <line x1={it.x2 - (Math.abs(it.x2 - it.x) >= Math.abs(it.y2 - it.y) ? 0 : 0.7)} y1={it.y2 - (Math.abs(it.x2 - it.x) >= Math.abs(it.y2 - it.y) ? 0.7 : 0)} x2={it.x2 + (Math.abs(it.x2 - it.x) >= Math.abs(it.y2 - it.y) ? 0 : 0.7)} y2={it.y2 + (Math.abs(it.x2 - it.x) >= Math.abs(it.y2 - it.y) ? 0.7 : 0)} stroke="#7EB6FF" strokeWidth="0.22" />
                        </>
                      )}
                      {it.feet != null && (
                        <text x={(it.x + it.x2) / 2} y={(it.y + it.y2) / 2} fill="#7EB6FF" fontSize="2.4" fontWeight="700">{formatDim(it.feet)}</text>
                      )}
                    </g>
                  ))}
                  {draft?.points && (
                    <polyline points={draft.points.map((pt) => pt.x + ',' + pt.y).join(' ')} fill="none" stroke="#E6B800" strokeWidth="0.28" strokeLinecap="round" strokeLinejoin="round" />
                  )}
                  {draft && !draft.points && (
                    <g>
                      <line x1={draft.x} y1={draft.y} x2={draft.x2} y2={draft.y2} stroke="#7EB6FF" strokeWidth="0.22" />
                      <line x1={draft.x - (Math.abs(draft.x2 - draft.x) >= Math.abs(draft.y2 - draft.y) ? 0 : 0.8)} y1={draft.y - (Math.abs(draft.x2 - draft.x) >= Math.abs(draft.y2 - draft.y) ? 0.8 : 0)} x2={draft.x + (Math.abs(draft.x2 - draft.x) >= Math.abs(draft.y2 - draft.y) ? 0 : 0.8)} y2={draft.y + (Math.abs(draft.x2 - draft.x) >= Math.abs(draft.y2 - draft.y) ? 0.8 : 0)} stroke="#7EB6FF" strokeWidth="0.45" />
                      <line x1={draft.x2 - (Math.abs(draft.x2 - draft.x) >= Math.abs(draft.y2 - draft.y) ? 0 : 0.8)} y1={draft.y2 - (Math.abs(draft.x2 - draft.x) >= Math.abs(draft.y2 - draft.y) ? 0.8 : 0)} x2={draft.x2 + (Math.abs(draft.x2 - draft.x) >= Math.abs(draft.y2 - draft.y) ? 0 : 0.8)} y2={draft.y2 + (Math.abs(draft.x2 - draft.x) >= Math.abs(draft.y2 - draft.y) ? 0.8 : 0)} stroke="#7EB6FF" strokeWidth="0.45" />
                    </g>
                  )}
                </svg>
              </div>
            </div>
          </div>
          <div className="absolute left-0 right-0 z-[90] flex justify-center px-2" style={{ bottom: 'max(8px, env(safe-area-inset-bottom))' }}>
            <div className="flex flex-wrap justify-center gap-1 max-w-full">
            {['pen', 'text', 'measure', 'erase'].map((t) => (
              <button key={t} type="button" onClick={() => setTool((cur) => cur === t ? 'pan' : t)} className={btn + (tool === t ? ' !bg-white !text-black' : '')}>
                {t === 'pen' ? 'Mark' : t === 'text' ? 'Text' : t === 'erase' ? 'Eraser' : 'Measure'}
              </button>
            ))}
            <select className={btn + ' max-w-[92px]'} value={sheetScale} onChange={(e) => setSheetScale(e.target.value)}>
              {SCALES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            {pageCount > 1 && (
              <>
                <button type="button" className={btn} onClick={() => setPage((p) => Math.max(1, p - 1))}>Prev</button>
                <span className="text-xs text-white self-center">{page}/{pageCount}</span>
                <button type="button" className={btn} onClick={() => setPage((p) => Math.min(pageCount, p + 1))}>Next</button>
              </>
            )}
            </div>
          </div>
          {draft?.fx != null && img && (
            <div
              className="absolute z-[95] w-28 h-28 rounded-full border-2 border-white overflow-hidden pointer-events-none"
              style={{
                left: Math.max(8, Math.min(vp.w - 120, draft.fx - 56)),
                top: Math.max(8, draft.fy - 150),
                backgroundImage: 'url(' + img + ')',
                backgroundRepeat: 'no-repeat',
                backgroundSize: (sheetW * 2.4) + 'px ' + (sheetH * 2.4) + 'px',
                backgroundPosition: (-((((draft.end === 'a' ? draft.x : draft.x2) / 100) * sheetW * 2.4) - 56)) + 'px ' + (-((((draft.end === 'a' ? draft.y : draft.y2) / 100) * sheetH * 2.4) - 56)) + 'px',
              }}
            >
              {tool === 'erase' ? (
                <div className="absolute left-1/2 top-1/2 w-4 h-4 -ml-2 -mt-2 rounded-full bg-black border border-white" />
              ) : tool === 'pen' && draft?.points ? (
                <svg className="absolute inset-0 w-full h-full" viewBox="-18 -18 36 36">
                  <polyline points={draft.points.slice(-24).map((pt) => ((pt.x - draft.x2) * 4) + ',' + ((pt.y - draft.y2) * 4)).join(' ')} fill="none" stroke="#E6B800" strokeWidth="1.4" />
                  <circle cx="0" cy="0" r="1.2" fill="#E6B800" />
                </svg>
              ) : (
                <>
                  <div className="absolute left-1/2 top-1/2 w-5 h-px -ml-2.5 bg-[#7EB6FF]" />
                  <div className="absolute left-1/2 top-1/2 h-5 w-px -mt-2.5 bg-[#7EB6FF]" />
                </>
              )}
            </div>
          )}
          {tool === 'text' && (
            <input inputMode="text" className="fixed left-3 right-3 z-[220] border border-white bg-black text-white rounded px-3 py-2 text-base" style={{ bottom: 'calc(env(safe-area-inset-bottom) + 52px)' }} placeholder="Text to place" value={text} onChange={(e) => setText(e.target.value)} />
          )}
        </>
      )}
    </div>,
    document.body
  )
}
