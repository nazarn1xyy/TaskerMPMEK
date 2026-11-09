import { memo, useMemo, useState } from 'react'
import { ListChecks, MoreHorizontal } from 'lucide-react'
import { setStatus, updateTask, useStore } from '../lib/store'
import { openTask, useLocation } from '../lib/router'
import { drag, useTaskDrop } from '../lib/dnd'
import { isTouch } from '../lib/hooks'
import { isOverdue } from '../lib/dates'
import type { ProjectSection, Status, Task } from '../lib/types'
import { AddRow, CheckButton, dateText, statusMenu } from './TaskList'
import { Avatar, Menu, Popover } from './ui'

const COLUMNS: { status: Status; label: string }[] = [
  { status: 'open', label: 'Не виконано' },
  { status: 'progress', label: 'В роботі' },
  { status: 'done', label: 'Виконано' },
]
const DONE_LIMIT = 12

/** Kanban: one column per status; drag a card (or use its menu on touch) to move it. */
export function Board({ tasks, defaults, sections }: { tasks: Task[]; defaults: Partial<Task>; sections: ProjectSection[] }) {
  const columns = useMemo(
    () =>
      COLUMNS.map((c) => {
        const list = tasks.filter((t) => t.status === c.status)
        list.sort((a, b) => (c.status === 'done' ? (b.completedAt ?? 0) - (a.completedAt ?? 0) : a.order - b.order))
        return { ...c, tasks: list }
      }),
    [tasks],
  )
  const sectionName = useMemo(() => new Map(sections.map((s) => [s.id, s.name])), [sections])
  return (
    <div className="board">
      {columns.map((c) => (
        <Column key={c.status} status={c.status} label={c.label} tasks={c.tasks} defaults={defaults} sectionName={sectionName} />
      ))}
    </div>
  )
}

function Column({ status, label, tasks, defaults, sectionName }: { status: Status; label: string; tasks: Task[]; defaults: Partial<Task>; sectionName: Map<string, string> }) {
  const [all, setAll] = useState(false)
  const { over, props } = useTaskDrop(
    (id) => {
      const t = useStore.getState().tasks[id]
      if (!t) return
      if (t.status !== status) setStatus(id, status)
      // dropped into a column → goes to its end, keeping manual order meaningful
      else updateTask(id, { order: Date.now() })
    },
    (id) => Boolean(useStore.getState().tasks[id]),
  )
  const shown = status === 'done' && !all ? tasks.slice(0, DONE_LIMIT) : tasks
  return (
    <section className={`board-col${over ? ' is-over' : ''}`} {...props}>
      <header className="board-head">
        <h3 className="section-label">{label}</h3>
        <span className="section-count">{tasks.length || ''}</span>
      </header>
      <div className="board-cards">
        {shown.map((t) => (
          <Card key={t.id} task={t} section={t.sectionId ? sectionName.get(t.sectionId) : undefined} />
        ))}
        {shown.length < tasks.length && (
          <button type="button" className="link-btn board-more" onClick={() => setAll(true)}>
            Показати ще {tasks.length - shown.length}
          </button>
        )}
        {!tasks.length && <p className="section-empty">{isTouch() ? 'Порожньо' : 'Перетягніть сюди картку'}</p>}
        {status !== 'done' && <AddRow defaults={{ ...defaults, status }} placeholder="Картка" />}
      </div>
    </section>
  )
}

const Card = memo(function Card({ task, section }: { task: Task; section?: string }) {
  const { task: openId } = useLocation()
  const assignee = useStore((s) => (task.assigneeId ? s.members[task.assigneeId] : undefined))
  const [menuEl, setMenuEl] = useState<HTMLButtonElement | null>(null)
  const date = dateText(task)
  const done = task.checklist.filter((c) => c.done).length
  return (
    <article
      className={`card is-${task.status}${openId === task.id ? ' is-selected' : ''}`}
      draggable={!isTouch()}
      onDragStart={(e) => drag.start(e, task.id)}
      onDragEnd={() => drag.end()}
      onClick={() => openTask(task.id)}
    >
      <div className="card-top">
        <CheckButton task={task} size={16} />
        <span className="card-title">{task.title}</span>
        <button
          type="button"
          className="icon-btn card-more"
          aria-label="Перемістити або змінити"
          onClick={(e) => {
            e.stopPropagation()
            setMenuEl(menuEl ? null : e.currentTarget)
          }}
        >
          <MoreHorizontal size={15} strokeWidth={1.6} />
        </button>
      </div>
      {(section || date || task.checklist.length > 0 || assignee || task.priority > 0) && (
        <div className="card-meta">
          {task.priority > 0 && <span className={`prio p${task.priority}`}>{'!'.repeat(task.priority)}</span>}
          {section && <span className="row-project">{section}</span>}
          {date && <span className={isOverdue(task) ? 'is-alert' : ''}>{date}</span>}
          {task.checklist.length > 0 && (
            <span className="meta-item">
              <ListChecks size={12} strokeWidth={1.6} />
              {done}/{task.checklist.length}
            </span>
          )}
          {assignee && <Avatar member={assignee} size={18} />}
        </div>
      )}
      {menuEl && (
        <Popover anchor={menuEl} onClose={() => setMenuEl(null)} placement="bottom-end">
          <div onClick={(e) => e.stopPropagation()}>
            <Menu items={statusMenu(task)} onDone={() => setMenuEl(null)} />
          </div>
        </Popover>
      )}
    </article>
  )
})
