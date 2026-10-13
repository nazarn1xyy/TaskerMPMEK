import { useEffect, useRef } from 'react'
import { create } from 'zustand'

interface Ask {
  title: string
  text?: string
  ok?: string
  resolve: (v: boolean) => void
}

const useDialog = create<{ current: Ask | null }>(() => ({ current: null }))

/** Promise-based confirm for destructive actions. */
export function ask(opts: Omit<Ask, 'resolve'>) {
  return new Promise<boolean>((resolve) => useDialog.setState({ current: { ...opts, resolve } }))
}

export function DialogHost() {
  const current = useDialog((s) => s.current)
  const okRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!current) return
    okRef.current?.focus()
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        done(false)
      }
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [current])

  if (!current) return null
  function done(v: boolean) {
    current!.resolve(v)
    useDialog.setState({ current: null })
  }
  return (
    <div className="dialog-wrap" onMouseDown={() => done(false)}>
      <div className="dialog" role="alertdialog" aria-modal onMouseDown={(e) => e.stopPropagation()}>
        <h2 className="dialog-title">{current.title}</h2>
        {current.text && <p className="dialog-text">{current.text}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost" onClick={() => done(false)}>
            Скасувати
          </button>
          <button ref={okRef} type="button" className="btn btn-danger" onClick={() => done(true)}>
            {current.ok ?? 'Видалити'}
          </button>
        </div>
      </div>
    </div>
  )
}
