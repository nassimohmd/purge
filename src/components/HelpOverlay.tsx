import { useStore } from '../state/store'

const KEYS: [string, string][] = [
  ['j / k or ↓ / ↑', 'move focus'],
  ['enter', 'expand / open focus'],
  ['x', 'toggle multi-select'],
  ['u', 'clear decision'],
  ['/', 'jump to search'],
  ['esc', 'close / back'],
  ['space', 'enter Focus Mode on focused row'],
  ['d', 'mark delete'],
  ['f', 'mark keep'],
  ['r', 'mark review'],
  ['n', 'add / edit note'],
  ['g', 'cycle SSD filter'],
  ['v', 'toggle sunburst panel (board)'],
  ['o', 'open sunburst drill-in'],
  ['m', 'open manifest screen'],
  ['z', 'undo last marking'],
  ['?', 'this overlay'],
]

const FLEET_KEYS: [string, string][] = [
  ['j / k / h / l or arrows', 'move between SSD cards'],
  ['enter', 'triage the focused SSD'],
  ['o', 'sunburst for the focused SSD'],
  ['esc (on board)', 'back to fleet'],
]

export default function HelpOverlay() {
  const setHelpOpen = useStore((s) => s.setHelpOpen)
  return (
    <div className="overlay" onClick={() => setHelpOpen(false)}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <h2>Keyboard</h2>
        <div className="keymap">
          {KEYS.map(([k, desc]) => (
            <span key={k} style={{ display: 'contents' }}>
              <kbd>{k}</kbd>
              <span>{desc}</span>
            </span>
          ))}
        </div>
        <h2 style={{ marginTop: 16 }}>Fleet</h2>
        <div className="keymap">
          {FLEET_KEYS.map(([k, desc]) => (
            <span key={k} style={{ display: 'contents' }}>
              <kbd>{k}</kbd>
              <span>{desc}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
