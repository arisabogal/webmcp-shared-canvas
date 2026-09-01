'use client'

import { useEffect, useRef } from 'react'
import { Trash2 } from 'lucide-react'
import type { DeleteApprovalItem } from '@/types'

type Props = {
  items: DeleteApprovalItem[]
  onApprove: () => void
  onDecline: () => void
}

export default function DeleteApprovalDialog({ items, onApprove, onDecline }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    cancelRef.current?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onDecline()
        return
      }
      if (event.key !== 'Tab' || !dialogRef.current) return
      const controls = [...dialogRef.current.querySelectorAll<HTMLElement>('button:not(:disabled)')]
      if (!controls.length) return
      const first = controls[0]
      const last = controls[controls.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      previouslyFocused?.focus()
    }
  }, [onDecline])

  return (
    <div className="delete-approval-backdrop">
      <div
        ref={dialogRef}
        className="delete-approval-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-approval-title"
        aria-describedby="delete-approval-description"
      >
        <div className="delete-approval-heading">
          <span aria-hidden="true"><Trash2 size={16} /></span>
          <div>
            <small>Agent request</small>
            <h2 id="delete-approval-title">Delete {items.length === 1 ? 'this item?' : `${items.length} items?`}</h2>
          </div>
        </div>
        <p id="delete-approval-description">This permanently removes the selected {items.length === 1 ? 'item' : 'items'} from the canvas.</p>
        <ul className="delete-approval-items">
          {items.map((item) => (
            <li key={item.id}>
              <span>{item.name}</span>
              <small>{item.type}</small>
            </li>
          ))}
        </ul>
        <div className="delete-approval-actions">
          <button ref={cancelRef} type="button" onClick={onDecline}>Keep {items.length === 1 ? 'item' : 'items'}</button>
          <button type="button" className="destructive" onClick={onApprove}>Delete permanently</button>
        </div>
      </div>
    </div>
  )
}
