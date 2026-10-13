import { useMemo, useState } from 'react'
import { ArrowRight, Plus } from 'lucide-react'
import { addMembers, signIn, useStore } from '../lib/store'
import { useLiveTasks, useMembers } from '../lib/hooks'
import { isOverdue, plural, todayIso } from '../lib/dates'
import { dayOf } from '../lib/filters'
import { Avatar } from '../components/ui'

export function Onboarding() {
  const [names, setNames] = useState(['', '', ''])
  const ready = names.filter((n) => n.trim())
  const submit = () => ready.length && addMembers(ready)
  return (
    <div className="welcome">
      <div className="welcome-inner">
        <div className="eyebrow">
          <span>Таскер · перший запуск</span>
        </div>
        <h1 className="display">Хто в команді?</h1>
        <p className="welcome-lead">Впишіть імена. Паролів немає — кожен обирає себе на своєму пристрої. Учасників можна додати й пізніше.</p>
        <form
          className="welcome-form"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          {names.map((n, i) => (
            <label key={i} className="welcome-field">
              <span className="welcome-index">{String(i + 1).padStart(2, '0')}</span>
              <input autoFocus={i === 0} value={n} placeholder="Імʼя" onChange={(e) => setNames(names.map((x, j) => (j === i ? e.target.value : x)))} />
            </label>
          ))}
          <button type="button" className="add-row" onClick={() => setNames([...names, ''])}>
            <Plus size={15} strokeWidth={1.6} />
            <span>Ще учасник</span>
          </button>
          <button type="submit" className="btn btn-lg" disabled={!ready.length}>
            Почати роботу
            <ArrowRight size={16} strokeWidth={1.6} />
          </button>
        </form>
      </div>
    </div>
  )
}

export function Picker() {
  const members = useMembers()
  const tasks = useLiveTasks()
  const presence = useStore((s) => s.presence)
  const [name, setName] = useState('')
  const today = todayIso()

  const stats = useMemo(() => {
    const map = new Map<string, { open: number; overdue: number; today: number; done: number }>()
    for (const m of members) map.set(m.id, { open: 0, overdue: 0, today: 0, done: 0 })
    for (const t of tasks) {
      const s = t.assigneeId ? map.get(t.assigneeId) : undefined
      if (!s) continue
      if (t.status === 'open') {
        s.open++
        if (isOverdue(t, today)) s.overdue++
        if (dayOf(t) === today || t.due === today) s.today++
      }
      if (t.status === 'done' && t.completedAt && new Date(t.completedAt).toDateString() === new Date().toDateString()) s.done++
    }
    return map
  }, [members, tasks, today])

  return (
    <div className="welcome">
      <div className="welcome-inner">
        <div className="eyebrow">
          <span>
            Таскер · {members.length} {plural(members.length, ['учасник', 'учасники', 'учасників'])}
          </span>
        </div>
        <h1 className="display">Хто ви?</h1>
        <div className="people">
          {members.map((m) => {
            const s = stats.get(m.id)!
            const parts = [`${s.open} ${plural(s.open, ['відкрите', 'відкриті', 'відкритих'])}`]
            if (s.today) parts.push(`${s.today} на сьогодні`)
            if (s.done) parts.push(`${s.done} виконано сьогодні`)
            return (
              <button key={m.id} type="button" className="person" onClick={() => signIn(m.id)}>
                <Avatar member={m} size={44} online={presence.includes(m.id)} />
                <span className="person-name">{m.name}</span>
                <span className="person-meta">
                  {parts.join(' · ')}
                  {s.overdue > 0 && <em> · {s.overdue} прострочено</em>}
                </span>
                <ArrowRight className="person-go" size={18} strokeWidth={1.5} />
              </button>
            )
          })}
          <div className="person person-new">
            <Plus size={18} strokeWidth={1.5} />
            <input
              value={name}
              placeholder="Додати учасника"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && name.trim()) {
                  addMembers([name])
                  setName('')
                }
              }}
            />
          </div>
        </div>
        <p className="welcome-note">Вибір запамʼятовується на цьому пристрої. Змінити учасника можна в лівому верхньому куті.</p>
      </div>
    </div>
  )
}
