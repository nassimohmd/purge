import { describe, expect, it } from 'vitest'
import type { Decision, DecisionState, NodeRec } from '../src/lib/types'
import { dkey } from '../src/lib/types'
import { effectiveState, resolveDeletions } from '../src/lib/resolve'
import { mkNode } from './fixture'

const SSD = 'sn:test'

const d = (path: string, state: DecisionState, note = ''): Decision => ({
  key: dkey(SSD, path),
  ssdId: SSD,
  path,
  state,
  note,
  decidedAt: 1,
})

const decisionsOf = (...ds: Decision[]): Record<string, Decision> =>
  Object.fromEntries(ds.map((x) => [x.key, x]))

/** Root + A{A1,A2,A3{A3a,A3b}} + B */
function tree(): NodeRec[] {
  return [
    mkNode(SSD, 'SSD 1', 1, 1000),
    mkNode(SSD, 'SSD 1:A', 1, 600),
    mkNode(SSD, 'SSD 1:A:A1', 1, 100),
    mkNode(SSD, 'SSD 1:A:A2', 1, 200),
    mkNode(SSD, 'SSD 1:A:A3', 1, 300),
    mkNode(SSD, 'SSD 1:A:A3:A3a', 1, 120),
    mkNode(SSD, 'SSD 1:A:A3:A3b', 1, 180),
    mkNode(SSD, 'SSD 1:B', 1, 400),
  ]
}

const paths = (nodes: NodeRec[]) => nodes.map((n) => n.path).sort()

describe('effectiveState (nearest-ancestor-wins)', () => {
  it('inherits from the nearest decided ancestor', () => {
    const ds = decisionsOf(d('SSD 1:A', 'delete'))
    expect(effectiveState(ds, SSD, 'SSD 1:A:A3:A3a')).toBe('delete')
    expect(effectiveState(ds, SSD, 'SSD 1:B')).toBe('undecided')
  })

  it('own decision overrides the ancestor', () => {
    const ds = decisionsOf(d('SSD 1:A', 'delete'), d('SSD 1:A:A3', 'keep'))
    expect(effectiveState(ds, SSD, 'SSD 1:A:A3')).toBe('keep')
    expect(effectiveState(ds, SSD, 'SSD 1:A:A3:A3b')).toBe('keep')
    expect(effectiveState(ds, SSD, 'SSD 1:A:A1')).toBe('delete')
  })
})

describe('resolveDeletions (maximal deletable subtrees)', () => {
  it('emits a wholesale folder when nothing inside overrides', () => {
    const r = resolveDeletions(tree(), decisionsOf(d('SSD 1:A', 'delete')), SSD)
    expect(paths(r.folders)).toEqual(['SSD 1:A'])
    expect(r.partialParents).toEqual([])
  })

  it('a keep child blocks the parent — deletable siblings are emitted instead', () => {
    const ds = decisionsOf(d('SSD 1:A', 'delete'), d('SSD 1:A:A2', 'keep'))
    const r = resolveDeletions(tree(), ds, SSD)
    expect(paths(r.folders)).toEqual(['SSD 1:A:A1', 'SSD 1:A:A3'])
    expect(paths(r.partialParents)).toEqual(['SSD 1:A'])
  })

  it('recurses: a keep grandchild blocks its chain but not its siblings', () => {
    const ds = decisionsOf(d('SSD 1:A', 'delete'), d('SSD 1:A:A3:A3a', 'keep'))
    const r = resolveDeletions(tree(), ds, SSD)
    expect(paths(r.folders)).toEqual(['SSD 1:A:A1', 'SSD 1:A:A2', 'SSD 1:A:A3:A3b'])
    expect(paths(r.partialParents)).toEqual(['SSD 1:A', 'SSD 1:A:A3'])
  })

  it('review blocks wholesale deletion just like keep', () => {
    const ds = decisionsOf(d('SSD 1:A', 'delete'), d('SSD 1:A:A1', 'review'))
    const r = resolveDeletions(tree(), ds, SSD)
    expect(paths(r.folders)).toEqual(['SSD 1:A:A2', 'SSD 1:A:A3'])
  })

  it('an explicit delete inside a keep parent is still emitted', () => {
    const ds = decisionsOf(d('SSD 1:A', 'keep'), d('SSD 1:A:A3', 'delete'))
    const r = resolveDeletions(tree(), ds, SSD)
    expect(paths(r.folders)).toEqual(['SSD 1:A:A3'])
  })

  it('nothing marked → nothing emitted', () => {
    const r = resolveDeletions(tree(), {}, SSD)
    expect(r.folders).toEqual([])
    expect(r.partialParents).toEqual([])
  })

  it('undecided-with-note decisions do not block or emit', () => {
    const ds = decisionsOf(d('SSD 1:A', 'delete'), d('SSD 1:A:A2', 'undecided', 'check later'))
    const r = resolveDeletions(tree(), ds, SSD)
    expect(paths(r.folders)).toEqual(['SSD 1:A'])
  })
})
