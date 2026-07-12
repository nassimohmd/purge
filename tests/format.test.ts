import { describe, expect, it } from 'vitest'
import { parseHumanSize } from '../src/lib/format'

describe('parseHumanSize', () => {
  it('parses plain unit forms (decimal, matching humanBytes)', () => {
    expect(parseHumanSize('2 TB')).toBe(2e12)
    expect(parseHumanSize('1.82 TB')).toBe(1.82e12)
    expect(parseHumanSize('500GB')).toBe(500e9)
    expect(parseHumanSize('512 mb')).toBe(512e6)
    expect(parseHumanSize('1 KB')).toBe(1000)
  })

  it('parses comma-decimal European forms', () => {
    expect(parseHumanSize('483,35 GB')).toBe(483350000000)
    expect(parseHumanSize('1,5 TB')).toBe(1.5e12)
  })

  it('parses thousands separators', () => {
    expect(parseHumanSize('2,000 GB')).toBe(2e12)
    expect(parseHumanSize('2,000,398,934,016 bytes')).toBe(2000398934016)
    expect(parseHumanSize('1,234.56 GB')).toBe(1234560000000)
    expect(parseHumanSize('1.234,56 GB')).toBe(1234560000000)
  })

  it('prefers the exact parenthesized byte count', () => {
    expect(parseHumanSize('2 TB (2,000,398,934,016 Bytes)')).toBe(2000398934016)
    expect(parseHumanSize('2 TB (2000398934016 bytes)')).toBe(2000398934016)
  })

  it('parses bare byte counts', () => {
    expect(parseHumanSize('2000398934016')).toBe(2000398934016)
    expect(parseHumanSize('123 B')).toBe(123)
  })

  it('returns null on garbage, never throws', () => {
    expect(parseHumanSize('')).toBeNull()
    expect(parseHumanSize('   ')).toBeNull()
    expect(parseHumanSize('enormous')).toBeNull()
    expect(parseHumanSize('TB 2')).toBeNull()
    expect(parseHumanSize('-5 GB')).toBeNull()
    expect(parseHumanSize('2 XB')).toBeNull()
  })
})
