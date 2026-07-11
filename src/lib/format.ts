/** Decimal units, matching how macOS/NeoFinder report drive sizes. */
export function humanBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—'
  if (n < 1000) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB', 'PB']
  let v = n
  let u = -1
  while (v >= 1000 && u < units.length - 1) {
    v /= 1000
    u++
  }
  const digits = v >= 100 ? 0 : v >= 10 ? 1 : 2
  return `${v.toFixed(digits)} ${units[u]}`
}

/** Relative age like "2y 3m", "8m", "12d". */
export function relAge(ms: number | null, now = Date.now()): string {
  if (ms == null) return '—'
  const days = Math.max(0, Math.floor((now - ms) / 86400000))
  if (days < 31) return `${days}d`
  const months = Math.floor(days / 30.44)
  if (months < 12) return `${months}m`
  const y = Math.floor(months / 12)
  const m = months % 12
  return m === 0 ? `${y}y` : `${y}y ${m}m`
}

export function fmtDate(ms: number | null): string {
  if (ms == null) return ''
  const d = new Date(ms)
  const p = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function todayStamp(now = new Date()): string {
  const p = (x: number) => String(x).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
}

/** Case-insensitive subsequence match ("fuzzy"). Empty query matches everything. */
export function fuzzyMatch(query: string, text: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const t = text.toLowerCase()
  let ti = 0
  for (const ch of q) {
    ti = t.indexOf(ch, ti)
    if (ti === -1) return false
    ti++
  }
  return true
}
