import { memo, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { updateTask, useStore } from '../lib/store'
import { go, openTask, useLocation } from '../lib/router'
import { addDays, addMonths, cap, MONTHS_SHORT, isOverdue, monthEnd, monthLabel, monthStart, plural, relDay, shortDate, todayIso, weekday, WEEKDAYS, weekEnd, weekLabel, WEEKDAYS_SHORT, weekStart } from '../lib/dates'
import { dayOf, rescheduleTo } from '../lib/filters'
import { drag, useTaskDrop } from '../lib/dnd'
import { COMPACT, useHotkeys, useLiveTasks, useMedia, useMembers, usePersistedValue } from '../lib/hooks'
import type { Member, Task } from '../lib/types'
import { AddRow, CheckButton } from '../components/TaskList'
import { WhoTabs } from '../components/FilterBar'
import { Avatar, Segmented } from '../components/ui'

type Mode = 'month' | 'week'

export function CalendarView({ mode, date }: { mode: Mode; date: string }) {
  const me = useStore((s) => s.me)
  const members = useStore((s) => s.members)
  const active = useMembers()
  const tasks = useLiveTasks()
  const [who, setWho] = usePersistedValue<string>('calwho', 'all')
  const [showDone, setShowDone] = usePersistedValue<boolean>('cal.done', true)
  const today = todayIso()
  const whoId = who === 'me' ? me : who === 'all' ? null : active.some((m) => m.id === who) ? who : null

  const start = mode === 'month' ? weekStart(monthStart(date)) : date
  const end = mode === 'month' ? weekEnd(monthEnd(date)) : addDays(date, 6)

  const { byDay, byWeek, monthBand, count } = useMemo(() => {
    const byDay = new Map<string, Task[]>()
    const byWeek = new Map<string, Task[]>()
    const monthBand: Task[] = []
    let count = 0
    const push = <K,>(map: Map<K, Task[]>, k: K, t: Task) => {
      const list = map.get(k)
      if (list) list.push(t)
      else map.set(k, [t])
    }
    for (const t of tasks) {
      if (whoId && t.assigneeId !== whoId) continue
      if (!showDone && t.status !== 'open') continue
      const d = dayOf(t)
      if (d) {
        if (d >= start && d <= end) (push(byDay, d, t), count++)
        continue
      }
      if (t.scope === 'week' && t.date) {
        const ws = weekStart(t.date)
        if (ws >= start && ws <= end) (push(byWeek, ws, t), count++)
      }
      if (t.scope === 'month' && t.date && monthStart(t.date) === monthStart(date)) (monthBand.push(t), count++)
      // wider-horizon tasks with a hard deadline also mark that day
      if (t.due && t.due >= start && t.due <= end && t.scope !== 'none') push(byDay, t.due, t)
    }
    const sort = (a: Task, b: Task) => (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1) || (a.dueTime ?? '99').localeCompare(b.dueTime ?? '99') || a.order - b.order
    byDay.forEach((l) => l.sort(sort))
    byWeek.forEach((l) => l.sort(sort))
    monthBand.sort(sort)
    return { byDay, byWeek, monthBand, count }
  }, [tasks, whoId, showDone, start, end, date])

  const move = (dir: number) => go({ name: 'calendar', mode, date: mode === 'month' ? addMonths(date, dir) : addDays(date, dir * 7) })
  const current = mode === 'month' ? monthStart(today) : weekStart(today)
  useHotkeys({
    arrowleft: () => move(-1),
    arrowright: () => move(1),
    t: () => go({ name: 'calendar', mode, date: current }),
    е: () => go({ name: 'calendar', mode, date: current }),
  })

  const weeks: string[] = []
  for (let w = start; w <= end; w = addDays(w, 7)) weeks.push(w)
  const defaults = useMemo(() => ({ assigneeId: whoId ?? me }), [whoId, me])

  // Phones: the month grid becomes a date picker with dots, the chosen day's tasks list below it.
  const compact = useMedia(COMPACT)
  const agenda = compact && mode === 'month'
  const [picked, setPicked] = useState<string | null>(null)
  const pickedDay = picked && picked.slice(0, 7) === date.slice(0, 7) ? picked : today.slice(0, 7) === date.slice(0, 7) ? today : date
  const pickedWeek = byWeek.get(weekStart(pickedDay)) ?? []

  return (
    <div className="page page-wide">
      <header className="page-head">
        <div className="eyebrow">
          <span>Календар</span>
        </div>
        <h1 className="display">{mode === 'month' ? monthLabel(date) : weekLabel(date)}</h1>
        <p className="head-sub">
          <span>{mode === 'month' ? date.slice(0, 4) : `тиждень · ${monthLabel(date).toLowerCase()}`}</span>
          <span>
            {count} {plural(count, ['завдання', 'завдання', 'завдань'])}
          </span>
        </p>
      </header>

      <div className="toolbar">
        <Segmented<Mode>
          value={mode}
          onChange={(m) => go({ name: 'calendar', mode: m, date: m === 'week' ? weekStart(mode === 'month' && monthStart(today) === date ? today : date) : monthStart(date) })}
          options={[
            { value: 'month', label: 'Місяць' },
            { value: 'week', label: 'Тиждень' },
          ]}
        />
        <div className="pager">
          <button type="button" className="icon-btn" aria-label="Назад" onClick={() => move(-1)}>
            <ChevronLeft size={18} strokeWidth={1.6} />
          </button>
          <button type="button" className="link-btn" disabled={date === current} onClick={() => go({ name: 'calendar', mode, date: current })}>
            Сьогодні
          </button>
          <button type="button" className="icon-btn" aria-label="Вперед" onClick={() => move(1)}>
            <ChevronRight size={18} strokeWidth={1.6} />
          </button>
        </div>
        <WhoTabs value={who} onChange={setWho} />
        <label className="toggle">
          <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
          <span>Виконані</span>
        </label>
      </div>

      {(monthBand.length > 0 || mode === 'week') && (
        <div className="cal-bands">
          {mode === 'week' && <Band label="На тиждень" tasks={byWeek.get(date) ?? []} drop={{ scope: 'week', date }} create={{ ...defaults, scope: 'week', date }} members={members} showWho={!whoId} />}
          <Band label={`На ${cap(monthLabel(monthStart(date))).toLowerCase()}`} tasks={monthBand} drop={{ scope: 'month', date: monthStart(date) }} create={{ ...defaults, scope: 'month', date: monthStart(date) }} members={members} showWho={!whoId} />
        </div>
      )}

      <div className={`cal cal-mode-${mode}`}>
        <div className="cal-head">
          {WEEKDAYS_SHORT.map((w, i) => (
            <span key={w} className={i > 4 ? 'is-weekend' : ''}>
              {w}
            </span>
          ))}
        </div>
        {weeks.map((w) => (
          <div key={w} className="cal-row">
            {mode === 'month' && (byWeek.get(w)?.length ?? 0) > 0 && (
              <div className="cal-weekband">
                <span className="cal-weekband-label">на тиждень</span>
                {byWeek.get(w)!.map((t) => (
                  <CalItem key={t.id} task={t} member={t.assigneeId ? members[t.assigneeId] : undefined} showWho={!whoId} />
                ))}
              </div>
            )}
            <div className="cal-days">
              {Array.from({ length: 7 }, (_, i) => {
                const d = addDays(w, i)
                return (
                  <DayCell
                    key={d}
                    day={d}
                    tasks={byDay.get(d) ?? []}
                    mode={mode}
                    outside={mode === 'month' && d.slice(0, 7) !== date.slice(0, 7)}
                    today={today}
                    defaults={defaults}
                    members={members}
                    showWho={!whoId}
                    picked={agenda && d === pickedDay}
                    onPick={agenda ? setPicked : undefined}
                  />
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {agenda && (
        <section className="agenda">
          <div className="agenda-head">
            <h3 className="section-label">{relDay(pickedDay, today) === shortDate(pickedDay) ? cap(WEEKDAYS[weekday(pickedDay)]) : relDay(pickedDay, today)}, {shortDate(pickedDay)}</h3>
            <button type="button" className="link-btn" onClick={() => go({ name: 'tasks', period: 'day', date: pickedDay })}>
              Відкрити день
            </button>
          </div>
          {(byDay.get(pickedDay) ?? []).map((t) => (
            <CalItem key={t.id} task={t} day={pickedDay} member={t.assigneeId ? members[t.assigneeId] : undefined} showWho={!whoId} />
          ))}
          {!(byDay.get(pickedDay) ?? []).length && <p className="section-empty">На цей день нічого немає</p>}
          <AddRow defaults={{ ...defaults, scope: 'day', date: pickedDay }} />
          {pickedWeek.length > 0 && (
            <>
              <h3 className="section-label agenda-sub">На тиждень</h3>
              {pickedWeek.map((t) => (
                <CalItem key={t.id} task={t} member={t.assigneeId ? members[t.assigneeId] : undefined} showWho={!whoId} />
              ))}
            </>
          )}
        </section>
      )}
    </div>
  )
}

const MAX_IN_CELL = 4

const DayCell = memo(function DayCell({
  day,
  tasks,
  mode,
  outside,
  today,
  defaults,
  members,
  showWho,
  picked,
  onPick,
}: {
  day: string
  tasks: Task[]
  mode: Mode
  outside: boolean
  today: string
  defaults: Partial<Task>
  members: Record<string, Member>
  showWho: boolean
  picked?: boolean
  onPick?: (day: string) => void
}) {
  const [adding, setAdding] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const { over, props } = useTaskDrop((id) => {
    const t = useStore.getState().tasks[id]
    if (!t) return
    // a week/month task dragged onto a day keeps its horizon and gets a deadline
    if ((t.scope === 'week' || t.scope === 'month') && t.due) updateTask(id, { due: day })
    else updateTask(id, rescheduleTo(t, day))
  })
  const limit = mode === 'month' && !expanded ? MAX_IN_CELL : Infinity
  const shown = tasks.slice(0, limit)
  const hidden = tasks.length - shown.length
  const cls = ['cal-day', outside && 'is-out', day === today && 'is-today', day < today && 'is-past', over && 'is-over', Number(day.slice(8)) === 1 && 'is-first', picked && 'is-picked'].filter(Boolean).join(' ')

  return (
    <div className={cls} {...props} onClick={onPick ? () => onPick(day) : undefined} onDoubleClick={(e) => !onPick && e.target === e.currentTarget && setAdding(true)}>
      <div className="cal-day-head">
        <button type="button" className="cal-num" onClick={() => go({ name: 'tasks', period: 'day', date: day })} title="Відкрити день">
          {Number(day.slice(8))}
          {Number(day.slice(8)) === 1 && mode === 'month' && <span className="cal-mon"> {MONTHS_SHORT[Number(day.slice(5, 7)) - 1]}</span>}
        </button>
        <button type="button" className="icon-btn cal-add" aria-label="Додати завдання на цей день" onClick={() => setAdding(true)}>
          <Plus size={14} strokeWidth={1.6} />
        </button>
      </div>
      {onPick && (
        <div className="cal-dots" aria-hidden>
          {tasks.slice(0, 4).map((t) => (
            <i key={t.id} className={t.status !== 'open' ? 'is-done' : isOverdue(t) ? 'is-overdue' : ''} />
          ))}
        </div>
      )}
      <div className="cal-items">
        {shown.map((t) => (
          <CalItem key={t.id} task={t} day={day} member={t.assigneeId ? members[t.assigneeId] : undefined} showWho={showWho} />
        ))}
        {hidden > 0 && (
          <button type="button" className="cal-more" onClick={() => setExpanded(true)}>
            ще {hidden}
          </button>
        )}
        {adding && (
          <div className="cal-adder" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setAdding(false)}>
            <AddRow defaults={{ ...defaults, scope: 'day', date: day }} autoFocus placeholder="Завдання" />
          </div>
        )}
      </div>
    </div>
  )
})

const CalItem = memo(function CalItem({ task, day, member, showWho }: { task: Task; day?: string; member?: Member; showWho: boolean }) {
  const { task: openId } = useLocation()
  const deadlineOnly = Boolean(day && task.scope !== 'day' && task.scope !== 'none' && task.due === day)
  const overdue = isOverdue(task)
  return (
    <div
      className={`cal-item is-${task.status}${openId === task.id ? ' is-selected' : ''}${overdue ? ' is-overdue' : ''}`}
      draggable
      onDragStart={(e) => drag.start(e, task.id)}
      onDragEnd={() => drag.end()}
      onClick={() => openTask(task.id)}
      title={task.title}
    >
      <CheckButton task={task} size={14} />
      <span className="cal-item-title">
        {task.dueTime && (task.due === day || !day) && <span className="cal-time">{task.dueTime}</span>}
        {deadlineOnly && <span className="cal-time">до</span>}
        {task.title}
      </span>
      {showWho && member && <Avatar member={member} size={16} />}
    </div>
  )
})

function Band({ label, tasks, drop, create, members, showWho }: { label: string; tasks: Task[]; drop: Partial<Task>; create: Partial<Task>; members: Record<string, Member>; showWho: boolean }) {
  const { over, props } = useTaskDrop((id) => updateTask(id, drop))
  return (
    <div className={`cal-band${over ? ' is-over' : ''}`} {...props}>
      <span className="cal-band-label">{label}</span>
      <div className="cal-band-items">
        {tasks.map((t) => (
          <CalItem key={t.id} task={t} member={t.assigneeId ? members[t.assigneeId] : undefined} showWho={showWho} />
        ))}
        <div className="cal-band-add">
          <AddRow defaults={create} placeholder="Додати" />
        </div>
      </div>
    </div>
  )
}
