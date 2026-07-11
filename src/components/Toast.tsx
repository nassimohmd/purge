import { useEffect, useState } from 'react'
import { useStore } from '../state/store'

const TOAST_MS = 5000

export default function Toast() {
  const toast = useStore((s) => s.toast)
  const clearToast = useStore((s) => s.clearToast)
  const undo = useStore((s) => s.undo)
  const [, force] = useState(0)

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => {
      // Only clear if this is still the same toast.
      if (useStore.getState().toast === toast) clearToast()
      force((n) => n + 1)
    }, TOAST_MS)
    return () => clearTimeout(t)
  }, [toast, clearToast])

  if (!toast) return null
  return (
    <div className="toast">
      <span>{toast.msg}</span>
      {toast.undoable && (
        <button className="undo" onClick={undo}>
          undo (z)
        </button>
      )}
    </div>
  )
}
