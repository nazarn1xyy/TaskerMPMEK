import { addTask, removeTask, toast, uid } from './store'
import { parseQuickAdd } from './parse'
import { plural } from './dates'
import type { Member, Project, Task } from './types'

interface Item {
  title: string
  children: string[]
}

const BULLET = /^(?:[-*•–—]\s+|\d+[.)]\s+|\[[ xX]?\]\s*)/

/** Splits pasted text into tasks; indented lines (or nested bullets) become checklist items of the line above. */
export function splitList(text: string): Item[] {
  const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.trim())
  if (lines.length < 2) return []
  const indent = (l: string) => l.match(/^[\t ]*/)![0].replace(/\t/g, '    ').length
  const base = Math.min(...lines.map(indent))
  const out: Item[] = []
  for (const line of lines) {
    const title = line.trim().replace(BULLET, '').trim()
    if (!title) continue
    if (indent(line) > base && out.length) out[out.length - 1].children.push(title)
    else out.push({ title, children: [] })
  }
  return out
}

/** Creates one task per item; returns how many were created (0 = not a list, let the paste happen normally). */
export function createFromList(text: string, defaults: Partial<Task>, ctx: { members: Member[]; projects: Project[]; me: string | null }) {
  const items = splitList(text)
  if (items.length < 2 && !(items.length === 1 && items[0].children.length)) return 0
  const created = items.map((it, i) => {
    const p = parseQuickAdd(it.title, ctx)
    return addTask({
      ...defaults,
      ...p.patch,
      title: p.title,
      tags: [...(defaults.tags ?? []), ...(p.patch.tags ?? [])],
      checklist: it.children.map((c) => ({ id: uid(), text: c, done: false, level: 0 as const })),
      order: Date.now() + i,
    })
  })
  const subs = items.reduce((n, it) => n + it.children.length, 0)
  toast(`Додано ${created.length} ${plural(created.length, ['завдання', 'завдання', 'завдань'])}${subs ? ` і ${subs} ${plural(subs, ['пункт', 'пункти', 'пунктів'])}` : ''}`, {
    label: 'Скасувати',
    run: () => created.forEach((t) => removeTask(t.id, true)),
  })
  return created.length
}
