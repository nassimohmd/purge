import type { Decision, DecisionState, NodeRec } from './types'
import { dkey } from './types'

/**
 * Effective state of a path under nearest-ancestor-wins: its own explicit
 * decision if any, else the nearest ancestor's.
 */
export function effectiveState(
  decisions: Record<string, Decision>,
  ssdId: string,
  path: string,
): DecisionState {
  let p: string | null = path
  while (p !== null) {
    const d = decisions[dkey(ssdId, p)]
    if (d && d.state !== 'undecided') return d.state
    const i = p.lastIndexOf(':')
    p = i === -1 ? null : p.slice(0, i)
  }
  return 'undecided'
}

export interface ResolvedDeletions {
  /** Maximal fully-deletable folder subtrees — safe to `rm -rf` wholesale. */
  folders: NodeRec[]
  /**
   * Delete-marked folders that could NOT be emitted wholesale because a
   * descendant is kept/under review. Their direct child FILES are still
   * deletable and belong in the manifest.
   */
  partialParents: NodeRec[]
}

/**
 * Resolve folder decisions into the maximal deletable subtrees.
 *
 * A folder is emitted iff its effective state is `delete` and no descendant
 * folder has an explicit `keep` or `review` overriding it. A `keep` child
 * inside a `delete` parent means the parent cannot be deleted wholesale — the
 * deletable siblings are emitted instead, recursively.
 */
export function resolveDeletions(
  folders: NodeRec[],
  decisions: Record<string, Decision>,
  ssdId: string,
): ResolvedDeletions {
  const children = new Map<string, NodeRec[]>()
  const roots: NodeRec[] = []
  for (const f of folders) {
    if (f.depth === 0) continue
    if (f.depth === 1) roots.push(f)
    if (f.parentPath !== null) {
      const arr = children.get(f.parentPath)
      if (arr) arr.push(f)
      else children.set(f.parentPath, [f])
    }
  }

  const explicit = (path: string): DecisionState | null => {
    const d = decisions[dkey(ssdId, path)]
    return d && d.state !== 'undecided' ? d.state : null
  }

  const blockerMemo = new Map<string, boolean>()
  const hasBlocker = (path: string): boolean => {
    const memo = blockerMemo.get(path)
    if (memo !== undefined) return memo
    let blocked = false
    for (const c of children.get(path) ?? []) {
      const e = explicit(c.path)
      if (e === 'keep' || e === 'review' || hasBlocker(c.path)) {
        blocked = true
        break
      }
    }
    blockerMemo.set(path, blocked)
    return blocked
  }

  const out: ResolvedDeletions = { folders: [], partialParents: [] }
  const walk = (node: NodeRec, inherited: DecisionState) => {
    const own = explicit(node.path) ?? inherited
    if (own === 'delete') {
      if (!hasBlocker(node.path)) {
        out.folders.push(node)
        return
      }
      out.partialParents.push(node)
    }
    for (const c of children.get(node.path) ?? []) walk(c, own)
  }
  for (const r of roots) walk(r, 'undecided')
  return out
}
