import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../lib/store'
import { go, openTask } from '../lib/router'
import { useLiveTasks, useMembers, usePersistedValue, useProjects } from '../lib/hooks'
import { addDays, iso, isOverdue, plural, shortDate, timeAgo, todayIso, weekStart, WEEKDAYS_SHORT, weekday } from '../lib/dates'
import { dayOf } from '../lib/filters'
import { describeActivity } from '../components/Comments'
import { Avatar, Segmented } from '../components/ui'
import type { Member, Task } from '../lib/types'

type Range = '7' | '30' | '90' | 'all'
type Metric = 'done' | 'created'

const RANGE_LABEL: Record<Range, string> = { '7': 'за 7 днів', '30': 'за 30 днів', '90': 'за 90 днів', all: 'за весь час' }

const dayOfTs = (ts: number) => iso(new Date(ts))

export function StatsView() {
  const tasks = useLiveTasks()
  const members = useMembers()
  const projects = useProjects()
  const [range, setRange] = usePersistedValue<Range>('stats.range', '30')
  const [metric, setMetric] = usePersistedValue<Metric>('stats.metric', 'done')
  const today = todayIso()

  const earliest = useMemo(() => tasks.reduce((min, t) => Math.min(min, t.createdAt), Date.now()), [tasks])
  const days = range === 'all' ? Math.max(7, Math.ceil((Date.now() - earliest) / 86400000) + 1) : Number(range)
  const from = addDays(today, -(days - 1))
  const prevFrom = addDays(from, -days)

  const inRange = (ts: number | null, a: string, b: string) => {
    if (!ts) return false
    const d = dayOfTs(ts)
    return d >= a && d <= b
  }

  const totals = useMemo(() => {
    const done = tasks.filter((t) => t.status === 'done' && inRange(t.completedAt, from, today))
    const prevDone = range === 'all' ? null : tasks.filter((t) => t.status === 'done' && inRange(t.completedAt, prevFrom, addDays(from, -1))).length
    const created = tasks.filter((t) => inRange(t.createdAt, from, today)).length
    const withDeadline = done.filter((t) => t.due)
    const onTime = withDeadline.filter((t) => dayOfTs(t.completedAt!) <= t.due!).length
    return { done: done.length, prevDone, created, onTime, withDeadline: withDeadline.length }
  }, [tasks, from, today, prevFrom, range])

  // per-member table
  const people = useMemo(
    () =>
      members.map((m) => {
        let created = 0
        let given = 0
        let done = 0
        let cancelled = 0
        let open = 0
        let overdue = 0
        let late = 0
        let withDue = 0
        for (const t of tasks) {
          if (t.createdBy === m.id && inRange(t.createdAt, from, today)) {
            created++
            if (t.assigneeId && t.assigneeId !== m.id) given++
          }
          if (t.completedBy === m.id && inRange(t.completedAt, from, today)) {
            if (t.status === 'done') {
              done++
              if (t.due) {
                withDue++
                if (dayOfTs(t.completedAt!) > t.due) late++
              }
            }
            if (t.status === 'cancelled') cancelled++
          }
          if (t.assigneeId === m.id && t.status === 'open') {
            open++
            if (isOverdue(t, today)) overdue++
          }
        }
        return { m, created, given, done, cancelled, open, overdue, onTime: withDue ? Math.round(((withDue - late) / withDue) * 100) : null }
      }),
    [members, tasks, from, today],
  )
  const maxDone = Math.max(1, ...people.map((p) => p.done))

  const delta = totals.prevDone === null ? null : totals.done - totals.prevDone

  return (
    <div className="page page-stats">
      <header className="page-head">
        <div className="eyebrow">
          <span>Статистика · уся команда</span>
        </div>
        <div className="hero">
          <span className="hero-num">{totals.done}</span>
          <span className="hero-text">
            {plural(totals.done, ['завдання закрито', 'завдання закрито', 'завдань закрито'])} {RANGE_LABEL[range]}
            {delta !== null && (
              <span className="hero-delta">
                {delta === 0 ? 'стільки ж, скільки минулого періоду' : `${delta > 0 ? '+' : '−'}${Math.abs(delta)} до минулого періоду`}
              </span>
            )}
          </span>
        </div>
        <p className="head-sub">
          <span>{totals.created} поставлено</span>
          {totals.withDeadline > 0 && <span>{Math.round((totals.onTime / totals.withDeadline) * 100)}% вчасно</span>}
          <span>{tasks.filter((t) => t.status === 'open').length} відкрито зараз</span>
          <span className={tasks.some((t) => isOverdue(t, today)) ? 'is-alert' : ''}>{tasks.filter((t) => isOverdue(t, today)).length} прострочено</span>
        </p>
      </header>

      <div className="toolbar">
        <Segmented<Range>
          value={range}
          onChange={setRange}
          options={[
            { value: '7', label: '7 днів' },
            { value: '30', label: '30 днів' },
            { value: '90', label: '90 днів' },
            { value: 'all', label: 'Весь час' },
          ]}
        />
        <Segmented<Metric>
          value={metric}
          onChange={setMetric}
          options={[
            { value: 'done', label: 'Виконано' },
            { value: 'created', label: 'Поставлено' },
          ]}
        />
      </div>

      <section className="stat-block">
        <h3 className="section-label">{metric === 'done' ? 'Виконано по днях' : 'Поставлено по днях'}</h3>
        <ColumnChart tasks={tasks} members={members} from={from} to={today} metric={metric} weekly={days > 120} />
      </section>

      <section className="stat-block">
        <h3 className="section-label">Люди</h3>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th />
                <th>Виконав(-ла)</th>
                <th>Скасував(-ла)</th>
                <th>Поставив(-ла)</th>
                <th>з них іншим</th>
                <th>Відкрито</th>
                <th>Прострочено</th>
                <th>Вчасно</th>
              </tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.m.id} onClick={() => go({ name: 'member', id: p.m.id })}>
                  <th scope="row">
                    <span className="table-person">
                      <Avatar member={p.m} size={22} />
                      {p.m.name}
                    </span>
                  </th>
                  <td>
                    <span className="cell-bar">
                      <span className="num">{p.done}</span>
                      <span className="bar">
                        <i style={{ width: `${(p.done / maxDone) * 100}%` }} />
                      </span>
                    </span>
                  </td>
                  <td className="num">{p.cancelled}</td>
                  <td className="num">{p.created}</td>
                  <td className="num">{p.given}</td>
                  <td className="num">{p.open}</td>
                  <td className={`num${p.overdue ? ' is-alert' : ''}`}>{p.overdue}</td>
                  <td className="num">{p.onTime === null ? '—' : `${p.onTime}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="stat-split">
        <section className="stat-block">
          <h3 className="section-label">Навантаження на 7 днів</h3>
          <Workload tasks={tasks} members={members} today={today} />
        </section>
        <section className="stat-block">
          <h3 className="section-label">Хто кому ставить</h3>
          <Matrix tasks={tasks} members={members} from={from} to={today} />
        </section>
      </div>

      {projects.length > 0 && (
        <section className="stat-block">
          <h3 className="section-label">Проєкти</h3>
          <div className="stat-projects">
            {projects.map((p) => {
              const own = tasks.filter((t) => t.projectId === p.id)
              const total = own.filter((t) => t.status !== 'cancelled').length
              const done = own.filter((t) => t.status === 'done').length
              const overdue = own.filter((t) => isOverdue(t, today)).length
              return (
                <button key={p.id} type="button" className="stat-project" onClick={() => go({ name: 'project', id: p.id })}>
                  <span className="stat-project-name">{p.name}</span>
                  <span className="bar">
                    <i style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
                  </span>
                  <span className="num">
                    {done}/{total}
                  </span>
                  <span className={`num${overdue ? ' is-alert' : ' muted'}`}>{overdue ? `${overdue} простр.` : '—'}</span>
                </button>
              )
            })}
          </div>
        </section>
      )}

      <section className="stat-block">
        <h3 className="section-label">Стрічка</h3>
        <Feed />
      </section>
    </div>
  )
}

function ColumnChart({ tasks, members, from, to, metric, weekly }: { tasks: Task[]; members: Member[]; from: string; to: string; metric: Metric; weekly: boolean }) {
  const wrap = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(720)
  const [hover, setHover] = useState<number | null>(null)

  useLayoutEffect(() => {
    if (!wrap.current) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, Math.floor(e.contentRect.width))))
    ro.observe(wrap.current)
    return () => ro.disconnect()
  }, [])

  const buckets = useMemo(() => {
    const keys: string[] = []
    if (weekly) for (let w = weekStart(from); w <= to; w = addDays(w, 7)) keys.push(w)
    else for (let d = from; d <= to; d = addDays(d, 1)) keys.push(d)
    const index = new Map(keys.map((k, i) => [k, i]))
    const rows = keys.map((k) => ({ key: k, total: 0, by: new Map<string, number>() }))
    for (const t of tasks) {
      const ts = metric === 'done' ? (t.status === 'done' ? t.completedAt : null) : t.createdAt
      if (!ts) continue
      const d = dayOfTs(ts)
      if (d < from || d > to) continue
      const i = index.get(weekly ? weekStart(d) : d)
      if (i === undefined) continue
      const who = (metric === 'done' ? t.completedBy : t.createdBy) ?? '?'
      rows[i].total++
      rows[i].by.set(who, (rows[i].by.get(who) ?? 0) + 1)
    }
    return rows
  }, [tasks, from, to, metric, weekly])

  const H = 180
  const AXIS = 22
  const LEFT = 28
  const plotW = width - LEFT
  const slot = plotW / buckets.length
  const barW = Math.max(2, Math.min(20, slot * 0.62, slot - 2))
  const max = Math.max(1, ...buckets.map((b) => b.total))
  const step = max <= 4 ? 1 : max <= 10 ? 2 : max <= 25 ? 5 : max <= 50 ? 10 : Math.ceil(max / 5 / 10) * 10
  const top = Math.ceil(max / step) * step
  const ticks: number[] = []
  for (let v = 0; v <= top; v += step) ticks.push(v)
  const y = (v: number) => H - (v / top) * H

  // label every Nth bucket so labels never collide
  const every = Math.ceil(44 / slot)
  const labelOf = (k: string) => (weekly ? shortDate(k) : buckets.length <= 7 ? `${WEEKDAYS_SHORT[weekday(k)]} ${Number(k.slice(8))}` : shortDate(k))
  const total = buckets.reduce((s, b) => s + b.total, 0)
  const peak = buckets.reduce((best, b, i) => (b.total > buckets[best].total ? i : best), 0)

  const h = hover !== null ? buckets[hover] : null
  const tipLeft = hover !== null ? Math.min(Math.max(LEFT + hover * slot + slot / 2, 90), width - 90) : 0

  return (
    <div className="chart" ref={wrap}>
      {total === 0 ? (
        <p className="chart-empty">За цей період поки порожньо — дані зʼявляться, коли команда почне закривати завдання.</p>
      ) : (
        <>
          <svg width={width} height={H + AXIS + 8} role="img" aria-label={`${metric === 'done' ? 'Виконано' : 'Поставлено'} завдань по ${weekly ? 'тижнях' : 'днях'}, усього ${total}`}>
            <g transform="translate(0,6)">
              {ticks.map((v) => (
                <g key={v}>
                  <line x1={LEFT} x2={width} y1={y(v)} y2={y(v)} className="chart-grid" />
                  <text x={LEFT - 8} y={y(v)} dy="0.32em" textAnchor="end" className="chart-tick">
                    {v}
                  </text>
                </g>
              ))}
              {buckets.map((b, i) => {
                if (!b.total) return null
                const x = LEFT + i * slot + (slot - barW) / 2
                const bh = Math.max(2, H - y(b.total))
                const r = Math.min(4, barW / 2, bh)
                const yy = H - bh
                return (
                  <path
                    key={b.key}
                    className={`chart-bar${hover === i ? ' is-hover' : ''}${b.key === to || (weekly && b.key === weekStart(to)) ? ' is-now' : ''}`}
                    d={`M${x},${H} V${yy + r} Q${x},${yy} ${x + r},${yy} H${x + barW - r} Q${x + barW},${yy} ${x + barW},${yy + r} V${H} Z`}
                  />
                )
              })}
              {buckets[peak].total > 0 && buckets.length > 7 && (
                <text x={LEFT + peak * slot + slot / 2} y={y(buckets[peak].total) - 6} textAnchor="middle" className="chart-label">
                  {buckets[peak].total}
                </text>
              )}
              {buckets.length <= 7 &&
                buckets.map((b, i) =>
                  b.total ? (
                    <text key={b.key} x={LEFT + i * slot + slot / 2} y={y(b.total) - 6} textAnchor="middle" className="chart-label">
                      {b.total}
                    </text>
                  ) : null,
                )}
              {buckets.map((b, i) =>
                (buckets.length - 1 - i) % every === 0 ? (
                  <text key={b.key} x={LEFT + i * slot + slot / 2} y={H + 16} textAnchor="middle" className="chart-tick">
                    {labelOf(b.key)}
                  </text>
                ) : null,
              )}
              <line x1={LEFT} x2={width} y1={H} y2={H} className="chart-axis" />
              {buckets.map((b, i) => (
                <rect
                  key={b.key}
                  x={LEFT + i * slot}
                  y={0}
                  width={slot}
                  height={H}
                  fill="transparent"
                  tabIndex={b.total ? 0 : -1}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                />
              ))}
            </g>
          </svg>
          {h && (
            <div className="tooltip" style={{ left: tipLeft }}>
              <div className="tooltip-head">
                {weekly ? `Тиждень з ${shortDate(h.key)}` : shortDate(h.key)} · {h.total}
              </div>
              {members
                .filter((m) => h.by.get(m.id))
                .map((m) => (
                  <div key={m.id} className="tooltip-row">
                    <span>{m.name}</span>
                    <span className="num">{h.by.get(m.id)}</span>
                  </div>
                ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Workload({ tasks, members, today }: { tasks: Task[]; members: Member[]; today: string }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i))
  const grid = members.map((m) => {
    const counts = days.map((d) => tasks.filter((t) => t.assigneeId === m.id && t.status === 'open' && (dayOf(t) === d || (t.due === d && dayOf(t) !== d))).length)
    const overdue = tasks.filter((t) => t.assigneeId === m.id && isOverdue(t, today)).length
    return { m, counts, overdue }
  })
  const max = Math.max(1, ...grid.flatMap((g) => g.counts))
  return (
    <div className="table-wrap">
      <table className="table table-compact">
        <thead>
          <tr>
            <th />
            {days.map((d, i) => (
              <th key={d} className={i === 0 ? 'is-now' : ''}>
                {i === 0 ? 'сьог' : WEEKDAYS_SHORT[weekday(d)]}
              </th>
            ))}
            <th>простр.</th>
          </tr>
        </thead>
        <tbody>
          {grid.map((g) => (
            <tr key={g.m.id} onClick={() => go({ name: 'member', id: g.m.id })}>
              <th scope="row">{g.m.name}</th>
              {g.counts.map((c, i) => (
                <td key={i} className="load">
                  <span className="num">{c || '·'}</span>
                  {c > 0 && (
                    <span className="load-bar">
                      <i style={{ width: `${(c / max) * 100}%` }} />
                    </span>
                  )}
                </td>
              ))}
              <td className={`num${g.overdue ? ' is-alert' : ' muted'}`}>{g.overdue || '·'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Matrix({ tasks, members, from, to }: { tasks: Task[]; members: Member[]; from: string; to: string }) {
  const count = (a: string, b: string) =>
    tasks.filter((t) => {
      const d = dayOfTs(t.createdAt)
      return t.createdBy === a && t.assigneeId === b && d >= from && d <= to
    }).length
  return (
    <div className="table-wrap">
      <table className="table table-compact">
        <thead>
          <tr>
            <th className="matrix-corner">поставив ↓ / кому →</th>
            {members.map((m) => (
              <th key={m.id}>{m.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {members.map((a) => (
            <tr key={a.id}>
              <th scope="row">{a.name}</th>
              {members.map((b) => {
                const n = count(a.id, b.id)
                return (
                  <td key={b.id} className={`num${a.id === b.id ? ' muted' : ''}`}>
                    {n || '·'}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Feed() {
  const activity = useStore((s) => s.activity)
  const members = useStore((s) => s.members)
  const projects = useStore((s) => s.projects)
  const [limit, setLimit] = useState(25)
  useEffect(() => setLimit(25), [])
  const list = activity.slice(0, limit)
  if (!list.length) return <p className="hint">Тут зʼявиться все, що робить команда: хто поставив, закрив, переніс, прокоментував.</p>
  let lastDay = ''
  return (
    <ol className="feed">
      {list.map((a) => {
        const day = dayOfTs(a.at)
        const header = day !== lastDay ? day : null
        lastDay = day
        return (
          <li key={a.id}>
            {header && <div className="feed-day">{header === todayIso() ? 'Сьогодні' : shortDate(header)}</div>}
            <div className="feed-row">
              <Avatar member={a.actorId ? members[a.actorId] : null} size={20} />
              <span className="feed-text">
                <span className="feed-who">{(a.actorId && members[a.actorId]?.name) || 'Хтось'}</span> {describeActivity(a, members, projects, true)}
              </span>
              {a.taskId && (
                <button type="button" className="link-btn" onClick={() => openTask(a.taskId!)}>
                  відкрити
                </button>
              )}
              <span className="feed-time">{timeAgo(a.at).replace(/^(сьогодні|учора), /, '')}</span>
            </div>
          </li>
        )
      })}
      {activity.length > limit && (
        <li>
          <button type="button" className="link-btn feed-more" onClick={() => setLimit(limit + 50)}>
            Показати ще
          </button>
        </li>
      )}
    </ol>
  )
}
