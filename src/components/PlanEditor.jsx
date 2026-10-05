import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

const field = 'w-full border border-black rounded px-3 py-2 text-sm bg-white'

function keyFor(projectId, url, page) {
  return 'bw_plan_' + projectId + '_' + page + '_' + url
}

function dist(a, b, w, h) {
  const dx = (a.x - b.x) * w
  const dy = (a.y - b.y) * h
  return Math.sqrt(dx * dx + dy * dy)
}

export default function PlanEditor({ project, profile, isAdmin }) {
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
  const [items, setItems] = useState([])
  const [scale, setScale] = useState(null)
  const [text, setText] = useState('')
  const drag = useRef(null)
  const [draft, setDraft] = useState(null)
  const view = useRef(null)

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
      const viewport = pg.getViewport({ scale: 1.6 })
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
    if (!isAdmin || tool === 'pan') return
    const p = point(e)
    if (!p) return
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
    const box = view.current?.getBoundingClientRect()
    const px = box ? dist(draft, { x: draft.x2, y: draft.y2 }, box.width, box.height) : 0
    let nextScale = scale
    let feet = null
    if (tool === 'measure' && px > 8) {
      if (!nextScale) {
        const entered = window.prompt('How many feet is this line? Later lines will use this scale.')
        const n = parseFloat(entered)
        if (!n || n <= 0) {
          drag.current = null
          setDraft(null)
          return
        }
        nextScale = px / n
        feet = n
      } else {
        feet = Math.round((px / nextScale) * 10) / 10
      }
    }
    if (px > 8) {
      save([...items, {
        id: crypto.randomUUID(),
        type: tool === 'measure' ? 'dim' : 'pen',
        x: draft.x, y: draft.y, x2: draft.x2, y2: draft.y2,
        feet,
      }], nextScale)
    }
    drag.current = null
    setDraft(null)
  }

  return (
    <div>
      {!files.length ? (
        <p className="text-sm text-[#6B6E72]">Upload a PDF or plan image under Plans & files.</p>
      ) : (
        <>
          <select className={field + ' mb-2'} value={fileUrl} onChange={(e) => { setFileUrl(e.target.value); setPage(1); setZoom(1) }}>
            {files.map((f) => (
              <option key={f.id || f.public_url} value={f.public_url}>
                {(f.file_name || f.name || 'Plan')}{f.phase_name ? ' · ' + f.phase_name : ''}
              </option>
            ))}
          </select>
          <div className="flex gap-2 mb-2 flex-wrap">
            {['pan', 'pen', 'text', 'measure'].map((t) => (
              <button key={t} type="button" onClick={() => setTool(t)} className={'px-3 py-1.5 text-xs border border-black rounded ' + (tool === t ? 'bg-black text-white' : '')}>
                {t === 'pan' ? 'Move' : t === 'pen' ? 'Mark' : t === 'text' ? 'Text' : 'Measure'}
              </button>
            ))}
            <button type="button" className="px-3 py-1.5 text-xs border border-black rounded" onClick={() => setZoom((z) => Math.min(4, z + 0.25))}>+</button>
            <button type="button" className="px-3 py-1.5 text-xs border border-black rounded" onClick={() => setZoom((z) => Math.max(1, z - 0.25))}>−</button>
            {pageCount > 1 && (
              <>
                <button type="button" className="px-3 py-1.5 text-xs border border-black rounded" onClick={() => setPage((p) => Math.max(1, p - 1))}>Prev</button>
                <span className="text-xs self-center">{page}/{pageCount}</span>
                <button type="button" className="px-3 py-1.5 text-xs border border-black rounded" onClick={() => setPage((p) => Math.min(pageCount, p + 1))}>Next</button>
              </>
            )}
          </div>
          {tool === 'text' && isAdmin && (
            <input className={field + ' mb-2'} placeholder="Text to place" value={text} onChange={(e) => setText(e.target.value)} />
          )}
          <p className="text-[11px] text-[#6B6E72] mb-2">
            {scale ? 'Scale set. New measurements use it.' : 'Draw a measure line and enter its real length once. The next lines calculate from that.'}
          </p>
          <div className="overflow-auto border border-black rounded bg-[#F5F5F5] max-h-[70vh]" data-no-swipe>
            <div style={{ width: (zoom * 100) + '%', position: 'relative' }}>
              {img ? <img src={img} alt="" className="w-full block select-none" draggable={false} /> : <div className="p-6 text-sm">Opening plan…</div>}
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
                  <text key={it.id} x={it.x + '%'} y={it.y + '%'} fill="#B5533C" fontSize="14" fontWeight="600">{it.text}</text>
                ) : (
                  <g key={it.id}>
                    <line x1={it.x + '%'} y1={it.y + '%'} x2={it.x2 + '%'} y2={it.y2 + '%'} stroke={it.type === 'dim' ? '#16324F' : '#B5533C'} strokeWidth="2" />
                    {it.feet != null && (
                      <text x={((it.x + it.x2) / 2) + '%'} y={((it.y + it.y2) / 2) + '%'} fill="#16324F" fontSize="12" fontWeight="700">{it.feet} ft</text>
                    )}
                  </g>
                ))}
                {draft && <line x1={draft.x + '%'} y1={draft.y + '%'} x2={draft.x2 + '%'} y2={draft.y2 + '%'} stroke="#16324F" strokeWidth="2" />}
              </svg>
            </div>
          </div>
          {isAdmin && items.length > 0 && (
            <button type="button" className="mt-3 text-xs underline text-[#B5533C]" onClick={() => save([], scale)}>Clear marks on this page</button>
          )}
        </>
      )}
    </div>
  )
}
