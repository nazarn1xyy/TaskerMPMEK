import { useEffect, useRef, useState } from 'react'
import { GripVertical, Plus, X } from 'lucide-react'
import { uid } from '../lib/store'
import type { CheckItem } from '../lib/types'

/** Пункти й підпункти. Tab — зробити підпунктом, Shift+Tab — повернути, Enter — новий пункт. */
export function Checklist({ items: external, onChange }: { items: CheckItem[]; onChange: (items: CheckItem[]) => void }) {
  const [items, setItems] = useState(external)
  const root = useRef<HTMLDivElement>(null)
  const focusId = useRef<string | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const dragIndex = useRef<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)

  // accept remote updates unless the user is typing in here
  useEffect(() => {
    if (!root.current?.contains(document.activeElement)) setItems(external)
  }, [external])

  useEffect(() => {
    if (!focusId.current) return
    const el = root.current?.querySelector<HTMLInputElement>(`[data-item="${focusId.current}"]`)
    el?.focus()
    focusId.current = null
  })

  useEffect(() => () => clearTimeout(timer.current), [])

  const commit = (next: CheckItem[], immediate = false) => {
    setItems(next)
    clearTimeout(timer.current)
    if (immediate) onChange(next)
    else timer.current = window.setTimeout(() => onChange(next), 450)
  }

  const toggle = (i: number) => {
    const next = items.map((x) => ({ ...x }))
    const it = next[i]
    it.done = !it.done
    if (it.level === 0) {
      for (let j = i + 1; j < next.length && next[j].level === 1; j++) next[j].done = it.done
    } else {
      let p = i
      while (p > 0 && next[p].level === 1) p--
      if (next[p].level === 0) {
        const kids: CheckItem[] = []
        for (let j = p + 1; j < next.length && next[j].level === 1; j++) kids.push(next[j])
        next[p].done = kids.every((k) => k.done)
      }
    }
    commit(next, true)
  }

  const insertAfter = (i: number, level: 0 | 1) => {
    const item: CheckItem = { id: uid(), text: '', done: false, level }
    const next = [...items.slice(0, i + 1), item, ...items.slice(i + 1)]
    focusId.current = item.id
    commit(next)
  }

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>, i: number) => {
    const it = items[i]
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault()
      insertAfter(i, it.level)
    } else if (e.key === 'Tab') {
      e.preventDefault()
      const level = e.shiftKey ? 0 : i > 0 ? 1 : 0
      if (level !== it.level) commit(items.map((x, j) => (j === i ? { ...x, level } : x)))
    } else if (e.key === 'Backspace' && !it.text) {
      e.preventDefault()
      if (it.level === 1) return commit(items.map((x, j) => (j === i ? { ...x, level: 0 } : x)))
      focusId.current = items[i - 1]?.id ?? items[i + 1]?.id ?? null
      commit(items.filter((_, j) => j !== i), true)
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const dir = e.key === 'ArrowUp' ? -1 : 1
      const j = i + dir
      if (j < 0 || j >= items.length) return
      e.preventDefault()
      if (e.altKey) {
        const next = [...items]
        ;[next[i], next[j]] = [next[j], next[i]]
        focusId.current = it.id
        commit(next, true)
      } else focusId.current = items[j].id
      setItems((x) => [...x])
    }
  }

  const drop = (to: number) => {
    const from = dragIndex.current
    dragIndex.current = null
    setOverIndex(null)
    if (from === null || from === to || from + 1 === to) return
    const next = [...items]
    const [moved] = next.splice(from, 1)
    next.splice(to > from ? to - 1 : to, 0, moved)
    if (next[0]?.level === 1) next[0] = { ...next[0], level: 0 }
    commit(next, true)
  }

  const done = items.filter((x) => x.done).length

  return (
    <div className="checklist" ref={root}>
      {items.length > 0 && (
        <div className="checklist-progress">
          <span>
            {done} з {items.length}
          </span>
          <div className="bar">
            <i style={{ width: `${(done / items.length) * 100}%` }} />
          </div>
        </div>
      )}
      {items.map((it, i) => (
        <div
          key={it.id}
          className={`cl-item level-${it.level}${it.done ? ' is-done' : ''}${overIndex === i ? ' is-over' : ''}`}
          onDragOver={(e) => {
            if (dragIndex.current === null) return
            e.preventDefault()
            const b = e.currentTarget.getBoundingClientRect()
            setOverIndex(e.clientY < b.top + b.height / 2 ? i : i + 1)
          }}
          onDrop={(e) => {
            if (dragIndex.current === null) return
            e.preventDefault()
            e.stopPropagation()
            drop(overIndex ?? i)
          }}
        >
          {overIndex === items.length && i === items.length - 1 && <i className="cl-mark-after" />}
          <span
            className="cl-grip"
            draggable
            onDragStart={(e) => {
              e.stopPropagation()
              dragIndex.current = i
              e.dataTransfer.effectAllowed = 'move'
              e.dataTransfer.setData('text/x-check', it.id)
            }}
            onDragEnd={() => {
              dragIndex.current = null
              setOverIndex(null)
            }}
            aria-hidden
          >
            <GripVertical size={14} strokeWidth={1.5} />
          </span>
          <button type="button" className={`cl-box${it.done ? ' is-on' : ''}`} aria-label={it.done ? 'Зняти позначку' : 'Позначити'} onClick={() => toggle(i)}>
            <svg viewBox="0 0 16 16" aria-hidden>
              <rect x="1.5" y="1.5" width="13" height="13" rx="3" />
              {it.done && <path d="M4.5 8.3l2.3 2.3 4.7-5" />}
            </svg>
          </button>
          <input
            data-item={it.id}
            className="cl-text"
            value={it.text}
            placeholder={it.level ? 'Підпункт' : 'Пункт'}
            onChange={(e) => commit(items.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
            onKeyDown={(e) => onKey(e, i)}
            onBlur={() => {
              clearTimeout(timer.current)
              if (JSON.stringify(items) !== JSON.stringify(external)) onChange(items)
            }}
          />
          <button type="button" className="icon-btn cl-del" aria-label="Видалити пункт" onClick={() => commit(items.filter((_, j) => j !== i), true)}>
            <X size={14} strokeWidth={1.6} />
          </button>
        </div>
      ))}
      <button type="button" className="add-row add-row-sm" onClick={() => insertAfter(items.length - 1, 0)}>
        <Plus size={14} strokeWidth={1.6} />
        <span>{items.length ? 'Пункт' : 'Розбити на пункти'}</span>
      </button>
      {items.length > 0 && <p className="hint">Tab — підпункт · Shift+Tab — назад · Alt+↑↓ — переставити</p>}
    </div>
  )
}
