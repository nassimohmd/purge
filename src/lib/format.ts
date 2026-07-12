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

const SIZE_UNIT: Record<string, number> = {
  b: 1, byte: 1, bytes: 1,
  kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12, pb: 1e15,
  k: 1e3, m: 1e6, g: 1e9, t: 1e12, p: 1e15,
}

/**
 * Parse a human drive size — "2 TB", "1.82 TB", "483,35 GB" (comma decimal),
 * "2 TB (2,000,398,934,016 Bytes)" (exact byte count wins), "2000398934016".
 * Decimal units (1000-based), matching humanBytes. Null on anything else.
 */
export function parseHumanSize(s: string): number | null {
  const t = s.trim()
  if (!t) return null
  // Exact byte count in parentheses, e.g. "(2,000,398,934,016 Bytes)".
  const paren = t.match(/\(([\d,. \s']+)\s*bytes?\)/i)
  if (paren) {
    const n = Number(paren[1].replace(/[^\d]/g, ''))
    if (Number.isFinite(n) && n > 0) return n
  }
  const m = t.match(/^([\d,. \s']+?)\s*(bytes?|[kmgtp]b?|b)?\s*(?:\(.*\))?$/i)
  if (!m) return null
  let num = m[1].replace(/[ \s']/g, '')
  const unit = (m[2] ?? 'b').toLowerCase()
  if (!(unit in SIZE_UNIT)) return null
  // "483,35" → comma decimal; "2,000,398" → thousands separators.
  if (num.includes(',') && num.includes('.')) {
    num = num.lastIndexOf('.') > num.lastIndexOf(',')
      ? num.replace(/,/g, '') // 1,234.56
      : num.replace(/\./g, '').replace(',', '.') // 1.234,56
  } else if (num.includes(',')) {
    const parts = num.split(',')
    num = parts.length === 2 && parts[1].length !== 3
      ? `${parts[0]}.${parts[1]}` // 483,35 — decimal comma
      : parts.join('') // 2,000,398,934,016 — separators
  }
  const v = Number(num)
  if (!Number.isFinite(v) || v <= 0) return null
  return Math.round(v * SIZE_UNIT[unit])
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
