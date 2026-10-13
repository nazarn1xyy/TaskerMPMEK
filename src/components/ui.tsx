import { memo, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check } from 'lucide-react'
import { fileUrl } from '../lib/api'
import { useStore } from '../lib/store'
import type { Member } from '../lib/types'

export const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase() || '·'

export const Avatar = memo(function Avatar({ member, size = 22, online }: { member?: Member | null; size?: number; online?: boolean }) {
  const att = useStore((s) => (member?.avatarId ? s.attachments[member.avatarId] : undefined))
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }} title={member?.name}>
      {att ? <img src={fileUrl(att, { thumb: att.thumb })} alt="" loading="lazy" /> : member ? initials(member.name) : '?'}
      {online && <i className="avatar-online" />}
    </span>
  )
})

export const Kbd = ({ children }: { children: ReactNode }) => <kbd className="kbd">{children}</kbd>

// ---------- popover ----------

type Placement = 'bottom-start' | 'bottom-end' | 'right-start'

export function Popover({
  anchor,
  onClose,
  children,
  placement = 'bottom-start',
  className = '',
}: {
  anchor: HTMLElement | null
  onClose: () => void
  children: ReactNode
  placement?: Placement
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  useLayoutEffect(() => {
    if (!anchor || !ref.current) return
    const place = () => {
      const a = anchor.getBoundingClientRect()
      const p = ref.current!.getBoundingClientRect()
      const gap = 6
      let top = placement === 'right-start' ? a.top : a.bottom + gap
      let left = placement === 'bottom-end' ? a.right - p.width : placement === 'right-start' ? a.right + gap : a.left
      if (top + p.height > innerHeight - 8) top = Math.max(8, (placement === 'right-start' ? a.bottom : a.top - gap) - p.height)
      left = Math.min(Math.max(8, left), innerWidth - p.width - 8)
      setPos({ top, left })
    }
    place()
    const ro = new ResizeObserver(place)
    ro.observe(ref.current)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [anchor, placement])

  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target as Node
      if (ref.current?.contains(t) || anchor?.contains(t)) return
      // clicks inside nested popovers (portaled siblings) should not close the parent
      if ((t as HTMLElement).closest?.('.popover')) return
      onClose()
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
        anchor?.focus()
      }
    }
    document.addEventListener('pointerdown', down, true)
    document.addEventListener('keydown', key, true)
    return () => {
      document.removeEventListener('pointerdown', down, true)
      document.removeEventListener('keydown', key, true)
    }
  }, [anchor, onClose])

  return createPortal(
    <div ref={ref} className={`popover ${className}`} style={pos ? { top: pos.top, left: pos.left } : { visibility: 'hidden', top: 0, left: 0 }}>
      {children}
    </div>,
    document.body,
  )
}

/** Button that toggles a popover anchored to itself. */
export function PopButton({
  label,
  children,
  className = '',
  placement,
  title,
  popClass,
  disabled,
}: {
  label: ReactNode
  children: (close: () => void) => ReactNode
  className?: string
  placement?: Placement
  title?: string
  popClass?: string
  disabled?: boolean
}) {
  const [el, setEl] = useState<HTMLButtonElement | null>(null)
  const [open, setOpen] = useState(false)
  return (
    <>
      <button ref={setEl} type="button" className={className} title={title} aria-expanded={open} disabled={disabled} onClick={() => setOpen((v) => !v)}>
        {label}
      </button>
      {open && (
        <Popover anchor={el} onClose={() => setOpen(false)} placement={placement} className={popClass}>
          {children(() => setOpen(false))}
        </Popover>
      )}
    </>
  )
}

// ---------- menu ----------

export interface MenuItem {
  key: string
  label: ReactNode
  hint?: ReactNode
  icon?: ReactNode
  checked?: boolean
  danger?: boolean
  divider?: boolean
  header?: boolean
  onSelect?: () => void
}

export function Menu({ items, onDone, multi }: { items: MenuItem[]; onDone?: () => void; multi?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const first = ref.current?.querySelector<HTMLButtonElement>('button[aria-checked="true"]') ?? ref.current?.querySelector<HTMLButtonElement>('button')
    first?.focus({ preventScroll: true })
  }, [])
  const move = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const list = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
    const i = list.indexOf(document.activeElement as HTMLButtonElement)
    list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus()
  }
  return (
    <div className="menu" role="menu" ref={ref} onKeyDown={move}>
      {items.map((it) =>
        it.header ? (
          <div key={it.key} className="menu-title">
            {it.label}
          </div>
        ) : it.divider ? (
          <div key={it.key} className="menu-divider" />
        ) : (
          <button
            key={it.key}
            type="button"
            role={multi ? 'menuitemcheckbox' : 'menuitemradio'}
            aria-checked={Boolean(it.checked)}
            className={`menu-item${it.danger ? ' is-danger' : ''}`}
            onClick={() => {
              it.onSelect?.()
              if (!multi) onDone?.()
            }}
          >
            {it.icon !== undefined && <span className="menu-icon">{it.icon}</span>}
            <span className="menu-label">{it.label}</span>
            {it.hint && <span className="menu-hint">{it.hint}</span>}
            <span className="menu-check">{it.checked && <Check size={14} strokeWidth={1.75} />}</span>
          </button>
        ),
      )}
    </div>
  )
}

export function Segmented<T extends string>({ value, options, onChange, size }: { value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void; size?: 'sm' }) {
  return (
    <div className={`seg${size === 'sm' ? ' seg-sm' : ''}`} role="tablist">
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" title={o.title} aria-selected={o.value === value} className="seg-item" onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Textarea that grows with its content. */
export function AutoText({ value, onChange, className = '', ...rest }: { value: string; onChange: (v: string) => void } & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'>) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${el.scrollHeight}px`
  }, [value])
  return <textarea ref={ref} rows={1} className={`autotext ${className}`} value={value} onChange={(e) => onChange(e.target.value)} {...rest} />
}

export function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} МБ`
}
