import type { Member, Project, Status, Task } from './types'
import type { Period } from './router'
import {
  addDays,
  addMonths,
  cap,
  isOverdue,
  monthEnd,
  monthStart,
  overlaps,
  relDay,
  taskEnd,
  todayIso,
  weekday,
  weekEnd,
  weekLabel,
  WEEKDAYS,
  MONTHS,
  weekStart,
  shortDate,
} from './dates'

export interface Filters {
  status: Status[]
  projects: string[] // 'none' = без проєкту
  priority: number[]
  tags: string[]
  authors: string[]
  q: string
}

export const emptyFilters = (): Filters => ({ status: [], projects: [], priority: [], tags: [], authors: [], q: '' })

export const filtersActive = (f: Filters) =>
  f.status.length + f.projects.length + f.priority.length + f.tags.length + f.authors.length > 0 || f.q.trim() !== ''

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е')

export function applyFilters(tasks: Task[], f: Filters, who: string | null) {
  const q = norm(f.q.trim())
  return tasks.filter((t) => {
    if (t.deletedAt) return false
    if (who && t.assigneeId !== who) return false
    if (f.status.length && !f.status.includes(t.status)) return false
    if (f.projects.length && !f.projects.includes(t.projectId ?? 'none')) return false
    if (f.priority.length && !f.priority.includes(t.priority)) return false
    if (f.tags.length && !f.tags.some((tag) => t.tags.includes(tag))) return false
    if (f.authors.length && !f.authors.includes(t.createdBy ?? '')) return false
    if (q && !norm(t.title).includes(q) && !norm(t.notes).includes(q) && !t.checklist.some((c) => norm(c.text).includes(q))) return false
    return true
  })
}

export function sortTasks(list: Task[]) {
  const rank = (t: Task) => (t.status === 'open' ? 0 : 1)
  return list.sort((a, b) => rank(a) - rank(b) || (rank(a) ? (b.completedAt ?? 0) - (a.completedAt ?? 0) : a.order - b.order))
}

export type GroupBy = 'date' | 'project' | 'person' | 'status' | 'none'

export interface Section {
  key: string
  label: string
  sub?: string
  tasks: Task[]
  /** Patch applied when a task is dropped into this section. */
  drop?: Partial<Task>
  /** Defaults for a task created from inside this section. */
  create?: Partial<Task>
  tone?: 'alert' | 'now'
  /** Keep visible even when empty (week days are drop targets). */
  keep?: boolean
}

/** The day a task sits on, when it is planned for a single day. */
export function dayOf(t: Task): string | null {
  if (t.scope === 'day' && t.date) return t.date
  if (t.scope === 'none' && t.due) return t.due
  return null
}

/** Patch that moves a task onto a given day, keeping its deadline semantics. */
export function rescheduleTo(t: Task, day: string): Partial<Task> {
  if (t.scope === 'none' && t.due) return { due: day }
  const patch: Partial<Task> = { scope: 'day', date: day }
  if (t.due && t.due < day) patch.due = day
  return patch
}

export const dayPatch = (day: string): Partial<Task> => ({ scope: 'day', date: day })
const weekPatch = (d: string): Partial<Task> => ({ scope: 'week', date: weekStart(d) })
const monthPatch = (d: string): Partial<Task> => ({ scope: 'month', date: monthStart(d) })

export function rangeOf(period: Period, date: string): [string, string] | null {
  if (period === 'day') return [date, date]
  if (period === 'week') return [weekStart(date), weekEnd(date)]
  if (period === 'month') return [monthStart(date), monthEnd(date)]
  return null
}

export function tasksInPeriod(tasks: Task[], period: Period, date: string, today = todayIso()) {
  const range = rangeOf(period, date)
  if (!range) return tasks
  const [start, end] = range
  const containsToday = start <= today && today <= end
  return tasks.filter((t) => overlaps(t, start, end) || (containsToday && t.status === 'open' && isOverdue(t, today) && (taskEnd(t) ?? '') < start))
}

function overdueSection(tasks: Task[], start: string, today: string): Section | null {
  const list = tasks.filter((t) => t.status === 'open' && isOverdue(t, today) && (taskEnd(t) ?? '') < start)
  if (!list.length) return null
  return { key: 'overdue', label: 'Прострочено', tasks: sortTasks(list), tone: 'alert' }
}

function byDate(tasks: Task[], period: Period, date: string, today: string): Section[] {
  const out: Section[] = []
  const taken = new Set<string>()
  const take = (list: Task[]) => {
    list.forEach((t) => taken.add(t.id))
    return sortTasks(list)
  }
  const free = () => tasks.filter((t) => !taken.has(t.id))

  if (period === 'all') {
    const tomorrow = addDays(today, 1)
    const ws = weekStart(today)
    const wEnd = weekEnd(today)
    const nextWs = addDays(ws, 7)
    const mStart = monthStart(today)
    const mEnd = monthEnd(today)
    const sections: Record<string, Section> = {
      overdue: { key: 'overdue', label: 'Прострочено', tasks: [], tone: 'alert' },
      today: { key: 'today', label: 'Сьогодні', tasks: [], drop: dayPatch(today), create: dayPatch(today), tone: 'now' },
      tomorrow: { key: 'tomorrow', label: 'Завтра', tasks: [], drop: dayPatch(tomorrow), create: dayPatch(tomorrow) },
      week: { key: 'week', label: 'Цей тиждень', tasks: [], drop: weekPatch(today), create: weekPatch(today) },
      nextweek: { key: 'nextweek', label: 'Наступний тиждень', tasks: [], drop: weekPatch(nextWs), create: weekPatch(nextWs) },
      month: { key: 'month', label: 'Цей місяць', tasks: [], drop: monthPatch(today), create: monthPatch(today) },
      later: { key: 'later', label: 'Пізніше', tasks: [] },
      none: { key: 'none', label: 'Без терміну', tasks: [], drop: { scope: 'none', date: null, due: null, dueTime: null }, create: {} },
    }
    const bucket = (t: Task): string => {
      if (isOverdue(t, today)) return 'overdue'
      const d = dayOf(t)
      if (d) {
        if (d <= today) return 'today'
        if (d === tomorrow) return 'tomorrow'
        if (d <= wEnd) return 'week'
        if (d < addDays(nextWs, 7)) return 'nextweek'
        if (d <= mEnd) return 'month'
        return 'later'
      }
      if (t.scope === 'week' && t.date) {
        const w = weekStart(t.date)
        if (w <= ws) return 'week'
        if (w === nextWs) return 'nextweek'
        return w <= mEnd ? 'month' : 'later'
      }
      if (t.scope === 'month' && t.date) return monthStart(t.date) <= mStart ? 'month' : 'later'
      if (t.due) return t.due <= mEnd ? 'month' : 'later'
      return 'none'
    }
    for (const t of tasks) sections[bucket(t)].tasks.push(t)
    return Object.values(sections)
      .map((s) => ({ ...s, tasks: sortTasks(s.tasks) }))
      .filter((s) => s.tasks.length)
  }

  const [start, end] = rangeOf(period, date)!
  if (start <= today && today <= end) {
    const od = overdueSection(tasks, start, today)
    if (od) out.push({ ...od, tasks: take(od.tasks) })
  }

  if (period === 'day') {
    const list = free().filter((t) => dayOf(t) === date || t.due === date)
    out.push({ key: 'day', label: 'На день', tasks: take(list), drop: dayPatch(date), create: dayPatch(date), keep: true })
  }

  if (period === 'week') {
    for (let i = 0; i < 7; i++) {
      const day = addDays(start, i)
      const list = free().filter((t) => dayOf(t) === day)
      out.push({
        key: day,
        label: cap(WEEKDAYS[i]),
        sub: ['Сьогодні', 'Завтра', 'Вчора'].includes(relDay(day, today)) ? `${shortDate(day)} · ${relDay(day, today).toLowerCase()}` : shortDate(day),
        tasks: take(list),
        drop: dayPatch(day),
        create: dayPatch(day),
        tone: day === today ? 'now' : undefined,
        keep: true,
      })
    }
  }

  if (period === 'month') {
    for (let w = weekStart(start); w <= end; w = addDays(w, 7)) {
      const wEnd = addDays(w, 6)
      const lo = w < start ? start : w
      const hi = wEnd > end ? end : wEnd
      const list = free().filter((t) => {
        const d = dayOf(t)
        if (d) return d >= lo && d <= hi
        return t.scope === 'week' && t.date && weekStart(t.date) === w
      })
      out.push({
        key: w,
        label: weekLabel(w),
        sub: w === weekStart(today) ? 'цей тиждень' : undefined,
        tasks: take(list),
        drop: weekPatch(w),
        create: weekPatch(w < start ? start : w),
        tone: w === weekStart(today) ? 'now' : undefined,
      })
    }
  }

  if (period !== 'month') {
    const weekList = free().filter((t) => t.scope === 'week' && t.date && weekStart(t.date) === weekStart(date))
    out.push({ key: 'scope-week', label: 'На тиждень', sub: weekLabel(weekStart(date)), tasks: take(weekList), drop: weekPatch(date), create: weekPatch(date) })
  }
  const monthList = free().filter((t) => t.scope === 'month' && t.date && monthStart(t.date) === monthStart(date))
  out.push({ key: 'scope-month', label: 'На місяць', tasks: take(monthList), drop: monthPatch(date), create: monthPatch(date) })

  // deadline-only stragglers that fall in range but have no day placement
  const rest = free()
  if (rest.length) out.push({ key: 'rest', label: 'З дедлайном', tasks: take(rest) })

  return out.filter((s) => s.tasks.length || s.keep)
}

export function buildSections(
  tasks: Task[],
  groupBy: GroupBy,
  ctx: { period: Period; date: string; members: Member[]; projects: Project[]; today?: string },
): Section[] {
  const today = ctx.today ?? todayIso()
  if (groupBy === 'date') return byDate(tasks, ctx.period, ctx.date, today)

  const base: Partial<Task> = ctx.period === 'day' ? dayPatch(ctx.date) : ctx.period === 'week' ? weekPatch(ctx.date) : ctx.period === 'month' ? monthPatch(ctx.date) : {}

  if (groupBy === 'none') return [{ key: 'all', label: 'Усі', tasks: sortTasks([...tasks]), create: base, keep: true }]

  if (groupBy === 'status') {
    const labels: [Status, string][] = [
      ['open', 'Не виконані'],
      ['done', 'Виконані'],
      ['cancelled', 'Скасовані'],
    ]
    return labels
      .map(([status, label]) => ({ key: status, label, tasks: sortTasks(tasks.filter((t) => t.status === status)), drop: { status }, create: { ...base, status } }))
      .filter((s) => s.tasks.length || s.key === 'open')
  }

  if (groupBy === 'project') {
    const sections: Section[] = ctx.projects
      .filter((p) => !p.archived)
      .map((p) => ({ key: p.id, label: p.name, tasks: sortTasks(tasks.filter((t) => t.projectId === p.id)), drop: { projectId: p.id }, create: { ...base, projectId: p.id } }))
    sections.push({ key: 'none', label: 'Без проєкту', tasks: sortTasks(tasks.filter((t) => !t.projectId || !ctx.projects.some((p) => p.id === t.projectId && !p.archived))), drop: { projectId: null }, create: base })
    return sections.filter((s) => s.tasks.length)
  }

  const sections: Section[] = ctx.members.map((m) => ({
    key: m.id,
    label: m.name,
    tasks: sortTasks(tasks.filter((t) => t.assigneeId === m.id)),
    drop: { assigneeId: m.id },
    create: { ...base, assigneeId: m.id },
  }))
  sections.push({ key: 'nobody', label: 'Не призначені', tasks: sortTasks(tasks.filter((t) => !t.assigneeId || !ctx.members.some((m) => m.id === t.assigneeId))), drop: { assigneeId: null }, create: { ...base, assigneeId: null } })
  return sections.filter((s) => s.tasks.length)
}

export function periodTitle(period: Period, date: string, today = todayIso()) {
  if (period === 'all') return { title: 'Усі завдання', sub: '' }
  if (period === 'day') {
    const rel = relDay(date, today)
    const wd = cap(WEEKDAYS[weekday(date)])
    if (rel === 'Сьогодні' || rel === 'Завтра' || rel === 'Вчора') return { title: rel, sub: `${wd.toLowerCase()}, ${shortDate(date, true)}` }
    return { title: wd, sub: shortDate(date, true) }
  }
  if (period === 'week') {
    const ws = weekStart(today)
    const title = date === ws ? 'Цей тиждень' : date === addDays(ws, 7) ? 'Наст. тиждень' : date === addDays(ws, -7) ? 'Минулий тиждень' : weekLabel(date)
    return { title, sub: title === weekLabel(date) ? date.slice(0, 4) : weekLabel(date) }
  }
  const d = new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, 1)
  const name = cap(MONTHS[d.getMonth()])
  return { title: name, sub: String(d.getFullYear()) }
}

export function shiftPeriod(period: Period, date: string, dir: number) {
  if (period === 'day') return addDays(date, dir)
  if (period === 'week') return addDays(date, dir * 7)
  if (period === 'month') return addMonths(date, dir)
  return date
}
