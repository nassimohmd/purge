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
  ['m', 'open manifest screen'],
  ['z', 'undo last marking'],
  ['?', 'this overlay'],
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
      </div>
    </div>
  )
}
