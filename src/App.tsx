import { useEffect } from 'react'
import { useStore } from './state/store'
import ImportScreen from './components/ImportScreen'
import TriageBoard from './components/TriageBoard'
import ManifestScreen from './components/ManifestScreen'
import FocusMode from './components/FocusMode'
import Ledger from './components/Ledger'
import HelpOverlay from './components/HelpOverlay'
import NoteEditor from './components/NoteEditor'
import Toast from './components/Toast'

export default function App() {
  const loaded = useStore((s) => s.loaded)
  const screen = useStore((s) => s.screen)
  const focusMode = useStore((s) => s.focusMode)
  const helpOpen = useStore((s) => s.helpOpen)
  const noteFor = useStore((s) => s.noteFor)
  const init = useStore((s) => s.init)
  const setScreen = useStore((s) => s.setScreen)
  const setHelpOpen = useStore((s) => s.setHelpOpen)

  useEffect(() => {
    void init()
  }, [init])

  // Global keys that work on every screen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const typing =
        target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
      if (e.key === 'Escape') {
        const s = useStore.getState()
        if (s.helpOpen) s.setHelpOpen(false)
        else if (s.noteFor) s.closeNoteEditor()
        else if (s.focusMode) s.setFocusMode(false)
        else if (typing) target.blur()
        else if (s.screen === 'manifest') s.setScreen('board')
        return
      }
      if (typing) return
      if (e.key === '?') {
        e.preventDefault()
        setHelpOpen(!useStore.getState().helpOpen)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setHelpOpen])

  if (!loaded) {
    return <div className="app" />
  }

  return (
    <div className="app">
      <div className="topbar">
        <span className="brand">PURGE</span>
        <nav>
          <button className={screen === 'board' ? 'active' : ''} onClick={() => setScreen('board')}>
            triage
          </button>
          <button
            className={screen === 'manifest' ? 'active' : ''}
            onClick={() => setScreen('manifest')}
          >
            manifest
          </button>
          <button
            className={screen === 'import' ? 'active' : ''}
            onClick={() => setScreen('import')}
          >
            import
          </button>
        </nav>
        <span className="spacer" />
        <span className="hint">? for keys</span>
      </div>
      <div className="app-main">
        {screen === 'import' && <ImportScreen />}
        {screen === 'board' && <TriageBoard />}
        {screen === 'manifest' && <ManifestScreen />}
      </div>
      <Ledger />
      {focusMode && <FocusMode />}
      {helpOpen && <HelpOverlay />}
      {noteFor && <NoteEditor />}
      <Toast />
    </div>
  )
}
