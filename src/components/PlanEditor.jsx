import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'

const field = 'w-full border border-black rounded px-3 py-2 text-sm bg-white'

function keyFor(projectId, url, page) {
  return 'bw_plan_' + projectId + '_' + page + '_' + url
}

function dist(a, b, w, h) {
  const dx = ((a.x2 ?? a.x) - a.x) * w
  const dy = ((a.y2 ?? a.y) - a.y) * h
  return Math.sqrt(dx * dx + dy * dy)
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
  const [draft, setDraft] = useState(null)

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
      pageIn.current = { w: base.width / 72, h: base.height / 72 }
      const snapped = nearestSheet(pageIn.current.w, pageIn.current.h)
      if (!dead) setSheetSize(snapped.id)
      pageIn.current = { w: snapped.w, h: snapped.h }
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
    return {
      x: Math.min(100, Math.max(0, ((src.clientX - box.left) / box.width) * 100)),
      y: Math.min(100, Math.max(0, ((src.clientY - box.top) / box.height) * 100)),
    }
  }

  const down = (e) => {
    if (!isAdmin || tool === 'pan' || (e.touches && e.touches.length > 1)) return
    const p = point(e)
    if (!p) return
    if (tool === 'erase') {
      const next = items.filter((it) => {
        const mx = it.x2 != null ? (it.x + it.x2) / 2 : it.x
        const my = it.y2 != null ? (it.y + it.y2) / 2 : it.y
        return Math.hypot(mx - p.x, my - p.y) > 6
      })
      if (next.length !== items.length) save(next, scale)
      return
    }
    if (tool === 'text') {
      const label = text.trim()
      if (!label) return
      save([...items, { id: crypto.randomUUID(), type: 'text', ...p, text: label }], scale)
      return
    }
    drag.current = p
    setDraft({ ...p, x2: p.x, y2: p.y })
  }
  const move = (e) => {
    if (!drag.current) return
    const p = point(e)
    if (!p) return
    setDraft({ ...drag.current, x2: p.x, y2: p.y })
  }
  const up = () => {
    if (!drag.current || !draft) {
      drag.current = null
      return
    }
    const chosen = SHEETS.find((s) => s.id === sheetSize) || SHEETS[0]
    pageIn.current = { w: chosen.w, h: chosen.h }
    const paperInches = dist(draft, { x: draft.x2, y: draft.y2 }, chosen.w, chosen.h)
    const ratio = SCALES.find((s) => s.id === sheetScale) || SCALES[0]
    let feet = null
    if (tool === 'measure' && paperInches > 0.02) {
      feet = Math.round((paperInches / ratio.inchesPerFoot) * 10) / 10
    }
    if ((tool === 'pen' && paperInches > 0) || (tool === 'measure' && feet)) {
      save([...items, {
        id: crypto.randomUUID(),
        type: tool === 'measure' ? 'dim' : 'pen',
        x: draft.x, y: draft.y, x2: draft.x2, y2: draft.y2,
        feet: tool === 'measure' ? feet : null,
      }], scale)
    }
    drag.current = null
    setDraft(null)
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
      const vv = window.visualViewport
      setVp({
        w: Math.round(vv?.width || window.innerWidth),
        h: Math.round(vv?.height || window.innerHeight),
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

  return createPortal(
    <div className="fixed bg-black" data-no-swipe style={{ top: 0, left: 0, width: vp.w, height: vp.h, zIndex: 200 }}>
      <button
        type="button"
        onClick={onBack}
        className="absolute z-[90] right-3 w-16 h-16 rounded-full bg-black text-white text-3xl leading-none border-2 border-white"
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
                  style={{ touchAction: tool === 'pan' ? 'pan-x pan-y' : 'none' }}
                  onMouseDown={down}
                  onMouseMove={move}
                  onMouseUp={up}
                  onMouseLeave={up}
                  onTouchStart={down}
                  onTouchMove={move}
                  onTouchEnd={up}
                >
                  {items.map((it) => it.type === 'text' ? (
                    <text key={it.id} x={it.x + '%'} y={it.y + '%'} fill="#E6B800" fontSize="14" fontWeight="600">{it.text}</text>
                  ) : (
                    <g key={it.id}>
                      <line x1={it.x + '%'} y1={it.y + '%'} x2={it.x2 + '%'} y2={it.y2 + '%'} stroke={it.type === 'dim' ? '#7EB6FF' : '#E6B800'} strokeWidth="2" />
                      {it.feet != null && (
                        <text x={((it.x + it.x2) / 2) + '%'} y={((it.y + it.y2) / 2) + '%'} fill="#7EB6FF" fontSize="12" fontWeight="700">{it.feet} ft</text>
                      )}
                    </g>
                  ))}
                  {draft && <line x1={draft.x + '%'} y1={draft.y + '%'} x2={draft.x2 + '%'} y2={draft.y2 + '%'} stroke="#7EB6FF" strokeWidth="2" />}
                </svg>
              </div>
            </div>
          </div>
          <div className="absolute left-2 right-20 z-[90] flex gap-1.5 overflow-x-auto" style={{ bottom: 'max(10px, env(safe-area-inset-bottom))' }}>
            {['pen', 'text', 'measure', 'erase'].map((t) => (
              <button key={t} type="button" onClick={() => setTool((cur) => cur === t ? 'pan' : t)} className={'px-3 py-2 text-xs rounded-full whitespace-nowrap border-2 border-white ' + (tool === t ? 'bg-white text-black' : 'bg-black text-white')}>
                {t === 'pen' ? 'Mark' : t === 'text' ? 'Text' : t === 'erase' ? 'Eraser' : 'Measure'}
              </button>
            ))}
            <select className="px-2 py-1.5 text-xs rounded-full bg-black text-white border-2 border-white" value={sheetScale} onChange={(e) => setSheetScale(e.target.value)}>
              {SCALES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            <select className="px-2 py-1.5 text-xs rounded-full bg-black text-white border-2 border-white" value={sheetSize} onChange={(e) => { setSheetSize(e.target.value); const s = SHEETS.find((x) => x.id === e.target.value); if (s) pageIn.current = { w: s.w, h: s.h } }}>
              {SHEETS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            {pageCount > 1 && (
              <>
                <button type="button" className="px-3 py-2 text-xs rounded-full bg-black text-white border-2 border-white" onClick={() => setPage((p) => Math.max(1, p - 1))}>Prev</button>
                <span className="text-xs text-white self-center">{page}/{pageCount}</span>
                <button type="button" className="px-3 py-2 text-xs rounded-full bg-black text-white border-2 border-white" onClick={() => setPage((p) => Math.min(pageCount, p + 1))}>Next</button>
              </>
            )}
          </div>
          {tool === 'text' && isAdmin && (
            <input className="absolute left-3 right-3 z-[90] border border-white/40 bg-black/80 text-white rounded px-3 py-2 text-sm" style={{ bottom: 'max(58px, calc(env(safe-area-inset-bottom) + 46px))' }} placeholder="Text to place" value={text} onChange={(e) => setText(e.target.value)} />
          )}
        </>
      )}
    </div>,
    document.body
  )
}
