import { useMemo } from 'react'
import { ChevronLeft, ChevronRight, Copy } from 'lucide-react'
import { go } from '../lib/router'
import { toast } from '../lib/store'
import { useHotkeys, useLiveTasks, useMembers, useProjects } from '../lib/hooks'
import { addDays, iso, isActive, plural, taskEnd, todayIso, weekLabel, weekStart } from '../lib/dates'
import { dayOf, sortTasks, type Section } from '../lib/filters'
import { TaskSections } from '../components/TaskList'
import { Avatar } from '../components/ui'
import type { Task } from '../lib/types'

const words = (n: number) => `${n} ${plural(n, ['завдання', 'завдання', 'завдань'])}`
const MOVED_MANY = 3

/** One screen for the weekly meeting: what got done, what slipped, what keeps getting pushed. */
export function ReportView({ date }: { date: string }) {
  const tasks = useLiveTasks()
  const members = useMembers()
  const projects = useProjects()
  const today = todayIso()
  const start = date
  const end = addDays(date, 6)
  const isCurrent = start === weekStart(today)
  // a deadline only counts as missed once its day is over
  const missedUntil = isCurrent ? addDays(today, -1) : end

  const r = useMemo(() => {
    const inWeek = (ts: number | null) => {
      if (!ts) return false
      const d = iso(new Date(ts))
      return d >= start && d <= end
    }
    const closed = tasks.filter((t) => t.status === 'done' && inWeek(t.completedAt))
    const cancelled = tasks.filter((t) => t.status === 'cancelled' && inWeek(t.completedAt))
    const missed = tasks.filter((t) => {
      if (!isActive(t)) return false
      const e = taskEnd(t)
      return Boolean(e && e >= start && e <= missedUntil)
    })
    const moved = tasks.filter((t) => (t.moves ?? 0) >= MOVED_MANY && (isActive(t) || inWeek(t.completedAt)))
    const nextStart = addDays(end, 1)
    const next = tasks.filter((t) => isActive(t) && (dayOf(t) ?? t.due ?? '') >= nextStart && (dayOf(t) ?? t.due ?? '') <= addDays(nextStart, 6))
    return { closed, cancelled, missed, moved, next }
  }, [tasks, start, end, missedUntil])

  const people = members.map((m) => ({
    m,
    closed: r.closed.filter((t) => t.completedBy === m.id).length,
    missed: r.missed.filter((t) => t.assigneeId === m.id).length,
    progress: tasks.filter((t) => t.status === 'progress' && t.assigneeId === m.id).length,
  }))

  const sections: Section[] = [
    ...members
      .map((m) => ({ key: `closed-${m.id}`, label: `Закрив(-ла) ${m.name.split(' ')[0]}`, sub: words(r.closed.filter((t) => t.completedBy === m.id).length), tasks: sortTasks(r.closed.filter((t) => t.completedBy === m.id)) }))
      .filter((s) => s.tasks.length),
    { key: 'missed', label: 'Зірвали терміни', tasks: sortTasks([...r.missed]), tone: r.missed.length ? ('alert' as const) : undefined, keep: true },
    { key: 'moved', label: `Переносили ${MOVED_MANY}+ рази`, sub: 'час розбити або делегувати', tasks: [...r.moved].sort((a, b) => (b.moves ?? 0) - (a.moves ?? 0)), keep: true },
    { key: 'cancelled', label: 'Скасували', tasks: sortTasks([...r.cancelled]) },
    { key: 'next', label: 'Наступний тиждень', sub: words(r.next.length), tasks: sortTasks([...r.next]) },
  ].filter((s) => s.tasks.length || ('keep' in s && s.keep))

  const move = (dir: number) => go({ name: 'report', date: addDays(start, dir * 7) })
  useHotkeys({ arrowleft: () => move(-1), arrowright: () => move(1) })

  const copy = () => {
    const name = (id: string | null) => members.find((m) => m.id === id)?.name.split(' ')[0] ?? '—'
    const project = (t: Task) => (t.projectId ? ` [${projects.find((p) => p.id === t.projectId)?.name ?? ''}]` : '')
    const lines = [`Звіт за тиждень ${weekLabel(start)}`, '', `Закрито: ${r.closed.length} · зірвано: ${r.missed.length} · переносили ${MOVED_MANY}+ рази: ${r.moved.length}`, '']
    for (const p of people) lines.push(`${p.m.name}: закрив(-ла) ${p.closed}, зірвано ${p.missed}, в роботі ${p.progress}`)
    if (r.missed.length) lines.push('', 'Зірвані терміни:', ...r.missed.map((t) => `— ${t.title}${project(t)} (${name(t.assigneeId)})`))
    if (r.moved.length) lines.push('', `Переносили ${MOVED_MANY}+ рази:`, ...r.moved.map((t) => `— ${t.title} ×${t.moves} (${name(t.assigneeId)})`))
    navigator.clipboard?.writeText(lines.join('\n'))
    toast('Звіт скопійовано — можна вставити в чат')
  }

  return (
    <div className="page">
      <header className="page-head">
        <div className="eyebrow">
          <span>Звіт тижня · уся команда</span>
        </div>
        <h1 className="display">{weekLabel(start)}</h1>
        <p className="head-sub">
          <span>{words(r.closed.length)} закрито</span>
          <span className={r.missed.length ? 'is-alert' : ''}>{r.missed.length} зірвано</span>
          <span>{r.moved.length} переносили {MOVED_MANY}+ рази</span>
          {r.cancelled.length > 0 && <span>{r.cancelled.length} скасовано</span>}
        </p>
      </header>

      <div className="toolbar">
        <div className="pager">
          <button type="button" className="icon-btn" aria-label="Попередній тиждень" onClick={() => move(-1)}>
            <ChevronLeft size={18} strokeWidth={1.6} />
          </button>
          <button type="button" className="link-btn" disabled={isCurrent} onClick={() => go({ name: 'report', date: weekStart(today) })}>
            Цей тиждень
          </button>
          <button type="button" className="icon-btn" aria-label="Наступний тиждень" onClick={() => move(1)}>
            <ChevronRight size={18} strokeWidth={1.6} />
          </button>
        </div>
        <button type="button" className="tool-btn" onClick={copy}>
          <Copy size={15} strokeWidth={1.6} /> Скопіювати текстом
        </button>
      </div>

      <div className="report-people">
        {people.map((p) => (
          <button key={p.m.id} type="button" className="report-person" onClick={() => go({ name: 'member', id: p.m.id })}>
            <Avatar member={p.m} size={28} />
            <span className="report-name">{p.m.name}</span>
            <span className="report-nums">
              <b>{p.closed}</b> закрито
              {p.missed > 0 && <em> · {p.missed} зірвано</em>}
              {p.progress > 0 && <> · {p.progress} в роботі</>}
            </span>
          </button>
        ))}
      </div>

      <TaskSections sections={sections} options={{ showAssignee: true, readOnly: true }} />
    </div>
  )
}
