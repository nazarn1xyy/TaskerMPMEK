import { useRef, useState, type DragEvent } from 'react'

/**
 * Native drag-and-drop for tasks. The dragged id lives here because
 * dataTransfer contents are unreadable during dragover.
 */
let current: string | null = null

export const drag = {
  start(e: DragEvent, id: string) {
    current = id
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/x-task', id)
    document.documentElement.classList.add('is-dragging')
  },
  end() {
    current = null
    document.documentElement.classList.remove('is-dragging')
  },
  get id() {
    return current
  },
}

export const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes('Files')

/** Drop zone for a dragged task. `over` drives the highlight. */
export function useTaskDrop(onDrop: (id: string, e: DragEvent) => void, accept: (id: string) => boolean = () => true) {
  const [over, setOver] = useState(false)
  const depth = useRef(0)
  const props = {
    onDragEnter: () => {
      if (!current || !accept(current)) return
      depth.current++
      setOver(true)
    },
    onDragOver: (e: DragEvent) => {
      if (!current || !accept(current)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
    },
    onDragLeave: () => {
      if (!current) return
      depth.current = Math.max(0, depth.current - 1)
      if (!depth.current) setOver(false)
    },
    onDrop: (e: DragEvent) => {
      depth.current = 0
      setOver(false)
      const id = current
      if (!id || !accept(id)) return
      e.preventDefault()
      e.stopPropagation()
      drag.end()
      onDrop(id, e)
    },
  }
  return { over, props }
}

/** Drop zone for files from the OS. */
export function useFileDrop(onFiles: (files: File[]) => void) {
  const [over, setOver] = useState(false)
  const depth = useRef(0)
  const props = {
    onDragEnter: (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth.current++
      setOver(true)
    },
    onDragOver: (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    },
    onDragLeave: (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth.current = Math.max(0, depth.current - 1)
      if (!depth.current) setOver(false)
    },
    onDrop: (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth.current = 0
      setOver(false)
      onFiles(Array.from(e.dataTransfer.files))
    },
  }
  return { over, props }
}
