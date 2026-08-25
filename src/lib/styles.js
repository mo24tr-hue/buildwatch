export const STYLES = {
  newBuild: {
    label: 'New Build',
    phases: [
      'Excavation', 'Footings & Foundation', 'Framing', 'Plumbing', 'HVAC', 'Electrical',
      'Insulation', 'Drywall', 'Mud', 'Tile', 'Flooring', 'Paint',
    ],
  },
  addition: {
    label: 'Addition',
    phases: [
      'Excavation', 'Footings & Foundation', 'Framing', 'Plumbing', 'HVAC', 'Electrical',
      'Insulation', 'Drywall', 'Mud', 'Tile', 'Flooring', 'Paint',
    ],
  },
  remodel: {
    label: 'Remodel',
    phases: [
      'Demo', 'Framing', 'Plumbing', 'HVAC', 'Electrical', 'Insulation', 'Drywall',
      'Mud', 'Tile', 'Flooring', 'Paint',
    ],
  },
  kitchen: {
    label: 'Kitchen',
    phases: [
      'Demo', 'Plumbing Rough-in', 'Electrical Rough-in', 'Drywall', 'Cabinets',
      'Countertops', 'Tile / Backsplash', 'Flooring', 'Paint', 'Appliances',
    ],
  },
  bathroom: {
    label: 'Bathroom',
    phases: [
      'Demo', 'Plumbing Rough-in', 'Electrical Rough-in', 'Waterproofing', 'Tile',
      'Vanity & Fixtures', 'Paint',
    ],
  },
}

/** Always attached to every new project as its own section */
export const FINISHING_PHASES = [
  'Electrical',
  'Plumbing',
  'HVAC',
]

export const PROJECT_STATUS = {
  planning: { label: 'Planning', color: '#2F6690', bg: '#E4EEF5' },
  active: { label: 'In progress', color: '#E6B800', bg: '#FFF8DB' },
  hold: { label: 'On hold', color: '#6B6E72', bg: '#E9E9E7' },
  done: { label: 'Complete', color: '#3F7D58', bg: '#E1EDE4' },
}

export const PHASE_STATUS = {
  pending: { label: 'Pending', color: '#6B6E72', bg: '#E9E9E7' },
  active: { label: 'In progress', color: '#E6B800', bg: '#FFF8DB' },
  done: { label: 'Done', color: '#3F7D58', bg: '#E1EDE4' },
}

export const PHASE_ORDER = ['pending', 'active', 'done']

export function nextPhaseStatus(current) {
  const i = PHASE_ORDER.indexOf(current)
  return PHASE_ORDER[(i + 1) % PHASE_ORDER.length]
}

export function fmtDate(d) {
  if (!d) return '—'
  try {
    const date = typeof d === 'string' && d.length <= 10 ? new Date(d + 'T12:00:00') : new Date(d)
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch {
    return d
  }
}

/** True only when phase was explicitly added to Finishing (name starts with Finishing) */
export function isFinishingPhase(name) {
  const n = String(name || '').trim()
  return /^finishing(\s*[—\-:]|\s+)/i.test(n) || /^finishing$/i.test(n)
}

export function finishingLabel(name) {
  const n = String(name || '').trim()
  const m = n.match(/^finishing\s*[—\-:]\s*(.+)$/i)
  if (m) return m[1].trim()
  return n
}

export function fmtDateTime(d) {
  if (!d) return '—'
  try {
    const date = typeof d === 'string' && d.length <= 10 ? new Date(d + 'T12:00:00') : new Date(d)
    const now = new Date()
    const sameDay = date.toDateString() === now.toDateString()
    const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    if (sameDay) return 'Today ' + time
    const yday = new Date(now)
    yday.setDate(yday.getDate() - 1)
    if (date.toDateString() === yday.toDateString()) return 'Yesterday ' + time
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + ' ' + time
  } catch {
    return d
  }
}
