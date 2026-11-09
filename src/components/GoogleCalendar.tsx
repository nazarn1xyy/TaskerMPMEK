import { CalendarSync } from 'lucide-react'
import { api, type GEvent } from '../lib/api'
import { connectGoogle } from '../lib/gcal'
import { refreshState, toast, useStore } from '../lib/store'
import { ask } from './Dialog'

/** Connect / status line for the current member's Google Calendar. */
export function GcalBar() {
  const me = useStore((s) => s.me)
  const gcal = useStore((s) => s.gcal)
  if (!me || !gcal.enabled) return null
  const mine = gcal.connected[me]

  if (!mine || mine.broken) {
    return (
      <div className="gcal-bar">
        <CalendarSync size={16} strokeWidth={1.6} />
        <span>{mine?.broken ? 'Звʼязок з Google Календарем втрачено.' : 'Ваші завдання можуть жити у вашому Google Календарі, а зустрічі звідти — тут.'}</span>
        <button type="button" className="btn btn-sm" onClick={() => connectGoogle(me)}>
          {mine?.broken ? 'Підключити знову' : 'Підключити Google Календар'}
        </button>
      </div>
    )
  }

  return (
    <div className="gcal-bar is-on">
      <CalendarSync size={16} strokeWidth={1.6} />
      <span>
        Синхронізовано з Google · <span className="muted">{mine.email}</span>
      </span>
      <button
        type="button"
        className="link-btn"
        onClick={async () => {
          if (!(await ask({ title: 'Відключити Google Календар?', text: 'Події, що вже створені, залишаться в календарі «Таскер», але більше не оновлюватимуться.', ok: 'Відключити' }))) return
          await api.gcalDisconnect()
          await refreshState()
          toast('Google Календар відключено')
        }}
      >
        Відключити
      </button>
    </div>
  )
}

/** A read-only meeting from Google, shown among tasks. */
export function GEventItem({ ev }: { ev: GEvent }) {
  return (
    <a className="gevent" href={ev.link} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} title={`${ev.title} — відкрити в Google Календарі`}>
      <i />
      {ev.time && <span className="cal-time">{ev.time}</span>}
      <span className="gevent-title">{ev.title}</span>
    </a>
  )
}
