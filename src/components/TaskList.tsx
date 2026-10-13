import { memo, useCallback, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import { ListChecks, MessageSquare, MoreHorizontal, Paperclip, Plus, Repeat } from 'lucide-react'
import { addTask, duplicateTask, removeTask, setStatus, updateTask, useStore } from '../lib/store'
import { openTask, useLocation } from '../lib/router'
import { drag, useTaskDrop } from '../lib/dnd'
import { isOverdue, relDay, relMonth, relWeek, todayIso } from '../lib/dates'
import type { Section } from '../lib/filters'
import { parseQuickAdd } from '../lib/parse'
import { useMembers, useProjects, useTaskCounters } from '../lib/hooks'
import type { Member, Status, Task } from '../lib/types'
import { Avatar, Menu, Popover, type MenuItem } from './ui'

export interface ListOptions {
  showAssignee?: boolean
  showProject?: boolean
  /** Hide the “add” rows (e.g. read-only summaries). */
  readOnly?: boolean
}

export function TaskSections({ sections, options = {} }: { sections: Section[]; options?: ListOptions }) {
  const { task: openId } = useLocation()
  return (
    <div className="sections">
      {sections.map((s) => (
        <SectionBlock key={s.key} section={s} options={options} openId={openId} />
      ))}
    </div>
  )
}

function orderAt(list: Task[], index: number) {
  const open = list.filter((t) => t.status === 'open')
  const i = Math.min(index, open.length)
  const prev = open[i - 1]
  const next = open[i]
  if (prev && next) return (prev.order + next.order) / 2
  if (prev) return prev.order + 1
  if (next) return next.order - 1
  return Date.now()
}

const SectionBlock = memo(function SectionBlock({ section, options, openId }: { section: Section; options: ListOptions; openId: string | null }) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const [mark, setMark] = useState<number | null>(null)

  const indexAt = (y: number) => {
    const rows = [...(bodyRef.current?.querySelectorAll<HTMLElement>('[data-row]') ?? [])]
    const i = rows.findIndex((r) => {
      const b = r.getBoundingClientRect()
      return y < b.top + b.height / 2
    })
    return i < 0 ? rows.length : i
  }

  const { over, props } = useTaskDrop((id, e) => {
    const t = useStore.getState().tasks[id]
    if (!t) return
    const others = section.tasks.filter((x) => x.id !== id)
    const idx = indexAt(e.clientY)
    const removedBefore = section.tasks.slice(0, idx).some((x) => x.id === id) ? 1 : 0
    const inside = section.tasks.some((x) => x.id === id)
    const patch: Partial<Task> = { order: orderAt(others, idx - removedBefore) }
    if (!inside && section.drop) Object.assign(patch, section.drop)
    updateTask(id, patch)
    setMark(null)
  })

  const onDragOver = (e: DragEvent) => {
    props.onDragOver(e)
    if (drag.id) setMark(indexAt(e.clientY))
  }

  const dayCtx = section.create?.scope === 'day' ? (section.create.date ?? undefined) : undefined
  const bandCtx = ['scope-week', 'scope-month', 'week', 'nextweek', 'month'].includes(section.key)

  return (
    <section className={`section${over ? ' is-over' : ''}${section.tone ? ` tone-${section.tone}` : ''}`} {...props} onDragOver={onDragOver} onDragLeave={(e) => { props.onDragLeave(); if (!e.currentTarget.contains(e.relatedTarget as Node)) setMark(null) }}>
      <header className="section-head">
        <h3 className="section-label">{section.label}</h3>
        <span className="section-count">{section.tasks.filter((t) => t.status === 'open').length || ''}</span>
        {section.sub && <span className="section-sub">{section.sub}</span>}
      </header>
      <div className="section-body" ref={bodyRef}>
        {section.tasks.map((t, i) => (
          <div key={t.id} className="row-slot">
            {over && mark === i && <div className="drop-mark" />}
            <TaskRowConnected task={t} selected={openId === t.id} options={options} dayCtx={dayCtx} bandCtx={bandCtx} />
          </div>
        ))}
        {over && mark !== null && mark >= section.tasks.length && <div className="drop-mark" />}
        {!section.tasks.length && <div className="section-empty">{section.drop ? 'Порожньо — перетягніть сюди завдання' : 'Порожньо'}</div>}
        {!options.readOnly && section.create && <AddRow defaults={section.create} />}
      </div>
    </section>
  )
})

function TaskRowConnected(props: { task: Task; selected: boolean; options: ListOptions; dayCtx?: string; bandCtx?: boolean }) {
  const { task } = props
  const assignee = useStore((s) => (task.assigneeId ? s.members[task.assigneeId] : undefined))
  const project = useStore((s) => (task.projectId ? s.projects[task.projectId] : undefined))
  const online = useStore((s) => (task.assigneeId ? s.presence.includes(task.assigneeId) : false))
  const counters = useTaskCounters()
  return (
    <TaskRow
      {...props}
      assignee={props.options.showAssignee ? assignee : undefined}
      online={online}
      projectName={props.options.showProject !== false ? project?.name : undefined}
      files={counters.files.get(task.id) ?? 0}
      notes={counters.notes.get(task.id) ?? 0}
    />
  )
}

export function dateText(t: Task, dayCtx?: string, bandCtx?: boolean) {
  const today = todayIso()
  const parts: string[] = []
  if (t.scope === 'day' && t.date && t.date !== dayCtx) parts.push(relDay(t.date, today))
  if (t.scope === 'week' && t.date && !bandCtx) parts.push(relWeek(t.date, today).replace('Тиждень ', 'тиж. '))
  if (t.scope === 'month' && t.date && !bandCtx) parts.push(relMonth(t.date, today))
  if (t.due) {
    const sameDay = t.due === dayCtx || (t.scope === 'day' && t.due === t.date)
    if (sameDay) {
      if (t.dueTime) parts.push(t.dueTime)
    } else {
      parts.push(`до ${relDay(t.due, today).toLowerCase()}${t.dueTime ? ` ${t.dueTime}` : ''}`)
    }
  }
  return parts.join(' · ')
}

export const CheckButton = memo(function CheckButton({ task, size = 18 }: { task: Pick<Task, 'id' | 'status' | 'priority' | 'title'>; size?: number }) {
  return (
    <button
      type="button"
      className={`check is-${task.status} p${task.priority}`}
      style={{ width: size, height: size }}
      aria-label={task.status === 'done' ? `Повернути «${task.title}» в роботу` : `Позначити «${task.title}» виконаним`}
      aria-pressed={task.status === 'done'}
      onClick={(e) => {
        e.stopPropagation()
        setStatus(task.id, task.status === 'open' ? 'done' : 'open')
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <svg viewBox="0 0 20 20" aria-hidden>
        <circle cx="10" cy="10" r="8.25" />
        {task.status === 'done' && <path d="M6.2 10.4l2.5 2.5 5.1-5.6" />}
        {task.status === 'cancelled' && <path d="M5.5 14.5l9-9" />}
      </svg>
    </button>
  )
})

export function statusMenu(task: Task, extra = true): MenuItem[] {
  const status = (s: Status, label: string, hint?: string): MenuItem => ({ key: s, label, hint, checked: task.status === s, onSelect: () => setStatus(task.id, s) })
  const items = [status('open', 'Не виконано'), status('done', 'Виконано', 'X'), status('cancelled', 'Скасовано')]
  if (!extra) return items
  return [
    ...items,
    { key: 'd1', label: '', divider: true },
    { key: 'open-task', label: 'Відкрити', hint: '↵', onSelect: () => openTask(task.id) },
    { key: 'dup', label: 'Дублювати', onSelect: () => duplicateTask(task.id) },
    { key: 'del', label: 'Видалити', hint: '⌫', danger: true, onSelect: () => removeTask(task.id) },
  ]
}

interface RowProps {
  task: Task
  selected: boolean
  options: ListOptions
  dayCtx?: string
  bandCtx?: boolean
  assignee?: Member
  online?: boolean
  projectName?: string
  files: number
  notes: number
}

export const TaskRow = memo(function TaskRow({ task, selected, dayCtx, bandCtx, assignee, online, projectName, files, notes }: RowProps) {
  const rowRef = useRef<HTMLDivElement>(null)
  const moreRef = useRef<HTMLButtonElement>(null)
  const [menu, setMenu] = useState(false)
  const date = dateText(task, dayCtx, bandCtx)
  const overdue = isOverdue(task)
  const checklist = task.checklist.length ? `${task.checklist.filter((c) => c.done).length}/${task.checklist.length}` : null

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return
    const focusSibling = (dir: 1 | -1) => {
      const rows = [...document.querySelectorAll<HTMLElement>('[data-row]')]
      rows[rows.indexOf(e.currentTarget) + dir]?.focus()
    }
    if (e.key === 'ArrowDown' || e.key === 'j') (e.preventDefault(), focusSibling(1))
    else if (e.key === 'ArrowUp' || e.key === 'k') (e.preventDefault(), focusSibling(-1))
    else if (e.key === 'Enter') openTask(task.id)
    else if (e.key === 'x' || e.key === 'ч') setStatus(task.id, task.status === 'done' ? 'open' : 'done')
    else if (e.key === 'Backspace' || e.key === 'Delete') {
      focusSibling(1)
      removeTask(task.id)
    }
  }

  return (
    <div
      ref={rowRef}
      data-row={task.id}
      tabIndex={0}
      className={`row is-${task.status}${selected ? ' is-selected' : ''}`}
      draggable
      onDragStart={(e) => drag.start(e, task.id)}
      onDragEnd={() => drag.end()}
      onClick={() => openTask(task.id)}
      onKeyDown={onKey}
      onContextMenu={(e) => {
        e.preventDefault()
        setMenu(true)
      }}
    >
      <CheckButton task={task} />
      <div className="row-main">
        <span className="row-title">{task.title || <span className="muted">Без назви</span>}</span>
        <span className="row-meta">
          {projectName && <span className="row-project">{projectName}</span>}
          {checklist && (
            <span className="meta-item" title="Пункти">
              <ListChecks size={13} strokeWidth={1.6} />
              {checklist}
            </span>
          )}
          {task.steps && task.steps.total > 0 && (
            <span className="meta-item" title="Кроки">
              {task.steps.done}/{task.steps.total} кр.
            </span>
          )}
          {files > 0 && (
            <span className="meta-item" title="Файли">
              <Paperclip size={13} strokeWidth={1.6} />
              {files}
            </span>
          )}
          {notes > 0 && (
            <span className="meta-item" title="Коментарі">
              <MessageSquare size={13} strokeWidth={1.6} />
              {notes}
            </span>
          )}
          {task.repeat !== 'none' && (
            <span className="meta-item" title="Повторюється">
              <Repeat size={13} strokeWidth={1.6} />
            </span>
          )}
          {task.tags.map((tag) => (
            <span key={tag} className="row-tag">
              #{tag}
            </span>
          ))}
          {task.status === 'cancelled' && <span className="row-tag">скасовано</span>}
        </span>
      </div>
      <div className="row-side">
        {task.priority > 0 && <span className={`prio p${task.priority}`}>{'!'.repeat(task.priority)}</span>}
        {date && <span className={`row-date${overdue ? ' is-overdue' : ''}`}>{date}</span>}
        {assignee && <Avatar member={assignee} size={20} online={online} />}
        <button
          ref={moreRef}
          type="button"
          className="row-more icon-btn"
          aria-label="Дії"
          onClick={(e) => {
            e.stopPropagation()
            setMenu((v) => !v)
          }}
        >
          <MoreHorizontal size={16} strokeWidth={1.6} />
        </button>
      </div>
      {menu && (
        <Popover anchor={moreRef.current} onClose={() => setMenu(false)} placement="bottom-end">
          <div onClick={(e) => e.stopPropagation()}>
            <Menu items={statusMenu(task)} onDone={() => setMenu(false)} />
          </div>
        </Popover>
      )}
    </div>
  )
})

export function AddRow({ defaults, placeholder = 'Додати завдання', autoFocus, onCreated }: { defaults: Partial<Task>; placeholder?: string; autoFocus?: boolean; onCreated?: (t: Task) => void }) {
  const [open, setOpen] = useState(Boolean(autoFocus))
  const [text, setText] = useState('')
  const members = useMembers()
  const projects = useProjects()
  const me = useStore((s) => s.me)
  const parsed = useMemo(() => (text.trim() ? parseQuickAdd(text, { members, projects, me }) : null), [text, members, projects, me])

  const submit = useCallback(() => {
    if (!parsed) return
    const t = addTask({ ...defaults, ...parsed.patch, title: parsed.title, tags: [...(defaults.tags ?? []), ...(parsed.patch.tags ?? [])] })
    setText('')
    onCreated?.(t)
  }, [parsed, defaults, onCreated])

  if (!open) {
    return (
      <button type="button" className="add-row" onClick={() => setOpen(true)}>
        <Plus size={15} strokeWidth={1.6} />
        <span>{placeholder}</span>
      </button>
    )
  }
  return (
    <div className="add-input">
      <Plus size={15} strokeWidth={1.6} />
      <div className="add-field">
        <input
          autoFocus
          value={text}
          placeholder="Наприклад: дзвінок клієнту завтра о 11:00 @імʼя #проєкт !!"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit()
            if (e.key === 'Escape') {
              setText('')
              setOpen(false)
            }
          }}
          onBlur={() => !text && setOpen(false)}
        />
        {parsed && parsed.hints.length > 0 && <div className="parse-hints">{parsed.hints.join('  ·  ')}</div>}
      </div>
    </div>
  )
}
