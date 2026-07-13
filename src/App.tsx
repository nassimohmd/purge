import { useEffect } from 'react'
import { useStore } from './state/store'
import { parseShareId, shareUrl } from './lib/share'
import ImportScreen from './components/ImportScreen'
import FleetScreen from './components/FleetScreen'
import TriageBoard from './components/TriageBoard'
import ManifestScreen from './components/ManifestScreen'
import FocusMode from './components/FocusMode'
import SunburstDrillIn from './components/SunburstDrillIn'
import Ledger from './components/Ledger'
import HelpOverlay from './components/HelpOverlay'
import NoteEditor from './components/NoteEditor'
import Toast from './components/Toast'

export default function App() {
  const loaded = useStore((s) => s.loaded)
  const screen = useStore((s) => s.screen)
  const focusMode = useStore((s) => s.focusMode)
  const drillSsdId = useStore((s) => s.drillSsdId)
  const helpOpen = useStore((s) => s.helpOpen)
  const noteFor = useStore((s) => s.noteFor)
  const shareId = useStore((s) => s.shareId)
  const shareError = useStore((s) => s.shareError)
  const init = useStore((s) => s.init)
  const initShared = useStore((s) => s.initShared)
  const setScreen = useStore((s) => s.setScreen)
  const setHelpOpen = useStore((s) => s.setHelpOpen)

  useEffect(() => {
    const id = parseShareId()
    if (id) void initShared(id)
    else void init()
    // Boot flow runs once; init/initShared identities are stable from zustand.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
        else if (s.drillSsdId) s.setDrillSsd(null)
        else if (s.focusMode) s.setFocusMode(false)
        else if (typing) target.blur()
        else if (s.screen === 'manifest') s.setScreen('board')
        else if (s.screen === 'board') s.setScreen('fleet')
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

  if (shareError) {
    return (
      <div className="app">
        <div className="empty">
          <div>Couldn't load this shared session.</div>
          <div>{shareError}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      {shareId && (
        <div className="share-banner">
          Shared session — anyone with this link can view and mark it.
          <button
            className="ghost"
            onClick={() => void navigator.clipboard.writeText(shareUrl(shareId))}
          >
            copy link
          </button>
        </div>
      )}
      <div className="topbar">
        <span className="brand">PURGE</span>
        <nav>
          <button className={screen === 'fleet' ? 'active' : ''} onClick={() => setScreen('fleet')}>
            fleet
          </button>
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
        {screen === 'fleet' && <FleetScreen />}
        {screen === 'board' && <TriageBoard />}
        {screen === 'manifest' && <ManifestScreen />}
      </div>
      <Ledger />
      {drillSsdId && <SunburstDrillIn />}
      {focusMode && <FocusMode />}
      {helpOpen && <HelpOverlay />}
      {noteFor && <NoteEditor />}
      <Toast />
    </div>
  )
}
