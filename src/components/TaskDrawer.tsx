import { useEffect, useRef, useState } from 'react'
import { Copy, Link2, Minus, MoreHorizontal, Plus, Trash2, X } from 'lucide-react'
import { addProject, duplicateTask, removeTask, setStatus, updateTask, uploadFiles, useStore, toast } from '../lib/store'
import { openTask } from '../lib/router'
import { iso, isOverdue, longDate, timeAgo, todayIso } from '../lib/dates'
import { useMembers, useProjects } from '../lib/hooks'
import type { Priority, Repeat, Status, Task } from '../lib/types'
import { AutoText, Avatar, Menu, PopButton, Segmented } from './ui'
import { DeadlinePicker, deadlineLabel, WhenPicker, whenLabel } from './DatePicker'
import { Checklist } from './Checklist'
import { Files } from './Files'
import { Comments, History } from './Comments'

export const PRIORITY_LABEL = ['Без пріоритету', 'Низький', 'Середній', 'Високий']
export const REPEAT_LABEL: Record<Repeat, string> = {
  none: 'Не повторювати',
  daily: 'Щодня',
  weekdays: 'По буднях',
  weekly: 'Щотижня',
  monthly: 'Щомісяця',
}

export function TaskDrawer({ id }: { id: string }) {
  const task = useStore((s) => s.tasks[id])
  const close = () => openTask(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      const el = document.activeElement as HTMLElement | null
      if (el && el.closest('.drawer') && ['INPUT', 'TEXTAREA'].includes(el.tagName)) {
        el.blur()
        return
      }
      close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // paste screenshots straight into the open task
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? [])
      if (!files.length) return
      const el = e.target as HTMLElement
      if (el.closest?.('.composer')) return
      e.preventDefault()
      uploadFiles(files, 'task', id)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [id])

  if (!task || task.deletedAt) {
    return (
      <aside className="drawer">
        <div className="drawer-top">
          <span />
          <button type="button" className="icon-btn" onClick={close} aria-label="Закрити">
            <X size={18} strokeWidth={1.6} />
          </button>
        </div>
        <p className="drawer-empty">{task ? 'Завдання видалено.' : 'Завдання не знайдено — можливо, його видалили.'}</p>
        {task && (
          <button type="button" className="btn" onClick={() => updateTask(task.id, { deletedAt: null })}>
            Відновити
          </button>
        )}
      </aside>
    )
  }
  return <DrawerBody key={task.id} task={task} onClose={close} />
}

function DrawerBody({ task, onClose }: { task: Task; onClose: () => void }) {
  const members = useMembers()
  const projects = useProjects()
  const allMembers = useStore((s) => s.members)
  const presence = useStore((s) => s.presence)
  const patch = (p: Partial<Task>) => updateTask(task.id, p)
  const [tab, setTab] = useState<'comments' | 'history'>('comments')

  const [title, setTitle] = useState(task.title)
  const [notes, setNotes] = useState(task.notes)
  const titleTimer = useRef<number | undefined>(undefined)
  const notesTimer = useRef<number | undefined>(undefined)
  const editing = useRef<'title' | 'notes' | null>(null)

  useEffect(() => {
    if (editing.current !== 'title') setTitle(task.title)
  }, [task.title])
  useEffect(() => {
    if (editing.current !== 'notes') setNotes(task.notes)
  }, [task.notes])

  const latest = useRef({ title, notes })
  latest.current = { title, notes }
  useEffect(
    () => () => {
      clearTimeout(titleTimer.current)
      clearTimeout(notesTimer.current)
      const cur = useStore.getState().tasks[task.id]
      if (!cur) return
      const p: Partial<Task> = {}
      if (latest.current.title.trim() && latest.current.title !== cur.title) p.title = latest.current.title.trim()
      if (latest.current.notes !== cur.notes) p.notes = latest.current.notes
      if (Object.keys(p).length) updateTask(task.id, p)
    },
    [task.id],
  )

  const assignee = task.assigneeId ? allMembers[task.assigneeId] : null
  const creator = task.createdBy ? allMembers[task.createdBy] : null
  const completer = task.completedBy ? allMembers[task.completedBy] : null
  const project = task.projectId ? projects.find((p) => p.id === task.projectId) : null
  const overdue = isOverdue(task)

  // Phones: pull the sheet down by its header to close it, like any native sheet.
  const [pull, setPull] = useState(0)
  const pullStart = useRef<number | null>(null)
  const pullHandlers = {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType !== 'touch' || (e.target as HTMLElement).closest('button')) return
      pullStart.current = e.clientY
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    onPointerMove: (e: React.PointerEvent) => pullStart.current !== null && setPull(Math.max(0, e.clientY - pullStart.current)),
    onPointerUp: () => {
      if (pullStart.current === null) return
      pullStart.current = null
      if (pull > 110) onClose()
      else setPull(0)
    },
    onPointerCancel: () => {
      pullStart.current = null
      setPull(0)
    },
  }

  return (
    <aside className="drawer" aria-label="Завдання" style={pull ? { transform: `translateY(${pull}px)`, transition: 'none' } : undefined}>
      <div className="drawer-top" {...pullHandlers}>
        <span className="drawer-crumb">
          {project ? project.name : 'Без проєкту'}
          {task.repeat !== 'none' && ` · ${REPEAT_LABEL[task.repeat].toLowerCase()}`}
        </span>
        <div className="drawer-actions">
          <PopButton className="icon-btn" title="Ще" label={<MoreHorizontal size={18} strokeWidth={1.6} />} placement="bottom-end">
            {(close) => (
              <Menu
                onDone={close}
                items={[
                  {
                    key: 'link',
                    label: 'Скопіювати посилання',
                    icon: <Link2 size={15} strokeWidth={1.6} />,
                    onSelect: () => {
                      navigator.clipboard?.writeText(`${location.origin}${location.pathname}#/today?task=${task.id}`)
                      toast('Посилання скопійовано')
                    },
                  },
                  {
                    key: 'dup',
                    label: 'Дублювати',
                    icon: <Copy size={15} strokeWidth={1.6} />,
                    onSelect: () => {
                      const t = duplicateTask(task.id)
                      if (t) openTask(t.id)
                    },
                  },
                  {
                    key: 'del',
                    label: 'Видалити завдання',
                    icon: <Trash2 size={15} strokeWidth={1.6} />,
                    danger: true,
                    onSelect: () => {
                      removeTask(task.id)
                      onClose()
                    },
                  },
                ]}
              />
            )}
          </PopButton>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Закрити (Esc)" title="Закрити · Esc">
            <X size={18} strokeWidth={1.6} />
          </button>
        </div>
      </div>

      <div className="drawer-scroll">
        <Segmented<Status>
          value={task.status}
          onChange={(s) => setStatus(task.id, s)}
          options={[
            { value: 'open', label: 'Не виконано' },
            { value: 'done', label: 'Виконано' },
            { value: 'cancelled', label: 'Скасовано' },
          ]}
        />

        <AutoText
          className={`drawer-title${task.status !== 'open' ? ' is-closed' : ''}`}
          value={title}
          placeholder="Назва завдання"
          onFocus={() => (editing.current = 'title')}
          onBlur={() => {
            editing.current = null
            clearTimeout(titleTimer.current)
            if (title.trim() && title !== task.title) patch({ title: title.trim() })
            if (!title.trim()) setTitle(task.title)
          }}
          onChange={(v) => {
            const clean = v.replace(/\n/g, ' ')
            setTitle(clean)
            clearTimeout(titleTimer.current)
            titleTimer.current = window.setTimeout(() => clean.trim() && patch({ title: clean.trim() }), 600)
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), (e.target as HTMLElement).blur())}
        />

        <dl className="props">
          <dt>Виконавець</dt>
          <dd>
            <PopButton
              className="prop-btn"
              label={
                assignee ? (
                  <>
                    <Avatar member={assignee} size={20} online={presence.includes(assignee.id)} /> {assignee.name}
                  </>
                ) : (
                  <span className="muted">Не призначено</span>
                )
              }
            >
              {(close) => (
                <Menu
                  onDone={close}
                  items={[
                    ...members.map((m) => ({ key: m.id, label: m.name, icon: <Avatar member={m} size={18} />, checked: task.assigneeId === m.id, onSelect: () => patch({ assigneeId: m.id }) })),
                    { key: 'none', label: 'Не призначено', icon: <span className="avatar-empty" />, checked: !task.assigneeId, onSelect: () => patch({ assigneeId: null }) },
                  ]}
                />
              )}
            </PopButton>
          </dd>

          <dt>Коли</dt>
          <dd>
            <PopButton className="prop-btn" label={task.scope === 'none' ? <span className="muted">Без терміну</span> : whenLabel(task)} popClass="pop-picker">
              {(close) => <WhenPicker task={task} onChange={patch} onDone={close} />}
            </PopButton>
          </dd>

          <dt>Дедлайн</dt>
          <dd>
            <PopButton className={`prop-btn${overdue && task.due ? ' is-overdue' : ''}`} label={task.due ? deadlineLabel(task) : <span className="muted">Немає</span>} popClass="pop-picker">
              {(close) => <DeadlinePicker task={task} onChange={patch} onDone={close} />}
            </PopButton>
          </dd>

          <dt>Проєкт</dt>
          <dd>
            <PopButton className="prop-btn" label={project ? project.name : <span className="muted">Без проєкту</span>}>
              {(close) => <ProjectPicker value={task.projectId} onPick={(projectId) => (patch({ projectId }), close())} />}
            </PopButton>
          </dd>

          <dt>Пріоритет</dt>
          <dd>
            <PopButton className="prop-btn" label={task.priority ? <><span className={`prio p${task.priority}`}>{'!'.repeat(task.priority)}</span> {PRIORITY_LABEL[task.priority]}</> : <span className="muted">Немає</span>}>
              {(close) => (
                <Menu
                  onDone={close}
                  items={([3, 2, 1, 0] as Priority[]).map((p) => ({
                    key: String(p),
                    label: PRIORITY_LABEL[p],
                    icon: <span className={`prio p${p}`}>{p ? '!'.repeat(p) : '–'}</span>,
                    checked: task.priority === p,
                    onSelect: () => patch({ priority: p }),
                  }))}
                />
              )}
            </PopButton>
          </dd>

          <dt>Повтор</dt>
          <dd>
            <PopButton className="prop-btn" label={task.repeat === 'none' ? <span className="muted">Немає</span> : REPEAT_LABEL[task.repeat]}>
              {(close) => (
                <Menu
                  onDone={close}
                  items={(Object.keys(REPEAT_LABEL) as Repeat[]).map((r) => ({
                    key: r,
                    label: REPEAT_LABEL[r],
                    checked: task.repeat === r,
                    onSelect: () => patch(r !== 'none' && task.scope === 'none' && !task.due ? { repeat: r, scope: 'day', date: todayIso() } : { repeat: r }),
                  }))}
                />
              )}
            </PopButton>
          </dd>

          <dt>Кроки</dt>
          <dd>
            <StepsControl task={task} />
          </dd>

          <dt>Теги</dt>
          <dd>
            <TagEditor tags={task.tags} onChange={(tags) => patch({ tags })} />
          </dd>
        </dl>

        <AutoText
          className="drawer-notes"
          value={notes}
          placeholder="Опис, посилання, деталі…"
          onFocus={() => (editing.current = 'notes')}
          onBlur={() => {
            editing.current = null
            clearTimeout(notesTimer.current)
            if (notes !== task.notes) patch({ notes })
          }}
          onChange={(v) => {
            setNotes(v)
            clearTimeout(notesTimer.current)
            notesTimer.current = window.setTimeout(() => patch({ notes: v }), 800)
          }}
        />

        <h4 className="drawer-h">Пункти</h4>
        <Checklist items={task.checklist} onChange={(checklist) => patch({ checklist })} />

        <h4 className="drawer-h">Файли</h4>
        <Files ownerType="task" ownerId={task.id} />

        <div className="drawer-tabs">
          <button type="button" aria-selected={tab === 'comments'} onClick={() => setTab('comments')}>
            Коментарі
          </button>
          <button type="button" aria-selected={tab === 'history'} onClick={() => setTab('history')}>
            Історія
          </button>
        </div>
        {tab === 'comments' ? <Comments taskId={task.id} /> : <History taskId={task.id} />}

        <p className="drawer-foot">
          Створив(-ла) {creator?.name ?? '—'} · {longDate(iso(new Date(task.createdAt)))}
          {task.status === 'done' && task.completedAt && (
            <>
              <br />
              Виконав(-ла) {completer?.name ?? '—'} · {timeAgo(task.completedAt)}
            </>
          )}
          <br />
          Змінено {timeAgo(task.updatedAt)}
        </p>
      </div>
    </aside>
  )
}

function StepsControl({ task }: { task: Task }) {
  const steps = task.steps
  const [draft, setDraft] = useState(String(steps?.total ?? ''))
  useEffect(() => setDraft(String(task.steps?.total ?? '')), [task.steps?.total])
  if (!steps) {
    return (
      <button type="button" className="prop-btn" onClick={() => updateTask(task.id, { steps: { done: 0, total: 5 } })}>
        <span className="muted">Задати кількість</span>
      </button>
    )
  }
  const set = (done: number, total = steps.total) => {
    const next = { total: Math.max(1, total), done: Math.max(0, Math.min(done, Math.max(1, total))) }
    updateTask(task.id, { steps: next })
  }
  return (
    <div className="steps">
      <button type="button" className="icon-btn" aria-label="Мінус крок" onClick={() => set(steps.done - 1)}>
        <Minus size={14} strokeWidth={1.6} />
      </button>
      <span className="steps-value">{steps.done}</span>
      <span className="muted">з</span>
      <input
        className="steps-total"
        inputMode="numeric"
        value={draft}
        onChange={(e) => setDraft(e.target.value.replace(/\D/g, '').slice(0, 4))}
        onBlur={() => (Number(draft) > 0 ? set(steps.done, Number(draft)) : setDraft(String(steps.total)))}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        aria-label="Усього кроків"
      />
      <button type="button" className="icon-btn" aria-label="Плюс крок" onClick={() => set(steps.done + 1)}>
        <Plus size={14} strokeWidth={1.6} />
      </button>
      <div className="bar steps-bar">
        <i style={{ width: `${(steps.done / steps.total) * 100}%` }} />
      </div>
      <button type="button" className="icon-btn" aria-label="Прибрати кроки" title="Прибрати" onClick={() => updateTask(task.id, { steps: null })}>
        <X size={14} strokeWidth={1.6} />
      </button>
    </div>
  )
}

function TagEditor({ tags, onChange }: { tags: string[]; onChange: (t: string[]) => void }) {
  const [text, setText] = useState('')
  const add = () => {
    const t = text.trim().replace(/^#/, '').toLowerCase()
    if (t && !tags.includes(t)) onChange([...tags, t])
    setText('')
  }
  return (
    <div className="tags">
      {tags.map((t) => (
        <span key={t} className="tag">
          #{t}
          <button type="button" aria-label={`Прибрати тег ${t}`} onClick={() => onChange(tags.filter((x) => x !== t))}>
            <X size={11} strokeWidth={1.8} />
          </button>
        </span>
      ))}
      <input
        className="tag-input"
        value={text}
        placeholder={tags.length ? '+' : 'Додати тег'}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
            e.preventDefault()
            add()
          }
          if (e.key === 'Backspace' && !text && tags.length) onChange(tags.slice(0, -1))
        }}
        onBlur={add}
      />
    </div>
  )
}

export function ProjectPicker({ value, onPick }: { value: string | null; onPick: (id: string | null) => void }) {
  const projects = useProjects()
  const [name, setName] = useState('')
  return (
    <div>
      <Menu
        items={[
          ...projects.map((p) => ({ key: p.id, label: p.name, checked: value === p.id, onSelect: () => onPick(p.id) })),
          { key: 'none', label: 'Без проєкту', checked: !value, onSelect: () => onPick(null) },
        ]}
      />
      <div className="menu-input">
        <Plus size={14} strokeWidth={1.6} />
        <input
          value={name}
          placeholder="Новий проєкт"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter' && name.trim()) onPick(addProject(name).id)
          }}
        />
      </div>
    </div>
  )
}
