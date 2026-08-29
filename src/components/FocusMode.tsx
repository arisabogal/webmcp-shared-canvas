'use client'

import Image from 'next/image'
import { MessageCircle, Sparkles, X } from 'lucide-react'
import type { CanvasElement } from '@/types'

type Props = {
  element: CanvasElement
  onClose: () => void
  onChange: (patch: Partial<CanvasElement>) => void
  onOpenComments: () => void
}

export default function FocusMode({ element, onClose, onChange, onOpenComments }: Props) {
  const csvRows = element.type === 'csv' ? (element.content || '').split(/\r?\n/).filter(Boolean).map((row) => row.split(',')) : []

  return (
    <section className="focus-mode" aria-label={`${element.name} collaboration mode`}>
      <header className="focus-header">
        <button className="focus-close" onClick={onClose} aria-label="Close focus mode"><X size={17} /></button>
        <div className="focus-title"><small>{element.type} mode</small><strong>{element.name}</strong></div>
        <div className="focus-presence"><span><Sparkles size={12} /></span> Agent tools active</div>
        <button className="focus-comments" onClick={onOpenComments}><MessageCircle size={14} /> {element.comments.length || 'Comments'}</button>
      </header>

      <div className="focus-body">
        <div className={`focus-stage focus-stage-${element.type}`}>
          {element.type === 'image' && element.src && <div className="focus-image"><Image src={element.src} alt={element.name} fill sizes="100vw" style={{ objectFit: 'contain' }} /></div>}
          {element.type === 'pdf' && element.src && <iframe className="focus-pdf" src={element.src} title={element.name} />}
          {(element.type === 'document' || (element.type === 'pdf' && !element.src)) && (
            <article className="focus-document">
              <span>{element.type === 'pdf' ? 'PDF DOCUMENT' : 'MARKDOWN DOCUMENT'}</span>
              <h1 contentEditable suppressContentEditableWarning onBlur={(event) => onChange({ name: event.currentTarget.textContent || element.name })}>{element.name.replace(/\.(pdf|md|markdown)$/i, '')}</h1>
              <hr />
              <p contentEditable suppressContentEditableWarning onBlur={(event) => onChange({ content: event.currentTarget.innerText })}>{element.content}</p>
            </article>
          )}
          {element.type === 'csv' && (
            <div className="focus-csv"><span>CSV DATA</span><h1>{element.name}</h1><table><tbody>{csvRows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table></div>
          )}
          {element.type === 'website' && element.src && <iframe className="focus-web" src={element.src} title={element.name} sandbox="allow-scripts allow-forms allow-popups" />}
          {element.type === 'note' && <div className="focus-note"><span>NOTE</span><p contentEditable suppressContentEditableWarning onBlur={(event) => onChange({ content: event.currentTarget.innerText })}>{element.content}</p></div>}
        </div>
      </div>
    </section>
  )
}
