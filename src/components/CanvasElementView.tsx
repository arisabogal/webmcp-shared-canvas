'use client'

import Image from 'next/image'
import { FileText, Globe2, Maximize2, MessageCircle, Sparkles } from 'lucide-react'
import type { AgentReaction, CanvasElement } from '@/types'

type Props = {
  element: CanvasElement
  selected: boolean
  reaction?: AgentReaction
  onSelect: (event: React.PointerEvent) => void
  onDragStart: (event: React.PointerEvent) => void
  onOpenComments: () => void
  onExpand: () => void
  onChange: (patch: Partial<CanvasElement>) => void
}

const reactionContent: Record<AgentReaction, { emoji: string; label: string }> = {
  looking: { emoji: '👀', label: 'Agent is looking at this item' },
  editing: { emoji: '✍️', label: 'Agent is editing this item' },
  creating: { emoji: '✨', label: 'Agent created a new item' },
}

export default function CanvasElementView({ element, selected, reaction, onSelect, onDragStart, onOpenComments, onExpand, onChange }: Props) {
  const working = element.status === 'working'
  const csvRows = element.type === 'csv' ? (element.content || '').split(/\r?\n/).filter(Boolean).slice(0, 7).map((row) => row.split(',')) : []
  return (
    <article
      className={`canvas-element type-${element.type} ${selected ? 'selected' : ''} ${working ? 'agent-working' : ''}`}
      style={{ transform: `translate(${element.x}px, ${element.y}px)`, width: element.width, height: element.height }}
      data-element-id={element.id}
      data-element-name={element.name}
      onPointerDown={(event) => { onSelect(event); onDragStart(event) }}
      onDoubleClick={(event) => { event.stopPropagation(); onExpand() }}
    >
      {element.type === 'image' && element.src && (
        <div className="image-fill"><Image src={element.src} alt={element.name} fill sizes="440px" priority style={{ objectFit: 'cover' }} /></div>
      )}
      {element.type === 'pdf' && element.src && (
        <div className="pdf-preview"><iframe src={element.src} title={element.name} /></div>
      )}
      {(element.type === 'document' || (element.type === 'pdf' && !element.src)) && (
        <div className="document-sheet">
          <div className="document-mark"><span>{element.type === 'pdf' ? 'PDF' : 'MARKDOWN'}</span><FileText size={17} /></div>
          <h2 contentEditable suppressContentEditableWarning onBlur={(e) => onChange({ name: e.currentTarget.textContent || element.name })}>{element.name.replace(/\.(pdf|md|markdown)$/i, '')}</h2>
          <div className="document-rule" />
          <p contentEditable suppressContentEditableWarning onBlur={(e) => onChange({ content: e.currentTarget.innerText })}>{element.content}</p>
          <span className="page-number">01</span>
        </div>
      )}
      {element.type === 'csv' && (
        <div className="csv-preview">
          <div className="csv-title"><span>CSV</span><strong>{element.name}</strong></div>
          <table><tbody>{csvRows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table>
        </div>
      )}
      {element.type === 'website' && (
        <div className="web-preview">
          <div className="web-bar"><span /><span /><span /><div><Globe2 size={11} /> {element.content}</div></div>
          {element.src ? (
            <iframe
              className="web-iframe"
              src={element.src}
              title={element.name}
              loading="lazy"
              sandbox="allow-scripts allow-forms allow-popups"
              referrerPolicy="no-referrer"
            />
          ) : <div className="web-body"><b>W</b><p>Model context<br />for the<br />web.</p></div>}
        </div>
      )}
      {element.type === 'note' && (
        <div className="note-body"><span>NOTE</span><p contentEditable suppressContentEditableWarning onBlur={(e) => onChange({ content: e.currentTarget.innerText })}>{element.content}</p></div>
      )}

      {reaction && <div className={`agent-reaction reaction-${reaction}`} role="status" aria-label={reactionContent[reaction].label}><span>{reactionContent[reaction].emoji}</span></div>}
      <div className="element-label"><span>{element.name}</span>{element.createdBy === 'agent' && <Sparkles size={12} />}</div>
      <button className="expand-hint" aria-label={`Open ${element.name}`} onPointerDown={(event) => event.stopPropagation()} onClick={onExpand}><Maximize2 size={12} /></button>
      {element.comments.length > 0 && (
        <button className="comment-pin" aria-label={`${element.comments.length} comments`} onPointerDown={(e) => e.stopPropagation()} onClick={onOpenComments}>
          <MessageCircle size={13} fill="currentColor" /><span>{element.comments.length}</span>
        </button>
      )}
      {working && <div className="agent-cursor"><Sparkles size={12} /><span>Agent is working</span></div>}
      {selected && <div className="selection-corners"><i /><i /><i /><i /></div>}
    </article>
  )
}
