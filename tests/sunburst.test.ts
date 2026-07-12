import { describe, expect, it } from 'vitest'
import { arcPath, buildSunburst } from '../src/lib/sunburst'
import { mkNode } from './fixture'

const SSD = 'sn:test'
const TAU = Math.PI * 2

function tree() {
  // Root 1000 = A 600 + B 300 + 100 direct files. A = A1 400 + A2 200.
  return [
    mkNode(SSD, 'SSD 1', 1, 1000, { depth: 0 }),
    mkNode(SSD, 'SSD 1:A', 1, 600),
    mkNode(SSD, 'SSD 1:A:A1', 1, 400),
    mkNode(SSD, 'SSD 1:A:A2', 1, 200),
    mkNode(SSD, 'SSD 1:B', 1, 300),
  ]
}

describe('buildSunburst', () => {
  it('gives children angle spans proportional to size, leaving the direct-file gap', () => {
    const { segs, root } = buildSunburst(tree(), SSD)
    expect(root?.path).toBe('SSD 1')
    const a = segs.find((s) => s.node.path === 'SSD 1:A')!
    const b = segs.find((s) => s.node.path === 'SSD 1:B')!
    expect(a.a1 - a.a0).toBeCloseTo(TAU * 0.6, 10)
    expect(b.a1 - b.a0).toBeCloseTo(TAU * 0.3, 10)
    // B starts where A ends; the remaining 10% (direct files) is a gap.
    expect(b.a0).toBeCloseTo(a.a1, 10)
    expect(b.a1).toBeLessThan(TAU - 0.1)
  })

  it('nests child rings inside the parent span', () => {
    const { segs } = buildSunburst(tree(), SSD)
    const a = segs.find((s) => s.node.path === 'SSD 1:A')!
    const a1 = segs.find((s) => s.node.path === 'SSD 1:A:A1')!
    const a2 = segs.find((s) => s.node.path === 'SSD 1:A:A2')!
    expect(a1.ring).toBe(1)
    expect(a1.a0).toBeGreaterThanOrEqual(a.a0)
    expect(a2.a1).toBeLessThanOrEqual(a.a1 + 1e-9)
    // A1+A2 fill A exactly (600 = 400+200, no direct files under A).
    expect(a1.a1 - a1.a0 + (a2.a1 - a2.a0)).toBeCloseTo(a.a1 - a.a0, 10)
  })

  it('honors the depth cap', () => {
    const deep = [
      ...tree(),
      mkNode(SSD, 'SSD 1:A:A1:X', 1, 400),
      mkNode(SSD, 'SSD 1:A:A1:X:Y', 1, 400),
    ]
    const { segs } = buildSunburst(deep, SSD, { maxDepth: 2 })
    expect(segs.some((s) => s.node.path === 'SSD 1:A:A1')).toBe(true)
    expect(segs.some((s) => s.node.path === 'SSD 1:A:A1:X')).toBe(false)
  })

  it('folds tiny siblings into one aggregate "other" segment', () => {
    const many = [mkNode(SSD, 'SSD 1', 1, 1000, { depth: 0 }), mkNode(SSD, 'SSD 1:Big', 1, 900)]
    for (let i = 0; i < 100; i++) many.push(mkNode(SSD, `SSD 1:t${i}`, 1, 1))
    const { segs } = buildSunburst(many, SSD, { minAngle: 0.05 })
    const ring0 = segs.filter((s) => s.ring === 0)
    expect(ring0).toHaveLength(2) // Big + other
    const other = ring0.find((s) => s.aggregate !== null)!
    expect(other.aggregate).toEqual({ count: 100, bytes: 100 })
    expect(other.node.name).toBe('other')
  })

  it('subsets to a zoom root', () => {
    const { segs, root } = buildSunburst(tree(), SSD, { rootPath: 'SSD 1:A' })
    expect(root?.path).toBe('SSD 1:A')
    expect(segs.map((s) => s.node.path).sort()).toEqual(['SSD 1:A:A1', 'SSD 1:A:A2'])
    const a1 = segs.find((s) => s.node.path === 'SSD 1:A:A1')!
    expect(a1.a1 - a1.a0).toBeCloseTo(TAU * (400 / 600), 10)
  })

  it('returns empty on an unknown root or empty input', () => {
    expect(buildSunburst([], SSD).segs).toEqual([])
    expect(buildSunburst(tree(), SSD, { rootPath: 'SSD 1:nope' }).root).toBeNull()
  })
})

describe('arcPath', () => {
  it('emits a closed annulus sector', () => {
    const d = arcPath(0, Math.PI / 2, 0.5, 1)
    expect(d).toMatch(/^M /)
    expect(d).toMatch(/Z$/)
    expect(d.match(/A /g)).toHaveLength(2)
  })

  it('splits a full circle into two half-annuli', () => {
    const d = arcPath(0, TAU, 0.5, 1)
    expect(d.match(/M /g)).toHaveLength(2)
  })
})
