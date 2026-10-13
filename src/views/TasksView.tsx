import { useMemo } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useStore } from '../lib/store'
import { go, type Period } from '../lib/router'
import { applyFilters, buildSections, emptyFilters, periodTitle, shiftPeriod, tasksInPeriod, type Filters, type GroupBy } from '../lib/filters'
import { useHotkeys, useLiveTasks, useMembers, useNow, usePersisted, usePersistedValue, useProjects } from '../lib/hooks'
import { isOverdue, monthStart, plural, todayIso, weekStart } from '../lib/dates'
import { TaskSections } from '../components/TaskList'
import { FilterBar, WhoTabs } from '../components/FilterBar'
import { Segmented } from '../components/ui'

const PERIODS: { value: Period; label: string }[] = [
  { value: 'day', label: 'День' },
  { value: 'week', label: 'Тиждень' },
  { value: 'month', label: 'Місяць' },
  { value: 'all', label: 'Усі' },
]

export function anchorFor(period: Period, date: string) {
  if (period === 'week') return weekStart(date)
  if (period === 'month') return monthStart(date)
  return date
}

export function TasksView({ period, date }: { period: Period; date: string }) {
  useNow()
  const me = useStore((s) => s.me)
  const tasks = useLiveTasks()
  const members = useMembers()
  const projects = useProjects()
  const [who, setWho] = usePersistedValue<string>('who', 'me')
  const [filters, setFilters] = usePersisted<Filters>(`filters.${period}`, period === 'all' ? { ...emptyFilters(), status: ['open'] } : emptyFilters())
  const [groupBy, setGroupBy] = usePersistedValue<GroupBy>(`group.${period}`, 'date')
  const today = todayIso()

  const whoId = who === 'me' ? me : who === 'all' ? null : members.some((m) => m.id === who) ? who : me
  const visible = useMemo(() => applyFilters(tasksInPeriod(tasks, period, date, today), filters, whoId), [tasks, period, date, today, filters, whoId])
  const sections = useMemo(() => {
    const list = buildSections(visible, groupBy, { period, date, members, projects, today })
    return list.map((s) => (s.create ? { ...s, create: { assigneeId: whoId ?? me, ...s.create } } : s))
  }, [visible, groupBy, period, date, members, projects, today, whoId, me])

  const { title, sub } = periodTitle(period, date, today)
  const open = visible.filter((t) => t.status === 'open').length
  const overdue = visible.filter((t) => isOverdue(t, today)).length
  const done = visible.filter((t) => t.status === 'done').length

  const move = (dir: number) => go({ name: 'tasks', period, date: shiftPeriod(period, date, dir) })
  useHotkeys({
    arrowleft: () => period !== 'all' && move(-1),
    arrowright: () => period !== 'all' && move(1),
    t: () => go({ name: 'tasks', period, date: anchorFor(period, today) }),
    е: () => go({ name: 'tasks', period, date: anchorFor(period, today) }),
  })

  const whoName = whoId === me ? 'мої' : whoId ? members.find((m) => m.id === whoId)?.name : 'уся команда'
  const isCurrent = period === 'all' || anchorFor(period, today) === date

  return (
    <div className="page">
      <header className="page-head">
        <div className="eyebrow">
          <span>Завдання · {whoName}</span>
        </div>
        <h1 className="display">{title}</h1>
        <p className="head-sub">
          {sub && <span>{sub}</span>}
          <span>
            {open} {plural(open, ['відкрите', 'відкриті', 'відкритих'])}
          </span>
          {overdue > 0 && <span className="is-alert">{overdue} прострочено</span>}
          {done > 0 && <span>{done} виконано</span>}
        </p>
      </header>

      <div className="toolbar">
        <Segmented value={period} options={PERIODS} onChange={(p) => go({ name: 'tasks', period: p, date: anchorFor(p, date) })} />
        {period !== 'all' && (
          <div className="pager">
            <button type="button" className="icon-btn" aria-label="Назад" title="Назад · ←" onClick={() => move(-1)}>
              <ChevronLeft size={18} strokeWidth={1.6} />
            </button>
            <button type="button" className="link-btn" disabled={isCurrent} onClick={() => go({ name: 'tasks', period, date: anchorFor(period, today) })} title="T">
              Сьогодні
            </button>
            <button type="button" className="icon-btn" aria-label="Вперед" title="Вперед · →" onClick={() => move(1)}>
              <ChevronRight size={18} strokeWidth={1.6} />
            </button>
          </div>
        )}
        <WhoTabs value={who} onChange={setWho} />
      </div>

      <FilterBar filters={filters} onFilters={setFilters} groupBy={groupBy} onGroupBy={setGroupBy} />

      <TaskSections sections={sections} options={{ showAssignee: whoId === null }} />

      {tasks.length === 0 && <QuickHelp />}
    </div>
  )
}

export function QuickHelp() {
  return (
    <aside className="quickhelp">
      <h4>Швидке додавання розуміє</h4>
      <dl>
        <dt>завтра, в пт, 17.10, через 3 дні</dt>
        <dd>день</dd>
        <dt>о 15:00</dt>
        <dd>час</dd>
        <dt>до пʼятниці</dt>
        <dd>дедлайн</dd>
        <dt>на тиждень, на місяць, у листопаді</dt>
        <dd>термін, ширший за день</dd>
        <dt>щодня, по буднях, щопонеділка</dt>
        <dd>повтор</dd>
        <dt>@імʼя</dt>
        <dd>виконавець</dd>
        <dt>#проєкт або #тег</dt>
        <dd>проєкт або тег</dd>
        <dt>! !! !!!</dt>
        <dd>пріоритет</dd>
      </dl>
    </aside>
  )
}
