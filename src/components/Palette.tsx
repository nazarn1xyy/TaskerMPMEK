import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { CornerDownLeft } from 'lucide-react'
import { addTask, signIn, useStore } from '../lib/store'
import { go, openTask, type Route } from '../lib/router'
import { parseQuickAdd } from '../lib/parse'
import { useLiveTasks, useMembers, useProjects } from '../lib/hooks'
import { monthStart, relDay, todayIso, weekStart } from '../lib/dates'
import type { Task } from '../lib/types'
import { toggleTheme } from './Sidebar'
import { Kbd } from './ui'

interface Item {
  key: string
  group: string
  label: ReactNode
  hint?: ReactNode
  run: () => void
}

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е')

export function Palette({ mode, defaults, onClose }: { mode: 'search' | 'create'; defaults: Partial<Task>; onClose: () => void }) {
  const [text, setText] = useState('')
  const [sel, setSel] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const me = useStore((s) => s.me)
  const members = useMembers()
  const projects = useProjects()
  const tasks = useLiveTasks()
  const today = todayIso()

  useEffect(() => input.current?.focus(), [])

  const parsed = useMemo(() => (text.trim() ? parseQuickAdd(text, { members, projects, me }) : null), [text, members, projects, me])

  const create = () => {
    if (!parsed) return
    const t = addTask({ ...defaults, ...parsed.patch, title: parsed.title, tags: [...(defaults.tags ?? []), ...(parsed.patch.tags ?? [])] })
    onClose()
    openTask(t.id)
  }

  const items = useMemo<Item[]>(() => {
    const q = norm(text.trim())
    const out: Item[] = []
    if (parsed) {
      out.push({
        key: 'create',
        group: 'Створити',
        label: (
          <>
            Завдання «{parsed.title}»
          </>
        ),
        hint: parsed.hints.length ? parsed.hints.join(' · ') : defaults.date ? relDay(defaults.date) : 'без терміну',
        run: create,
      })
    }
    if (mode === 'create' && !q) return out

    const nav: [string, Route | (() => void)][] = [
      ['Сьогодні', { name: 'tasks', period: 'day', date: today }],
      ['Тиждень', { name: 'tasks', period: 'week', date: weekStart(today) }],
      ['Місяць', { name: 'tasks', period: 'month', date: monthStart(today) }],
      ['Усі завдання', { name: 'tasks', period: 'all', date: today }],
      ['Календар', { name: 'calendar', mode: 'month', date: monthStart(today) }],
      ['Календар на тиждень', { name: 'calendar', mode: 'week', date: weekStart(today) }],
      ['Статистика', { name: 'stats' }],
      ['Проєкти', { name: 'projects' }],
      ['Команда', { name: 'team' }],
      ['Змінити тему', toggleTheme],
      ['Змінити учасника', () => signIn(null)],
    ]
    for (const [label, target] of nav) {
      if (q && !norm(label).includes(q)) continue
      out.push({ key: `nav-${label}`, group: 'Перейти', label, run: () => (typeof target === 'function' ? target() : go(target), onClose()) })
    }
    if (q) {
      for (const p of projects) if (norm(p.name).includes(q)) out.push({ key: p.id, group: 'Проєкти', label: p.name, run: () => (go({ name: 'project', id: p.id }), onClose()) })
      for (const m of members) if (norm(m.name).includes(q)) out.push({ key: m.id, group: 'Люди', label: m.name, run: () => (go({ name: 'member', id: m.id }), onClose()) })
      const found = tasks
        .filter((t) => norm(t.title).includes(q) || norm(t.notes).includes(q))
        .sort((a, b) => (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1) || b.updatedAt - a.updatedAt)
        .slice(0, 8)
      for (const t of found)
        out.push({
          key: t.id,
          group: 'Завдання',
          label: <span className={t.status !== 'open' ? 'is-closed' : ''}>{t.title}</span>,
          hint: [t.assigneeId && members.find((m) => m.id === t.assigneeId)?.name, t.status === 'done' ? 'виконано' : t.status === 'cancelled' ? 'скасовано' : null].filter(Boolean).join(' · '),
          run: () => (openTask(t.id), onClose()),
        })
    }
    return out
  }, [text, parsed, mode, today, projects, members, tasks, defaults])

  useEffect(() => setSel(0), [text])
  useEffect(() => {
    list.current?.querySelector(`[data-i="${sel}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') (e.preventDefault(), setSel((s) => Math.min(items.length - 1, s + 1)))
    else if (e.key === 'ArrowUp') (e.preventDefault(), setSel((s) => Math.max(0, s - 1)))
    else if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault()
      if (e.metaKey || e.ctrlKey) create()
      else items[sel]?.run()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
  }

  let lastGroup = ''
  return createPortal(
    <div className="palette-wrap" onMouseDown={onClose}>
      <div className="palette" role="dialog" aria-label={mode === 'create' ? 'Нове завдання' : 'Пошук і команди'} onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={input}
          className="palette-input"
          value={text}
          placeholder={mode === 'create' ? 'Нове завдання: «звіт для клієнта в пт до 18:00 @імʼя #проєкт !!»' : 'Знайти завдання, проєкт, людину — або написати нове завдання'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
        />
        {items.length > 0 && (
          <div className="palette-list" ref={list}>
            {items.map((it, i) => {
              const head = it.group !== lastGroup ? it.group : null
              lastGroup = it.group
              return (
                <div key={it.key}>
                  {head && <div className="palette-group">{head}</div>}
                  <button type="button" data-i={i} className={`palette-item${i === sel ? ' is-sel' : ''}`} onMouseMove={() => setSel(i)} onClick={it.run}>
                    <span className="palette-label">{it.label}</span>
                    {it.hint && <span className="palette-hint">{it.hint}</span>}
                    {i === sel && <CornerDownLeft size={14} strokeWidth={1.6} className="palette-enter" />}
                  </button>
                </div>
              )
            })}
          </div>
        )}
        <div className="palette-foot">
          <span>
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> вибрати
          </span>
          <span>
            <Kbd>↵</Kbd> відкрити
          </span>
          {parsed && (
            <span>
              <Kbd>⌘</Kbd>
              <Kbd>↵</Kbd> створити завдання
            </span>
          )}
          <span>
            <Kbd>esc</Kbd> закрити
          </span>
        </div>
      </div>
    </div>,
    document.body,
  )
}
