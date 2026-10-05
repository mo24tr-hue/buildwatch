const DB = 'bw-photos'
const STORE = 'files'
const mem = new Map()

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idbGet(url) {
  const db = await openDb()
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(url)
    req.onsuccess = () => resolve(req.result || null)
    req.onerror = () => resolve(null)
  })
}

async function idbPut(url, blob) {
  const db = await openDb()
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(blob, url)
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
  })
}

function isVideo(url) {
  return /\.(mp4|mov|webm)(\?|$)/i.test(url || '')
}

export async function resolvePhoto(url) {
  if (!url || isVideo(url)) return url
  if (mem.has(url)) return mem.get(url)
  try {
    const blob = await idbGet(url)
    if (blob) {
      const obj = URL.createObjectURL(blob)
      mem.set(url, obj)
      return obj
    }
  } catch (_) {}
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return url
  try {
    const res = await fetch(url)
    if (!res.ok) return url
    const blob = await res.blob()
    if (!blob || !blob.size) return url
    await idbPut(url, blob)
    const obj = URL.createObjectURL(blob)
    mem.set(url, obj)
    return obj
  } catch {
    return url
  }
}

export function collectPhotoUrls(projects, company) {
  const urls = new Set()
  if (company?.logo_url) urls.add(company.logo_url)
  for (const p of projects || []) {
    if (p.cover_photo_url) urls.add(p.cover_photo_url)
    for (const ph of p.phases || []) {
      for (const photo of ph.photos || []) {
        if (photo.public_url && !isVideo(photo.public_url)) urls.add(photo.public_url)
      }
    }
    for (const f of p.project_files || []) {
      if (f.public_url && !isVideo(f.public_url)) urls.add(f.public_url)
    }
  }
  return [...urls]
}

let warming = false
export async function warmPhotos(urls) {
  if (warming || !urls?.length) return
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return
  warming = true
  const queue = urls.filter((u) => u && !mem.has(u) && !isVideo(u))
  const workers = 3
  let i = 0
  async function run() {
    while (i < queue.length) {
      const url = queue[i++]
      try {
        const existing = await idbGet(url)
        if (existing) {
          mem.set(url, URL.createObjectURL(existing))
          continue
        }
        const res = await fetch(url)
        if (!res.ok) continue
        const blob = await res.blob()
        if (!blob?.size) continue
        await idbPut(url, blob)
        mem.set(url, URL.createObjectURL(blob))
      } catch (_) {}
    }
  }
  await Promise.all(Array.from({ length: workers }, run))
  warming = false
}
