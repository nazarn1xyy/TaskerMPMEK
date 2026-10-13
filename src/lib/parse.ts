import type { Member, Priority, Project, Repeat, Task } from './types'
import { addDays, addMonths, diffDays, monthStart, relDay, relMonth, relWeek, shortDate, todayIso, weekday, weekStart } from './dates'

/**
 * Quick-add parser: «Подзвонити постачальнику завтра о 15:00 @Аня #закупівлі !!»
 * Pulls dates, deadlines, horizons, repeats, people, projects, tags and priority out of the title.
 */

const WD_ACC = ['понеділок', 'вівторок', 'середу', 'четвер', 'пʼятницю', 'суботу', 'неділю']
const WD_GEN = ['понеділка', 'вівторка', 'середи', 'четверга', 'пʼятниці', 'суботи', 'неділі']
const WD_ABBR = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'нд']
const MON_STEMS = ['січ', 'лют', 'берез', 'квіт', 'трав', 'черв', 'лип', 'серп', 'верес', 'жовт', 'листоп', 'груд']
const MON_PREP = ['січні', 'лютому', 'березні', 'квітні', 'травні', 'червні', 'липні', 'серпні', 'вересні', 'жовтні', 'листопаді', 'грудні']

const B = '(?<=^|\\s)'
const E = '(?=$|[\\s,.!?;])'
const MON = 'січ(?:ня|ень)?|лют(?:ого|ий)?|бер(?:езня|езень)?|квіт(?:ня|ень)?|трав(?:ня|ень)?|черв(?:ня|ень)?|лип(?:ня|ень)?|серп(?:ня|ень)?|вер(?:есня|есень)?|жовт(?:ня|ень)?|лист(?:опада|опад)?|груд(?:ня|ень)?'
const DATE = [
  'сьогодні',
  'післязавтра',
  'завтра',
  `[ву]\\s+(?:${[...WD_ACC, ...WD_ABBR].join('|')})`,
  'через\\s+(?:\\d+\\s+)?(?:дн(?:і|ів)|день|тижн(?:і|ів)|тиждень|місяц(?:і|ів)|місяць)',
  '\\d{1,2}\\.\\d{1,2}(?:\\.\\d{2,4})?',
  `\\d{1,2}\\s+(?:${MON})`,
].join('|')
const TIME = '(?:\\s+(?:(?:о|об|в|у)\\s+)?(\\d{1,2}[:.]\\d{2}))?'

const DEADLINE_RE = new RegExp(`${B}(?:до|дедлайн)\\s+(${DATE}|${WD_GEN.join('|')})${TIME}${E}`, 'i')
const PLAN_RE = new RegExp(`${B}(${DATE})${TIME}${E}`, 'i')
const TIME_RE = new RegExp(`${B}(?:(?:о|об|в|у)\\s+)?(\\d{1,2}:\\d{2})${E}`, 'i')

const SCOPE_RULES: [RegExp, (today: string) => { scope: 'week' | 'month'; date: string }][] = [
  [new RegExp(`${B}(?:на\\s+наступний\\s+тиждень|наступного\\s+тижня)${E}`, 'i'), (t) => ({ scope: 'week', date: addDays(weekStart(t), 7) })],
  [new RegExp(`${B}(?:на\\s+(?:цей\\s+)?тиждень|цього\\s+тижня)${E}`, 'i'), (t) => ({ scope: 'week', date: weekStart(t) })],
  [new RegExp(`${B}(?:на\\s+наступний\\s+місяць|наступного\\s+місяця)${E}`, 'i'), (t) => ({ scope: 'month', date: addMonths(monthStart(t), 1) })],
  [new RegExp(`${B}(?:на\\s+(?:цей\\s+)?місяць|цього\\s+місяця)${E}`, 'i'), (t) => ({ scope: 'month', date: monthStart(t) })],
]
const IN_MONTH_RE = new RegExp(`${B}[ву]\\s+(${MON_PREP.join('|')})${E}`, 'i')

const REPEAT_RULES: [RegExp, Repeat][] = [
  [new RegExp(`${B}(?:по\\s+буднях|щобудня|кожного\\s+буднього\\s+дня)${E}`, 'i'), 'weekdays'],
  [new RegExp(`${B}(?:щодня|щоденно|кожного\\s+дня|кожен\\s+день)${E}`, 'i'), 'daily'],
  [new RegExp(`${B}(?:щотижня|кожного\\s+тижня|кожен\\s+тиждень)${E}`, 'i'), 'weekly'],
  [new RegExp(`${B}(?:щомісяця|кожного\\s+місяця|кожен\\s+місяць)${E}`, 'i'), 'monthly'],
]
const REPEAT_WD_RE = new RegExp(`${B}(?:(?:кожного|кожної|кожен|кожний)\\s+|що)(${[...WD_GEN, ...WD_ACC, ...WD_ABBR].join('|')})${E}`, 'i')

const REPEAT_LABEL: Record<Repeat, string> = {
  none: '',
  daily: 'щодня',
  weekdays: 'по буднях',
  weekly: 'щотижня',
  monthly: 'щомісяця',
}

const wdIndex = (w: string) => {
  for (const list of [WD_ACC, WD_GEN, WD_ABBR]) {
    const i = list.indexOf(w)
    if (i >= 0) return i
  }
  return -1
}

function nextWeekday(idx: number, today: string) {
  return addDays(today, (idx - weekday(today) + 7) % 7)
}

function rollYear(date: string, today: string) {
  return diffDays(date, today) < -90 ? `${Number(date.slice(0, 4)) + 1}${date.slice(4)}` : date
}

function resolveDate(raw: string, today: string): string | null {
  const s = raw.toLowerCase().replace(/\s+/g, ' ').trim()
  if (s === 'сьогодні') return today
  if (s === 'завтра') return addDays(today, 1)
  if (s === 'післязавтра') return addDays(today, 2)

  const wd = wdIndex(s.replace(/^[ву] /, ''))
  if (wd >= 0) return nextWeekday(wd, today)

  const later = s.match(/^через (?:(\d+) )?(дн|день|тиж|місяц)/)
  if (later) {
    const n = Number(later[1] || 1)
    if (later[2] === 'місяц') return addMonths(today, n)
    if (later[2] === 'тиж') return addDays(today, 7 * n)
    return addDays(today, n)
  }

  const num = s.match(/^(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?$/)
  if (num) {
    const [, d, m, y] = num
    const year = y ? (y.length === 2 ? 2000 + Number(y) : Number(y)) : Number(today.slice(0, 4))
    const date = `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
    return valid(date) ? (y ? date : rollYear(date, today)) : null
  }

  const word = s.match(/^(\d{1,2}) (\S+)$/)
  if (word) {
    const m = MON_STEMS.findIndex((stem) => word[2].startsWith(stem.slice(0, 3)))
    if (m < 0) return null
    const date = `${today.slice(0, 4)}-${String(m + 1).padStart(2, '0')}-${word[1].padStart(2, '0')}`
    return valid(date) ? rollYear(date, today) : null
  }
  return null
}

function valid(date: string) {
  const [y, m, d] = date.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  return dt.getMonth() === m - 1 && dt.getDate() === d
}

const normTime = (t?: string) => {
  if (!t) return null
  const [h, m] = t.replace('.', ':').split(':').map(Number)
  if (h > 23 || m > 59) return null
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/[\s_-]+/g, '')

export interface Parsed {
  title: string
  patch: Partial<Task>
  hints: string[]
}

export function parseQuickAdd(input: string, ctx: { members: Member[]; projects: Project[]; me: string | null; today?: string }): Parsed {
  const today = ctx.today ?? todayIso()
  let text = ` ${input.replace(/['’`]/g, 'ʼ')} `
  const patch: Partial<Task> = {}
  const hints: string[] = []
  const cut = (m: RegExpMatchArray) => {
    text = text.slice(0, m.index) + ' ' + text.slice(m.index! + m[0].length)
  }

  for (const [re, repeat] of REPEAT_RULES) {
    const m = text.match(re)
    if (m) {
      patch.repeat = repeat
      cut(m)
      break
    }
  }
  if (!patch.repeat) {
    const m = text.match(REPEAT_WD_RE)
    if (m) {
      patch.repeat = 'weekly'
      patch.scope = 'day'
      patch.date = nextWeekday(wdIndex(m[1].toLowerCase()), today)
      cut(m)
    }
  }

  const dl = text.match(DEADLINE_RE)
  if (dl) {
    const date = resolveDate(dl[1], today)
    if (date) {
      patch.due = date
      patch.dueTime = normTime(dl[2])
      cut(dl)
    }
  }

  const plan = text.match(PLAN_RE)
  if (plan) {
    const date = resolveDate(plan[1], today)
    if (date) {
      patch.scope = 'day'
      patch.date = date
      const time = normTime(plan[2])
      if (time && !patch.due) {
        patch.due = date
        patch.dueTime = time
      }
      cut(plan)
    }
  }

  if (!patch.date) {
    for (const [re, fn] of SCOPE_RULES) {
      const m = text.match(re)
      if (m) {
        Object.assign(patch, fn(today))
        cut(m)
        break
      }
    }
  }
  if (!patch.date) {
    const m = text.match(IN_MONTH_RE)
    if (m) {
      const idx = MON_PREP.indexOf(m[1].toLowerCase())
      let date = `${today.slice(0, 4)}-${String(idx + 1).padStart(2, '0')}-01`
      if (date < monthStart(today)) date = `${Number(today.slice(0, 4)) + 1}${date.slice(4)}`
      patch.scope = 'month'
      patch.date = date
      cut(m)
    }
  }

  if (!patch.dueTime) {
    const m = text.match(TIME_RE)
    if (m) {
      const time = normTime(m[1])
      if (time) {
        patch.due = patch.due ?? (patch.scope === 'day' ? patch.date! : today)
        patch.dueTime = time
        if (!patch.date) Object.assign(patch, { scope: 'day', date: patch.due })
        cut(m)
      }
    }
  }

  if (patch.repeat && !patch.date && !patch.due) Object.assign(patch, { scope: 'day', date: today })

  // people
  for (const m of [...text.matchAll(/(?<=^|\s)@(\S+)/g)]) {
    const q = norm(m[1])
    const who = q === 'я' || q === 'мені' || q === 'мене' ? ctx.members.find((x) => x.id === ctx.me) : ctx.members.find((x) => norm(x.name).startsWith(q))
    if (who) {
      patch.assigneeId = who.id
      text = text.replace(m[0], ' ')
      break
    }
  }

  // projects first, then tags
  const tags: string[] = []
  for (const m of [...text.matchAll(/(?<=^|\s)#([^\s#]+)/g)]) {
    const q = norm(m[1])
    const project = !patch.projectId && ctx.projects.find((p) => !p.archived && norm(p.name).startsWith(q))
    if (project) patch.projectId = project.id
    else tags.push(m[1].toLowerCase())
    text = text.replace(m[0], ' ')
  }
  if (tags.length) patch.tags = [...new Set(tags)]

  const pr = text.match(/(?<=^|\s)(?:!([1-3])|(!{1,3})|(терміново))(?=$|\s)/i)
  if (pr) {
    patch.priority = (pr[1] ? Number(pr[1]) : pr[2] ? pr[2].length : 3) as Priority
    cut(pr)
  }

  const title = text.replace(/\s+/g, ' ').trim()

  // human-readable summary of what was understood
  if (patch.scope === 'day' && patch.date) hints.push(relDay(patch.date, today))
  if (patch.scope === 'week' && patch.date) hints.push(relWeek(patch.date, today))
  if (patch.scope === 'month' && patch.date) hints.push(relMonth(patch.date, today))
  if (patch.due) {
    const sameDay = patch.scope === 'day' && patch.date === patch.due
    hints.push(sameDay ? `до ${patch.dueTime}` : `дедлайн ${shortDate(patch.due)}${patch.dueTime ? `, ${patch.dueTime}` : ''}`)
  }
  if (patch.repeat) hints.push(REPEAT_LABEL[patch.repeat])
  if (patch.assigneeId) hints.push(ctx.members.find((m) => m.id === patch.assigneeId)!.name)
  if (patch.projectId) hints.push(ctx.projects.find((p) => p.id === patch.projectId)!.name)
  if (patch.tags) hints.push(...patch.tags.map((t) => `#${t}`))
  if (patch.priority) hints.push('!'.repeat(patch.priority))

  return { title: title || input.trim(), patch, hints }
}
