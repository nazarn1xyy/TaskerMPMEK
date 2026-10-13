import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowDownToLine, ChevronLeft, ChevronRight, FileText, Paperclip, X } from 'lucide-react'
import { fileUrl } from '../lib/api'
import { removeAttachment, uploadFiles, useStore } from '../lib/store'
import { useAttachmentsOf } from '../lib/hooks'
import { useFileDrop } from '../lib/dnd'
import type { Attachment, OwnerType } from '../lib/types'
import { formatSize } from './ui'
import { ask } from './Dialog'

const isImage = (a: Attachment) => a.mime.startsWith('image/')

export function Files({ ownerType, ownerId, label = 'Файли' }: { ownerType: OwnerType; ownerId: string; label?: string }) {
  const files = useAttachmentsOf(ownerType, ownerId)
  const uploadsAll = useStore((s) => s.uploads)
  const uploads = useMemo(() => Object.entries(uploadsAll).filter(([, u]) => u.ownerId === ownerId), [uploadsAll, ownerId])
  const input = useRef<HTMLInputElement>(null)
  const { over, props } = useFileDrop((list) => uploadFiles(list, ownerType, ownerId))
  const images = files.filter(isImage)
  const others = files.filter((f) => !isImage(f))
  const [view, setView] = useState<number | null>(null)

  return (
    <div className={`files${over ? ' is-over' : ''}`} {...props}>
      {images.length > 0 && (
        <div className="thumbs">
          {images.map((a, i) => (
            <button key={a.id} type="button" className="thumb" onClick={() => setView(i)} title={a.name}>
              <img src={fileUrl(a, { thumb: a.thumb })} alt={a.name} loading="lazy" decoding="async" />
            </button>
          ))}
        </div>
      )}
      {others.map((a) => (
        <FileRow key={a.id} a={a} />
      ))}
      {uploads.map(([key, u]) => (
        <div key={key} className="file-row is-uploading">
          <FileText size={15} strokeWidth={1.5} />
          <span className="file-name">{u.name}</span>
          <span className="file-meta">{Math.round(u.progress * 100)}%</span>
          <div className="file-progress">
            <i style={{ width: `${u.progress * 100}%` }} />
          </div>
        </div>
      ))}
      <button type="button" className="add-row add-row-sm" onClick={() => input.current?.click()}>
        <Paperclip size={14} strokeWidth={1.6} />
        <span>{files.length ? 'Додати файл' : `${label}: перетягніть сюди, вставте ⌘V або виберіть`}</span>
      </button>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) uploadFiles(Array.from(e.target.files), ownerType, ownerId)
          e.target.value = ''
        }}
      />
      {view !== null && images[view] && <Lightbox images={images} index={view} onIndex={setView} onClose={() => setView(null)} />}
    </div>
  )
}

function FileRow({ a }: { a: Attachment }) {
  return (
    <div className="file-row">
      <FileText size={15} strokeWidth={1.5} />
      <a className="file-name" href={fileUrl(a)} target="_blank" rel="noreferrer">
        {a.name}
      </a>
      <span className="file-meta">{formatSize(a.size)}</span>
      <a className="icon-btn" href={fileUrl(a, { download: true })} aria-label="Завантажити" title="Завантажити">
        <ArrowDownToLine size={15} strokeWidth={1.6} />
      </a>
      <button type="button" className="icon-btn" aria-label="Видалити файл" title="Видалити" onClick={async () => (await ask({ title: `Видалити файл «${a.name}»?` })) && removeAttachment(a.id)}>
        <X size={15} strokeWidth={1.6} />
      </button>
    </div>
  )
}

/** Compact attachments under a comment. */
export function InlineFiles({ ownerType, ownerId }: { ownerType: OwnerType; ownerId: string }) {
  const files = useAttachmentsOf(ownerType, ownerId)
  const images = files.filter(isImage)
  const [view, setView] = useState<number | null>(null)
  if (!files.length) return null
  return (
    <div className="inline-files">
      {images.map((a, i) => (
        <button key={a.id} type="button" className="thumb thumb-sm" onClick={() => setView(i)}>
          <img src={fileUrl(a, { thumb: a.thumb })} alt={a.name} loading="lazy" />
        </button>
      ))}
      {files
        .filter((f) => !isImage(f))
        .map((a) => (
          <a key={a.id} className="inline-file" href={fileUrl(a)} target="_blank" rel="noreferrer">
            <FileText size={13} strokeWidth={1.5} />
            {a.name}
          </a>
        ))}
      {view !== null && images[view] && <Lightbox images={images} index={view} onIndex={setView} onClose={() => setView(null)} />}
    </div>
  )
}

export function Lightbox({ images, index, onIndex, onClose }: { images: Attachment[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const a = images[index]
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      e.stopPropagation()
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight') onIndex((index + 1) % images.length)
      if (e.key === 'ArrowLeft') onIndex((index - 1 + images.length) % images.length)
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [index, images.length, onClose, onIndex])

  return createPortal(
    <div className="lightbox" onClick={onClose}>
      <div className="lightbox-bar" onClick={(e) => e.stopPropagation()}>
        <span className="lightbox-name">{a.name}</span>
        <span className="file-meta">
          {index + 1} / {images.length} · {formatSize(a.size)}
        </span>
        <a className="icon-btn" href={fileUrl(a, { download: true })} aria-label="Завантажити">
          <ArrowDownToLine size={17} strokeWidth={1.6} />
        </a>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Закрити">
          <X size={18} strokeWidth={1.6} />
        </button>
      </div>
      <img className="lightbox-img" src={fileUrl(a)} alt={a.name} onClick={(e) => e.stopPropagation()} />
      {images.length > 1 && (
        <>
          <button type="button" className="lightbox-nav is-prev" aria-label="Попереднє" onClick={(e) => (e.stopPropagation(), onIndex((index - 1 + images.length) % images.length))}>
            <ChevronLeft size={22} strokeWidth={1.5} />
          </button>
          <button type="button" className="lightbox-nav is-next" aria-label="Наступне" onClick={(e) => (e.stopPropagation(), onIndex((index + 1) % images.length))}>
            <ChevronRight size={22} strokeWidth={1.5} />
          </button>
        </>
      )}
    </div>,
    document.body,
  )
}
