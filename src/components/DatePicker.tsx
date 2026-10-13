import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import {
  addDays,
  addMonths,
  cap,
  MONTHS,
  MONTHS_SHORT,
  monthStart,
  parse,
  relDay,
  relMonth,
  relWeek,
  shortDate,
  todayIso,
  weekday,
  WEEKDAYS_SHORT,
  weekEnd,
  weekStart,
} from '../lib/dates'
import type { Scope, Task } from '../lib/types'
import { Segmented } from './ui'

type Mode = 'day' | 'week' | 'month'

export function MiniCalendar({ value, mode, onPick, marks }: { value: string | null; mode: Mode; onPick: (d: string) => void; marks?: Set<string> }) {
  const today = todayIso()
  const [cursor, setCursor] = useState(() => monthStart(value ?? today))
  const [hoverWeek, setHoverWeek] = useState<string | null>(null)

  const days = useMemo(() => {
    const start = weekStart(cursor)
    return Array.from({ length: 42 }, (_, i) => addDays(start, i))
  }, [cursor])

  if (mode === 'month') {
    const year = Number(cursor.slice(0, 4))
    return (
      <div className="minical">
        <div className="minical-head">
          <span>{year}</span>
          <div className="minical-nav">
            <button type="button" className="icon-btn" aria-label="Попередній рік" onClick={() => setCursor(addMonths(cursor, -12))}>
              <ChevronLeft size={16} strokeWidth={1.6} />
            </button>
            <button type="button" className="icon-btn" aria-label="Наступний рік" onClick={() => setCursor(addMonths(cursor, 12))}>
              <ChevronRight size={16} strokeWidth={1.6} />
            </button>
          </div>
        </div>
        <div className="minical-months">
          {MONTHS.map((m, i) => {
            const d = `${year}-${String(i + 1).padStart(2, '0')}-01`
            return (
              <button key={m} type="button" className={`minical-month${value && monthStart(value) === d ? ' is-selected' : ''}${monthStart(today) === d ? ' is-today' : ''}`} onClick={() => onPick(d)}>
                {cap(MONTHS_SHORT[i])}
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  const selWeek = value && mode === 'week' ? weekStart(value) : null
  return (
    <div className="minical">
      <div className="minical-head">
        <span>
          {cap(MONTHS[parse(cursor).getMonth()])} {cursor.slice(0, 4)}
        </span>
        <div className="minical-nav">
          <button type="button" className="icon-btn" aria-label="Попередній місяць" onClick={() => setCursor(addMonths(cursor, -1))}>
            <ChevronLeft size={16} strokeWidth={1.6} />
          </button>
          <button type="button" className="icon-btn" aria-label="Наступний місяць" onClick={() => setCursor(addMonths(cursor, 1))}>
            <ChevronRight size={16} strokeWidth={1.6} />
          </button>
        </div>
      </div>
      <div className="minical-grid" onMouseLeave={() => setHoverWeek(null)}>
        {WEEKDAYS_SHORT.map((w) => (
          <span key={w} className="minical-wd">
            {w}
          </span>
        ))}
        {days.map((d) => {
          const ws = weekStart(d)
          const inWeek = mode === 'week' && (ws === selWeek || ws === hoverWeek)
          const cls = [
            'minical-day',
            d.slice(0, 7) !== cursor.slice(0, 7) && 'is-out',
            d === today && 'is-today',
            mode === 'day' && d === value && 'is-selected',
            inWeek && 'is-inweek',
            inWeek && weekday(d) === 0 && 'is-wstart',
            inWeek && weekday(d) === 6 && 'is-wend',
            ws === selWeek && 'is-selweek',
            weekday(d) > 4 && 'is-weekend',
          ]
            .filter(Boolean)
            .join(' ')
          return (
            <button key={d} type="button" className={cls} onMouseEnter={() => mode === 'week' && setHoverWeek(ws)} onClick={() => onPick(mode === 'week' ? ws : d)}>
              {Number(d.slice(8))}
              {marks?.has(d) && <i className="minical-mark" />}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function whenLabel(t: Pick<Task, 'scope' | 'date'>) {
  if (t.scope === 'none' || !t.date) return 'Без терміну'
  if (t.scope === 'day') return relDay(t.date) === shortDate(t.date) ? shortDate(t.date) : `${relDay(t.date)}, ${shortDate(t.date)}`
  if (t.scope === 'week') return relWeek(t.date)
  return relMonth(t.date)
}

export function WhenPicker({ task, onChange, onDone }: { task: Pick<Task, 'scope' | 'date'>; onChange: (p: Partial<Task>) => void; onDone: () => void }) {
  const [mode, setMode] = useState<Scope>(task.scope === 'none' ? 'day' : task.scope)
  const today = todayIso()
  const pick = (scope: Scope, date: string | null) => {
    onChange({ scope, date })
    onDone()
  }
  const quick: [string, () => void][] =
    mode === 'day'
      ? [
          ['Сьогодні', () => pick('day', today)],
          ['Завтра', () => pick('day', addDays(today, 1))],
          ['Пн', () => pick('day', addDays(weekStart(today), 7))],
        ]
      : mode === 'week'
        ? [
            ['Цей', () => pick('week', weekStart(today))],
            ['Наступний', () => pick('week', addDays(weekStart(today), 7))],
          ]
        : [
            ['Цей', () => pick('month', monthStart(today))],
            ['Наступний', () => pick('month', addMonths(monthStart(today), 1))],
          ]
  return (
    <div className="picker">
      <Segmented
        size="sm"
        value={mode}
        onChange={(v) => (v === 'none' ? pick('none', null) : setMode(v))}
        options={[
          { value: 'day', label: 'День' },
          { value: 'week', label: 'Тиждень' },
          { value: 'month', label: 'Місяць' },
          { value: 'none', label: 'Без терміну' },
        ]}
      />
      <div className="picker-quick">
        {quick.map(([label, fn]) => (
          <button key={label} type="button" className="link-btn" onClick={fn}>
            {label}
          </button>
        ))}
      </div>
      {mode !== 'none' && <MiniCalendar value={task.scope === mode ? task.date : null} mode={mode as Mode} onPick={(d) => pick(mode, d)} />}
    </div>
  )
}

export function deadlineLabel(t: Pick<Task, 'due' | 'dueTime'>) {
  if (!t.due) return 'Немає'
  return `${relDay(t.due) === shortDate(t.due) ? shortDate(t.due) : `${relDay(t.due)}, ${shortDate(t.due)}`}${t.dueTime ? `, ${t.dueTime}` : ''}`
}

export function DeadlinePicker({ task, onChange, onDone }: { task: Pick<Task, 'due' | 'dueTime' | 'scope' | 'date'>; onChange: (p: Partial<Task>) => void; onDone: () => void }) {
  const today = todayIso()
  const [time, setTime] = useState(task.dueTime ?? '')
  const set = (due: string | null) => {
    onChange({ due, dueTime: due ? time || null : null })
    onDone()
  }
  const friday = addDays(weekStart(today), 4) >= today ? addDays(weekStart(today), 4) : addDays(weekStart(today), 11)
  const quick: [string, string][] = [
    ['Сьогодні', today],
    ['Завтра', addDays(today, 1)],
    ['Пʼятниця', friday],
  ]
  if (task.scope !== 'none' && task.date) {
    const end = task.scope === 'day' ? task.date : task.scope === 'week' ? weekEnd(task.date) : addDays(addMonths(monthStart(task.date), 1), -1)
    quick.push(['Кінець терміну', end])
  }
  return (
    <div className="picker">
      <div className="picker-quick">
        {quick.map(([label, d]) => (
          <button key={label} type="button" className="link-btn" onClick={() => set(d)}>
            {label}
          </button>
        ))}
      </div>
      <MiniCalendar value={task.due} mode="day" onPick={set} />
      <div className="picker-row">
        <label className="picker-time">
          <span>Час</span>
          <input
            type="time"
            value={time}
            onChange={(e) => {
              setTime(e.target.value)
              if (task.due) onChange({ dueTime: e.target.value || null })
            }}
          />
        </label>
        {task.due && (
          <button type="button" className="link-btn is-danger" onClick={() => set(null)}>
            Прибрати дедлайн
          </button>
        )}
      </div>
    </div>
  )
}
