import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { CornerDownLeft } from 'lucide-react'
import { addTask, signIn, toast, useStore } from '../lib/store'
import { go, openTask, type Route } from '../lib/router'
import { parseQuickAdd } from '../lib/parse'
import { COMPACT, useLiveTasks, useMedia, useMembers, useProjects } from '../lib/hooks'
import { addDays, monthStart, relDay, todayIso, weekStart } from '../lib/dates'
import type { Task } from '../lib/types'
import { toggleTheme } from './Sidebar'
import { Avatar, Kbd } from './ui'

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
  const compact = useMedia(COMPACT)

  // One-tap alternatives to the «@імʼя #проєкт завтра» syntax — the only sane way to set these on a phone keyboard.
  const [pick, setPick] = useState<Partial<Task>>({})
  const [when, setWhen] = useState<string | null>(null)
  const whenOptions: [string, string, Partial<Task>][] = [
    ['today', 'Сьогодні', { scope: 'day', date: today }],
    ['tomorrow', 'Завтра', { scope: 'day', date: addDays(today, 1) }],
    ['week', 'Цей тиждень', { scope: 'week', date: weekStart(today) }],
    ['none', 'Без терміну', { scope: 'none', date: null, due: null, dueTime: null }],
  ]
  const whenPatch = whenOptions.find(([k]) => k === when)?.[2] ?? {}
  // show which «when» the task will actually get, even if it came from the page context or the typed text
  const base = { ...defaults, ...parsed?.patch }
  const shownWhen =
    when ??
    whenOptions.find(([, , p]) => (p.scope === 'none' ? (base.scope ?? 'none') === 'none' && !base.due : p.scope === base.scope && p.date === base.date))?.[0] ??
    null
  const assignee = 'assigneeId' in pick ? pick.assigneeId : (parsed?.patch.assigneeId ?? defaults.assigneeId)
  const project = 'projectId' in pick ? pick.projectId : (parsed?.patch.projectId ?? defaults.projectId)
  const priority = pick.priority ?? parsed?.patch.priority ?? 0

  const create = (keepOpen = false) => {
    if (!parsed) return
    const t = addTask({ ...defaults, ...parsed.patch, ...whenPatch, ...pick, title: parsed.title, tags: [...(defaults.tags ?? []), ...(parsed.patch.tags ?? [])] })
    if (keepOpen) {
      setText('')
      toast(`Додано: «${t.title}»`, { label: 'Відкрити', run: () => openTask(t.id) })
      input.current?.focus()
      return
    }
    onClose()
    if (compact) toast(`Додано: «${t.title}»`, { label: 'Відкрити', run: () => openTask(t.id) })
    else openTask(t.id)
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
        run: () => create(),
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
      if (e.metaKey || e.ctrlKey || mode === 'create') create(e.shiftKey)
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
          placeholder={mode === 'create' ? (compact ? 'Нове завдання' : 'Нове завдання: «звіт для клієнта в пт до 18:00 @імʼя #проєкт !!»') : compact ? 'Пошук або нове завдання' : 'Знайти завдання, проєкт, людину — або написати нове завдання'}
          enterKeyHint={mode === 'create' ? 'done' : 'go'}
          autoComplete="off"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
        />
        {mode === 'create' && (
          <div className="quick">
            <div className="quick-row">
              {whenOptions.map(([k, label]) => (
                <button key={k} type="button" className="quick-chip" aria-pressed={shownWhen === k} onClick={() => setWhen(k)}>
                  {label}
                </button>
              ))}
            </div>
            <div className="quick-row">
              {members.map((m) => (
                <button key={m.id} type="button" className="quick-chip" aria-pressed={assignee === m.id} onClick={() => setPick({ ...pick, assigneeId: m.id })}>
                  <Avatar member={m} size={18} />
                  {m.id === me ? 'Я' : m.name.split(' ')[0]}
                </button>
              ))}
            </div>
            {projects.length > 0 && (
              <div className="quick-row">
                {projects.map((p) => (
                  <button key={p.id} type="button" className="quick-chip" aria-pressed={project === p.id} onClick={() => setPick({ ...pick, projectId: project === p.id ? null : p.id })}>
                    {p.name}
                  </button>
                ))}
              </div>
            )}
            <div className="quick-row quick-last">
              {[1, 2, 3].map((p) => (
                <button key={p} type="button" className={`quick-chip prio p${p}`} aria-pressed={priority === p} onClick={() => setPick({ ...pick, priority: (priority === p ? 0 : p) as Task['priority'] })}>
                  {'!'.repeat(p)}
                </button>
              ))}
              <button type="button" className="btn btn-sm quick-add" disabled={!parsed} onClick={() => create()}>
                Додати
              </button>
            </div>
          </div>
        )}
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
