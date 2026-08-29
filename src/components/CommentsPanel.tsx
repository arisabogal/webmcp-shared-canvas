'use client'

import { ArrowUp, Check, Sparkles, X } from 'lucide-react'
import { useState } from 'react'
import type { CanvasElement } from '@/types'

export default function CommentsPanel({ element, onClose, onUpdate }: { element: CanvasElement; onClose: () => void; onUpdate: (element: CanvasElement) => void }) {
  const [text, setText] = useState('')
  const addComment = () => {
    if (!text.trim()) return
    onUpdate({ ...element, comments: [...element.comments, { id: crypto.randomUUID(), author: 'You', body: text.trim(), createdAt: Date.now() }] })
    setText('')
  }
  return (
    <aside className="comments-panel" aria-label={`Comments on ${element.name}`}>
      <header><div><span>Thread</span><strong>{element.name}</strong></div><button onClick={onClose} aria-label="Close comments"><X size={16} /></button></header>
      <div className="comment-list">
        {element.comments.map((comment) => (
          <div className="comment" key={comment.id}>
            <div className={`comment-avatar ${comment.author === 'Agent' ? 'agent' : ''}`}>{comment.author === 'Agent' ? <Sparkles size={12} /> : 'AS'}</div>
            <div><div><strong>{comment.author}</strong><span>{new Date(comment.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></div><p>{comment.body}</p></div>
          </div>
        ))}
        {!element.comments.length && <p className="empty-thread">No comments yet.</p>}
      </div>
      <div className="resolve-row"><Check size={13} /> Mark resolved</div>
      <div className="comment-input"><textarea value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addComment() } }} placeholder="Reply…" /><button onClick={addComment} aria-label="Send comment"><ArrowUp size={15} /></button></div>
    </aside>
  )
}
