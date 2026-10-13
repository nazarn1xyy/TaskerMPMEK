import type { Task } from './types'

const pad = (n: number) => String(n).padStart(2, '0')

export const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

export const parse = (s: string) => {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d || 1)
}

export const todayIso = () => iso(new Date())
export const nowHM = () => {
  const d = new Date()
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export const addDays = (s: string, n: number) => {
  const d = parse(s)
  d.setDate(d.getDate() + n)
  return iso(d)
}

export const addMonths = (s: string, n: number) => {
  const d = parse(s)
  const day = d.getDate()
  d.setDate(1)
  d.setMonth(d.getMonth() + n)
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  d.setDate(Math.min(day, last))
  return iso(d)
}

/** Monday-based weekday: 0 = Mon … 6 = Sun */
export const weekday = (s: string) => (parse(s).getDay() + 6) % 7

export const weekStart = (s: string) => addDays(s, -weekday(s))
export const weekEnd = (s: string) => addDays(weekStart(s), 6)
export const monthStart = (s: string) => `${s.slice(0, 7)}-01`
export const monthEnd = (s: string) => {
  const d = parse(s)
  return iso(new Date(d.getFullYear(), d.getMonth() + 1, 0))
}

export const diffDays = (a: string, b: string) => Math.round((parse(a).getTime() - parse(b).getTime()) / 86400000)

export function daysBetween(start: string, end: string) {
  const out: string[] = []
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d)
  return out
}

// ---------- words ----------

export const MONTHS = ['січень', 'лютий', 'березень', 'квітень', 'травень', 'червень', 'липень', 'серпень', 'вересень', 'жовтень', 'листопад', 'грудень']
export const MONTHS_GEN = ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня', 'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня']
export const MONTHS_SHORT = ['січ', 'лют', 'бер', 'квіт', 'трав', 'черв', 'лип', 'серп', 'вер', 'жовт', 'лист', 'груд']
export const WEEKDAYS = ['понеділок', 'вівторок', 'середа', 'четвер', 'пʼятниця', 'субота', 'неділя']
export const WEEKDAYS_SHORT = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'нд']

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export function plural(n: number, forms: [string, string, string]) {
  const a = Math.abs(n) % 100
  const b = a % 10
  if (a > 10 && a < 20) return forms[2]
  if (b > 1 && b < 5) return forms[1]
  if (b === 1) return forms[0]
  return forms[2]
}

export const tasksWord = (n: number) => `${n} ${plural(n, ['завдання', 'завдання', 'завдань'])}`

export function shortDate(s: string, withYear = false) {
  const d = parse(s)
  const base = `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`
  return withYear || d.getFullYear() !== new Date().getFullYear() ? `${base} ${d.getFullYear()}` : base
}

export function longDate(s: string) {
  const d = parse(s)
  return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]} ${d.getFullYear()}`
}

/** «Сьогодні», «Завтра», «Пт», «17 жовт» */
export function relDay(s: string, today = todayIso()) {
  const diff = diffDays(s, today)
  if (diff === 0) return 'Сьогодні'
  if (diff === 1) return 'Завтра'
  if (diff === -1) return 'Вчора'
  if (diff > 1 && diff < 7) return cap(WEEKDAYS_SHORT[weekday(s)])
  return shortDate(s)
}

export function weekLabel(start: string) {
  const end = addDays(start, 6)
  const a = parse(start)
  const b = parse(end)
  if (a.getMonth() === b.getMonth()) return `${a.getDate()}–${b.getDate()} ${MONTHS_GEN[b.getMonth()]}`
  return `${a.getDate()} ${MONTHS_SHORT[a.getMonth()]} – ${b.getDate()} ${MONTHS_SHORT[b.getMonth()]}`
}

export function monthLabel(s: string) {
  const d = parse(s)
  const name = cap(MONTHS[d.getMonth()])
  return d.getFullYear() === new Date().getFullYear() ? name : `${name} ${d.getFullYear()}`
}

export function relWeek(start: string, today = todayIso()) {
  const diff = diffDays(start, weekStart(today)) / 7
  if (diff === 0) return 'Цей тиждень'
  if (diff === 1) return 'Наст. тиждень'
  if (diff === -1) return 'Минулий тиждень'
  return `Тиждень ${weekLabel(start)}`
}

export function relMonth(start: string, today = todayIso()) {
  if (start.slice(0, 7) === today.slice(0, 7)) return 'Цей місяць'
  if (start.slice(0, 7) === addMonths(monthStart(today), 1).slice(0, 7)) return 'Наст. місяць'
  return monthLabel(start)
}

export function timeAgo(ts: number) {
  const s = Math.round((Date.now() - ts) / 1000)
  if (s < 45) return 'щойно'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} хв тому`
  const d = new Date(ts)
  const day = iso(d)
  const t = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const diff = diffDays(todayIso(), day)
  if (diff === 0) return `сьогодні, ${t}`
  if (diff === 1) return `учора, ${t}`
  return `${shortDate(day)}, ${t}`
}

// ---------- task placement ----------

/** The [start, end] days a task's horizon covers, or null for «без терміну». */
export function taskSpan(t: Pick<Task, 'scope' | 'date'>): [string, string] | null {
  if (!t.date || t.scope === 'none') return null
  if (t.scope === 'day') return [t.date, t.date]
  if (t.scope === 'week') return [weekStart(t.date), weekEnd(t.date)]
  return [monthStart(t.date), monthEnd(t.date)]
}

/** Last day the task is supposed to be finished by. */
export function taskEnd(t: Task): string | null {
  if (t.due) return t.due
  return taskSpan(t)?.[1] ?? null
}

export function isOverdue(t: Task, today = todayIso()) {
  if (t.status !== 'open') return false
  const end = taskEnd(t)
  if (!end) return false
  if (end < today) return true
  return Boolean(t.due && t.due === today && t.dueTime && t.dueTime < nowHM())
}

/** The single day a task sits on in day-level views, if any. */
export function placeDay(t: Task): string | null {
  if (t.scope === 'day' && t.date) return t.date
  if (t.scope === 'none' && t.due) return t.due
  return null
}

export function overlaps(t: Task, start: string, end: string) {
  const span = taskSpan(t)
  if (span && span[0] <= end && span[1] >= start) return true
  return Boolean(t.due && t.due >= start && t.due <= end)
}
