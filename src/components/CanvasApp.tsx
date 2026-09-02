'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  FileSpreadsheet, FileText, Globe2, Hand, Layers3,
  Maximize2, MousePointer2, Plus,
  Sparkles, StickyNote, Tags, Upload, X, ZoomIn, ZoomOut,
} from 'lucide-react'
import CanvasElementView from './CanvasElementView'
import CommentsPanel from './CommentsPanel'
import DeleteApprovalDialog from './DeleteApprovalDialog'
import FocusMode from './FocusMode'
import { createElement, initialElements, KEYWORD_TTL_MS, makeKeyword } from '@/data'
import { useWebMCP } from '@/useWebMCP'
import type { AgentActivity, AgentReaction, CanvasElement, CanvasRegion, DeleteApprovalDecision, DeleteApprovalItem, ElementType, KeywordGroup, Viewport } from '@/types'

const MIN_AGENT_REACTION_DURATION_MS = 3000

type SelectionRect = { left: number; top: number; width: number; height: number }
type DeleteApprovalRequest = { id: string; items: DeleteApprovalItem[] }
type PendingDeleteApproval = DeleteApprovalRequest & {
  resolve: (decision: DeleteApprovalDecision) => void
  signal?: AbortSignal
  abortHandler?: () => void
}
const selectionKey = (ids: string[]) => [...new Set(ids)].sort().join('\u001f')

function sameIds(a: string[], b: string[]) { return selectionKey(a) === selectionKey(b) }

function remainingTime(expiresAt: number, now: number) {
  const seconds = Math.max(0, Math.ceil((expiresAt - now) / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export default function CanvasApp() {
  const [elements, setElements] = useState<CanvasElement[]>(initialElements)
  const [keywords, setKeywords] = useState<KeywordGroup[]>([])
  const [activities, setActivities] = useState<AgentActivity[]>([])
  const [agentReactions, setAgentReactions] = useState<Record<string, AgentReaction>>({})
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [regions, setRegions] = useState<CanvasRegion[]>([])
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null)
  const [viewport, setViewport] = useState<Viewport>({ x: 60, y: 34, scale: 0.82 })
  const [tool, setTool] = useState<'select' | 'hand'>('select')
  const [addOpen, setAddOpen] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)
  const [selectionMenuOpen, setSelectionMenuOpen] = useState(false)
  const [linkValue, setLinkValue] = useState('')
  const [linkError, setLinkError] = useState(false)
  const [commentElementId, setCommentElementId] = useState<string | null>(null)
  const [expandedElementId, setExpandedElementId] = useState<string | null>(null)
  const [selectionRect, setSelectionRect] = useState<SelectionRect | null>(null)
  const [keywordNow, setKeywordNow] = useState(0)
  const [selectionMenuNow, setSelectionMenuNow] = useState(0)
  const [deleteApprovalRequest, setDeleteApprovalRequest] = useState<DeleteApprovalRequest | null>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const previewSelectionRef = useRef<string[] | null>(null)
  const reactionTimersRef = useRef<Map<string, number>>(new Map())
  const pendingDeleteApprovalRef = useRef<PendingDeleteApproval | null>(null)

  const showAgentReaction = useCallback((ids: string[], reaction: AgentReaction, duration = MIN_AGENT_REACTION_DURATION_MS) => {
    const uniqueIds = [...new Set(ids)]
    if (!uniqueIds.length) return
    const visibleDuration = Math.max(duration, MIN_AGENT_REACTION_DURATION_MS)
    setAgentReactions((current) => ({ ...current, ...Object.fromEntries(uniqueIds.map((id) => [id, reaction])) }))
    uniqueIds.forEach((id) => {
      const existingTimer = reactionTimersRef.current.get(id)
      if (existingTimer) window.clearTimeout(existingTimer)
      const timer = window.setTimeout(() => {
        setAgentReactions((current) => {
          const next = { ...current }
          delete next[id]
          return next
        })
        reactionTimersRef.current.delete(id)
      }, visibleDuration)
      reactionTimersRef.current.set(id, timer)
    })
  }, [])

  useEffect(() => () => {
    reactionTimersRef.current.forEach((timer) => window.clearTimeout(timer))
    reactionTimersRef.current.clear()
  }, [])

  const selectIds = useCallback((ids: string[]) => {
    const normalizedIds = [...new Set(ids)]
    setSelectedRegionId(null)
    setSelectedIds(normalizedIds)
    if (!normalizedIds.length) return
    const selectedAt = Date.now()
    const signature = selectionKey(normalizedIds)
    setKeywordNow(selectedAt)
    setKeywords((groups) => {
      const activeGroups = groups.filter((group) => group.expiresAt > selectedAt)
      const activeMatch = activeGroups.find((group) => selectionKey(group.elementIds) === signature)
      if (activeMatch) {
        return activeGroups.map((group) => group.keyword === activeMatch.keyword ? {
          ...group,
          createdAt: selectedAt,
          expiresAt: selectedAt + KEYWORD_TTL_MS,
          consumedAt: undefined,
        } : group)
      }
      return [...activeGroups, {
        keyword: makeKeyword(groups), elementIds: [...normalizedIds].sort(), createdAt: selectedAt, expiresAt: selectedAt + KEYWORD_TTL_MS,
      }].slice(-40)
    })
  }, [])

  const selectRegion = useCallback((id: string) => {
    const selectedAt = Date.now()
    setKeywordNow(selectedAt)
    setSelectedIds([])
    setSelectedRegionId(id)
    setRegions((items) => items.map((item) => item.id === id ? {
      ...item,
      createdAt: selectedAt,
      expiresAt: selectedAt + KEYWORD_TTL_MS,
    } : item))
  }, [])

  const createRegion = useCallback((rect: SelectionRect) => {
    const createdAt = Date.now()
    const region: CanvasRegion = {
      id: `region-${crypto.randomUUID()}`,
      keyword: makeKeyword([
        ...keywords,
        ...regions.map((item) => ({ keyword: item.keyword, elementIds: [], createdAt: item.createdAt, expiresAt: item.expiresAt })),
      ]),
      x: Math.round((rect.left - viewport.x) / viewport.scale),
      y: Math.round((rect.top - viewport.y) / viewport.scale),
      width: Math.round(rect.width / viewport.scale),
      height: Math.round(rect.height / viewport.scale),
      createdAt,
      expiresAt: createdAt + KEYWORD_TTL_MS,
    }
    setRegions((items) => [...items.filter((item) => item.expiresAt > createdAt), region].slice(-40))
    setSelectedIds([])
    setSelectedRegionId(region.id)
    setKeywordNow(createdAt)
  }, [keywords, regions, viewport])

  const expandElement = useCallback((id: string) => {
    selectIds([id])
    setExpandedElementId(id)
  }, [selectIds])

  const deleteElements = useCallback((ids: string[]) => {
    const deletedIds = new Set(ids)
    if (!deletedIds.size) return
    setElements((items) => items.filter((item) => !deletedIds.has(item.id)))
    setKeywords((groups) => groups
      .map((group) => ({ ...group, elementIds: group.elementIds.filter((id) => !deletedIds.has(id)) }))
      .filter((group) => group.elementIds.length > 0))
    setSelectedIds((current) => current.filter((id) => !deletedIds.has(id)))
    setExpandedElementId((current) => current && deletedIds.has(current) ? null : current)
    setCommentElementId((current) => current && deletedIds.has(current) ? null : current)
    setAgentReactions((current) => Object.fromEntries(Object.entries(current).filter(([id]) => !deletedIds.has(id))))
    previewSelectionRef.current = previewSelectionRef.current?.filter((id) => !deletedIds.has(id)) || null
    deletedIds.forEach((id) => {
      const timer = reactionTimersRef.current.get(id)
      if (timer) window.clearTimeout(timer)
      reactionTimersRef.current.delete(id)
    })
  }, [])

  const settleDeleteApproval = useCallback((decision: DeleteApprovalDecision) => {
    const pending = pendingDeleteApprovalRef.current
    if (!pending) return
    if (pending.signal && pending.abortHandler) pending.signal.removeEventListener('abort', pending.abortHandler)
    pendingDeleteApprovalRef.current = null
    setDeleteApprovalRequest(null)
    pending.resolve(decision)
  }, [])

  const requestDeleteApproval = useCallback((items: DeleteApprovalItem[], signal?: AbortSignal) => {
    if (pendingDeleteApprovalRef.current) return Promise.resolve<DeleteApprovalDecision>('busy')
    if (signal?.aborted) return Promise.resolve<DeleteApprovalDecision>('canceled')

    return new Promise<DeleteApprovalDecision>((resolve) => {
      const request: DeleteApprovalRequest = { id: crypto.randomUUID(), items }
      const abortHandler = () => {
        if (pendingDeleteApprovalRef.current?.id !== request.id) return
        settleDeleteApproval('canceled')
      }
      pendingDeleteApprovalRef.current = { ...request, resolve, signal, abortHandler }
      signal?.addEventListener('abort', abortHandler, { once: true })
      setDeleteApprovalRequest(request)
    })
  }, [settleDeleteApproval])

  const approveDeleteRequest = useCallback(() => settleDeleteApproval('approved'), [settleDeleteApproval])
  const declineDeleteRequest = useCallback(() => settleDeleteApproval('declined'), [settleDeleteApproval])

  useEffect(() => () => {
    const pending = pendingDeleteApprovalRef.current
    if (!pending) return
    if (pending.signal && pending.abortHandler) pending.signal.removeEventListener('abort', pending.abortHandler)
    pending.resolve('canceled')
    pendingDeleteApprovalRef.current = null
  }, [])

  useEffect(() => {
    if (!expandedElementId) return
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setExpandedElementId(null) }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [expandedElementId])

  const focusElement = useCallback((id: string) => {
    const element = elements.find((item) => item.id === id)
    if (!element || !canvasRef.current) return
    const rect = canvasRef.current.getBoundingClientRect()
    setViewport((current) => ({ ...current, x: rect.width / 2 - (element.x + element.width / 2) * current.scale, y: rect.height / 2 - (element.y + element.height / 2) * current.scale }))
  }, [elements])

  const focusSelection = useCallback((ids: string[]) => {
    const selectedElements = elements.filter((element) => ids.includes(element.id))
    if (!selectedElements.length || !canvasRef.current) return
    const bounds = selectedElements.reduce((result, element) => ({
      left: Math.min(result.left, element.x),
      top: Math.min(result.top, element.y),
      right: Math.max(result.right, element.x + element.width),
      bottom: Math.max(result.bottom, element.y + element.height),
    }), { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity })
    const rect = canvasRef.current.getBoundingClientRect()
    const width = Math.max(1, bounds.right - bounds.left)
    const height = Math.max(1, bounds.bottom - bounds.top)
    const scale = Math.min(1.1, Math.max(.32, Math.min((rect.width - 180) / width, (rect.height - 150) / height)))
    setViewport({
      scale,
      x: rect.width / 2 - (bounds.left + width / 2) * scale,
      y: rect.height / 2 - (bounds.top + height / 2) * scale,
    })
  }, [elements])

  const focusRegion = useCallback((region: CanvasRegion) => {
    if (!canvasRef.current) return
    const rect = canvasRef.current.getBoundingClientRect()
    const width = Math.max(1, region.width)
    const height = Math.max(1, region.height)
    const scale = region.width || region.height
      ? Math.min(1.1, Math.max(.32, Math.min((rect.width - 180) / width, (rect.height - 150) / height)))
      : viewport.scale
    setViewport({
      scale,
      x: rect.width / 2 - (region.x + region.width / 2) * scale,
      y: rect.height / 2 - (region.y + region.height / 2) * scale,
    })
  }, [viewport.scale])

  const expandedElement = elements.find((element) => element.id === expandedElementId)
  const webMcpSupported = useWebMCP({
    getElements: () => elements,
    getKeywords: () => keywords,
    getRegions: () => regions,
    getActiveElement: () => elements.find((element) => element.id === expandedElementId),
    setElements, setKeywords, setSelectedIds: selectIds, setActivities, focusElement, showAgentReaction, deleteElements, requestDeleteApproval,
  }, expandedElement)
  const agentIsActive = webMcpSupported && (
    activities.some((activity) => activity.state === 'working')
    || elements.some((element) => element.status === 'working')
    || Object.keys(agentReactions).length > 0
  )

  const latestKeyword = useMemo(() => {
    if (!selectedIds.length) return null
    return [...keywords].reverse().find((group) => group.expiresAt > keywordNow && sameIds(group.elementIds, selectedIds)) || null
  }, [keywordNow, keywords, selectedIds])

  const expandedKeyword = useMemo(() => {
    if (!expandedElementId) return null
    return [...keywords].reverse().find((group) => group.expiresAt > keywordNow && sameIds(group.elementIds, [expandedElementId])) || null
  }, [expandedElementId, keywordNow, keywords])

  const activeKeywordGroups = useMemo(() => {
    const currentTime = selectionMenuOpen ? selectionMenuNow : keywordNow
    return [...keywords]
      .filter((group) => group.expiresAt > currentTime)
      .sort((a, b) => b.createdAt - a.createdAt)
  }, [keywordNow, keywords, selectionMenuNow, selectionMenuOpen])

  const activeRegions = useMemo(() => {
    const currentTime = selectionMenuOpen ? selectionMenuNow : keywordNow
    return [...regions]
      .filter((region) => region.expiresAt > currentTime)
      .sort((a, b) => b.createdAt - a.createdAt)
  }, [keywordNow, regions, selectionMenuNow, selectionMenuOpen])

  const selectedRegion = activeRegions.find((region) => region.id === selectedRegionId) || null

  useEffect(() => {
    const nextExpiry = [...keywords.map((group) => group.expiresAt), ...regions.map((region) => region.expiresAt)]
      .filter((expiresAt) => expiresAt > keywordNow)
      .sort((a, b) => a - b)[0]
    if (!nextExpiry) return
    const timeout = window.setTimeout(() => setKeywordNow(Date.now()), Math.max(0, nextExpiry - Date.now()) + 16)
    return () => window.clearTimeout(timeout)
  }, [keywordNow, keywords, regions])

  useEffect(() => {
    if (!selectionMenuOpen) return
    const interval = window.setInterval(() => setSelectionMenuNow(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [selectionMenuOpen])

  const previewSelection = (ids: string[]) => {
    if (!previewSelectionRef.current) previewSelectionRef.current = selectedIds
    setSelectedIds(ids)
  }

  const restoreSelectionPreview = () => {
    const previous = previewSelectionRef.current
    if (previous) setSelectedIds(previous)
    previewSelectionRef.current = null
  }

  const commitKeywordGroup = (group: KeywordGroup) => {
    previewSelectionRef.current = null
    selectIds(group.elementIds)
    focusSelection(group.elementIds)
    setSelectionMenuOpen(false)
  }

  const commitRegion = (region: CanvasRegion) => {
    previewSelectionRef.current = null
    selectRegion(region.id)
    focusRegion(region)
    setSelectionMenuOpen(false)
  }

  useEffect(() => {
    if (!latestKeyword) return
    const timeout = window.setTimeout(() => {
      setKeywordNow(Date.now())
      setSelectedIds((current) => sameIds(current, latestKeyword.elementIds) ? [] : current)
    }, Math.max(0, latestKeyword.expiresAt - keywordNow) + 16)
    return () => window.clearTimeout(timeout)
  }, [keywordNow, latestKeyword])

  const commentElement = elements.find((element) => element.id === commentElementId)

  const patchElement = (id: string, patch: Partial<CanvasElement>) => setElements((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item))

  const addElementAtCenter = (type: ElementType, overrides: Partial<CanvasElement> = {}) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    const x = ((rect?.width || window.innerWidth) / 2 - viewport.x) / viewport.scale - 180
    const y = ((rect?.height || window.innerHeight) / 2 - viewport.y) / viewport.scale - 150
    const element = { ...createElement(type, x, y), ...overrides }
    setElements((items) => [...items, element]); selectIds([element.id]); setAddOpen(false)
  }

  const handleFile = (file?: File) => {
    if (!file) return
    const reader = new FileReader()
    const lowerName = file.name.toLowerCase()
    const type: ElementType = file.type.startsWith('image/') ? 'image' : file.type === 'application/pdf' || lowerName.endsWith('.pdf') ? 'pdf' : file.type === 'text/csv' || lowerName.endsWith('.csv') ? 'csv' : 'document'
    reader.onload = () => addElementAtCenter(type, {
      name: file.name,
      ...(type === 'pdf' || type === 'image' ? { src: String(reader.result), content: `${Math.max(1, Math.round(file.size / 1024))} KB ${type}` } : { content: String(reader.result) }),
    })
    if (type === 'pdf' || type === 'image') reader.readAsDataURL(file)
    else reader.readAsText(file)
  }

  const addWebReference = () => {
    if (!linkValue.trim()) return
    try {
      const url = new URL(linkValue.startsWith('http') ? linkValue : `https://${linkValue}`)
      addElementAtCenter('website', { name: url.hostname.replace('www.', ''), content: url.hostname, src: url.toString() })
      setLinkValue(''); setLinkOpen(false); setLinkError(false)
    } catch { setLinkError(true) }
  }

  const startElementDrag = (event: React.PointerEvent, element: CanvasElement) => {
    if (tool !== 'select' || event.button !== 0) return
    event.stopPropagation()
    const start = { x: event.clientX, y: event.clientY }
    const ids = selectedIds.includes(element.id) ? selectedIds : [element.id]
    const origins = new Map(elements.filter((item) => ids.includes(item.id)).map((item) => [item.id, { x: item.x, y: item.y }]))
    const move = (moveEvent: PointerEvent) => {
      const dx = (moveEvent.clientX - start.x) / viewport.scale
      const dy = (moveEvent.clientY - start.y) / viewport.scale
      setElements((items) => items.map((item) => {
        const origin = origins.get(item.id)
        return origin ? { ...item, x: origin.x + dx, y: origin.y + dy } : item
      }))
    }
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
  }

  const startCanvasPan = (event: React.PointerEvent<HTMLDivElement>) => {
    if (tool === 'hand' || event.button === 1) {
      const start = { x: event.clientX, y: event.clientY, viewport }
      const move = (moveEvent: PointerEvent) => setViewport((current) => ({ ...current, x: start.viewport.x + moveEvent.clientX - start.x, y: start.viewport.y + moveEvent.clientY - start.y }))
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
      return
    }
    if (tool !== 'select' || event.button !== 0 || event.target !== event.currentTarget || !canvasRef.current) return
    const bounds = canvasRef.current.getBoundingClientRect()
    const start = { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
    const retainedIds = event.shiftKey ? selectedIds : []
    let moved = false
    let finalRect: SelectionRect = { left: start.x, top: start.y, width: 0, height: 0 }
    setSelectionRect({ left: start.x, top: start.y, width: 0, height: 0 })
    const move = (moveEvent: PointerEvent) => {
      const current = { x: moveEvent.clientX - bounds.left, y: moveEvent.clientY - bounds.top }
      const rect = {
        left: Math.min(start.x, current.x), top: Math.min(start.y, current.y),
        width: Math.abs(current.x - start.x), height: Math.abs(current.y - start.y),
      }
      finalRect = rect
      moved ||= rect.width > 3 || rect.height > 3
      setSelectionRect(rect)
      const worldRect = {
        left: (rect.left - viewport.x) / viewport.scale,
        top: (rect.top - viewport.y) / viewport.scale,
        right: (rect.left + rect.width - viewport.x) / viewport.scale,
        bottom: (rect.top + rect.height - viewport.y) / viewport.scale,
      }
      const hits = elements.filter((element) => (
        element.x < worldRect.right && element.x + element.width > worldRect.left
        && element.y < worldRect.bottom && element.y + element.height > worldRect.top
      )).map((element) => element.id)
      const nextIds = [...new Set([...retainedIds, ...hits])]
      const nextSignature = selectionKey(nextIds)
      if (nextSignature !== currentSignature) {
        currentIds = nextIds
        currentSignature = nextSignature
        selectIds(currentIds)
      }
    }
    const up = () => {
      if (currentIds.length) selectIds(currentIds)
      else if (!retainedIds.length) createRegion(moved ? finalRect : { left: start.x, top: start.y, width: 0, height: 0 })
      setSelectionRect(null)
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up)
    }
    let currentIds = retainedIds
    let currentSignature = selectionKey(retainedIds)
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up, { once: true })
  }

  const handleWheel = (event: React.WheelEvent) => {
    event.preventDefault()
    if (event.ctrlKey || event.metaKey) {
      const nextScale = Math.min(1.6, Math.max(0.32, viewport.scale * Math.exp(-event.deltaY * 0.006)))
      const rect = canvasRef.current!.getBoundingClientRect()
      const px = event.clientX - rect.left; const py = event.clientY - rect.top
      const worldX = (px - viewport.x) / viewport.scale; const worldY = (py - viewport.y) / viewport.scale
      setViewport({ scale: nextScale, x: px - worldX * nextScale, y: py - worldY * nextScale })
    } else setViewport((current) => ({ ...current, x: current.x - event.deltaX, y: current.y - event.deltaY }))
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-mark" aria-label="Workspace home"><i /><i /><i /></div>
        <div className="workspace-title">WebMCP workspace</div>
        {expandedKeyword && (
          <div className="expanded-keyword" role="status" aria-label={`Selection keyword ${expandedKeyword.keyword}`}>
            <span>Selection</span>
            <strong>{expandedKeyword.keyword}</strong>
          </div>
        )}
        <div className="topbar-right">
          <div className={`webmcp-state ${webMcpSupported ? 'connected' : ''}`} title={webMcpSupported ? 'WebMCP tools registered' : 'WebMCP unavailable in this browser'}><span /> WebMCP</div>
          <div className="avatars"><span>AS</span>{agentIsActive && <span className="agent-avatar" role="status" aria-label="Agent active on canvas" title="Agent active on canvas"><Sparkles size={12} /></span>}<button aria-label="Invite collaborators"><Plus size={14} /></button></div>
        </div>
      </header>

      <div ref={canvasRef} className={`canvas-viewport tool-${tool}`} onPointerDown={startCanvasPan} onWheel={handleWheel}>
        <div className="world" style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})` }}>
          <div className="project-label"><span>01</span><div><b>WebMCP challenge</b><small>Human + agent collaboration</small></div></div>
          {elements.map((element) => (
            <CanvasElementView key={element.id} element={element} selected={selectedIds.includes(element.id)} reaction={agentReactions[element.id]}
              onSelect={(event) => selectIds(event.shiftKey ? (selectedIds.includes(element.id) ? selectedIds.filter((id) => id !== element.id) : [...selectedIds, element.id]) : selectedIds.includes(element.id) ? selectedIds : [element.id])}
              onDragStart={(event) => startElementDrag(event, element)} onOpenComments={() => setCommentElementId(element.id)} onExpand={() => expandElement(element.id)} onChange={(patch) => patchElement(element.id, patch)} />
          ))}
          {activeRegions.map((region) => (
            <div
              className={`canvas-region ${region.width === 0 && region.height === 0 ? 'point' : ''} ${selectedRegionId === region.id ? 'selected' : ''}`}
              data-region-id={region.id}
              key={region.id}
              style={{ transform: `translate(${region.x}px, ${region.y}px)`, width: `${region.width}px`, height: `${region.height}px` }}
            >
              <button onPointerDown={(event) => event.stopPropagation()} onClick={() => selectRegion(region.id)} title="Select this canvas region">
                {region.keyword}
              </button>
            </div>
          ))}
        </div>

        {(selectedRegion || latestKeyword) && !expandedElement && (
          <div className="keyword-toast">
            <strong>{selectedRegion?.keyword || latestKeyword?.keyword}</strong>
          </div>
        )}

        {selectionRect && <div className="selection-marquee" style={selectionRect} />}

        <nav className="tool-rail" aria-label="Canvas tools">
          <button className={tool === 'select' ? 'active' : ''} onClick={() => setTool('select')} title="Select"><MousePointer2 size={18} /></button>
          <button className={tool === 'hand' ? 'active' : ''} onClick={() => setTool('hand')} title="Pan"><Hand size={18} /></button>
          <div className="tool-divider" />
          <div className="add-wrap">
            <button
              className={selectionMenuOpen ? 'active' : ''}
              aria-label="View selections"
              aria-expanded={selectionMenuOpen}
              onClick={() => {
                if (selectionMenuOpen) restoreSelectionPreview()
                const currentTime = Date.now()
                setKeywordNow(currentTime)
                setSelectionMenuNow(currentTime)
                setSelectionMenuOpen(!selectionMenuOpen)
                setLinkOpen(false)
                setAddOpen(false)
              }}
              title="Selections"
            ><Tags size={18} /></button>
            {selectionMenuOpen && <div className="selection-menu-popover" onPointerDown={(event) => event.stopPropagation()} onMouseLeave={restoreSelectionPreview}>
              <div className="selection-menu-label">Active references</div>
              {activeRegions.map((region) => (
                <button
                  className={region.id === selectedRegionId ? 'current' : ''}
                  key={region.id}
                  onClick={() => commitRegion(region)}
                  title={`Show ${region.width || 0} × ${region.height || 0} canvas region`}
                >
                  <strong>{region.keyword}</strong>
                  <time dateTime={`PT${Math.max(0, Math.ceil((region.expiresAt - selectionMenuNow) / 1000))}S`} title="Time remaining">{remainingTime(region.expiresAt, selectionMenuNow)}</time>
                  <span className="selection-count">R</span>
                </button>
              ))}
              {activeKeywordGroups.map((group) => (
                <button
                  className={sameIds(group.elementIds, selectedIds) ? 'current' : ''}
                  key={group.keyword}
                  onMouseEnter={() => previewSelection(group.elementIds)}
                  onClick={() => commitKeywordGroup(group)}
                  title={`Show ${group.elementIds.length} selected ${group.elementIds.length === 1 ? 'item' : 'items'}`}
                >
                  <strong>{group.keyword}</strong>
                  <time dateTime={`PT${Math.max(0, Math.ceil((group.expiresAt - selectionMenuNow) / 1000))}S`} title="Time remaining">{remainingTime(group.expiresAt, selectionMenuNow)}</time>
                  <span className="selection-count">{group.elementIds.length}</span>
                </button>
              ))}
              {!activeKeywordGroups.length && !activeRegions.length && <p>No active references</p>}
            </div>}
          </div>
          <div className="add-wrap"><button className={addOpen || linkOpen ? 'active' : ''} onClick={() => { restoreSelectionPreview(); setSelectionMenuOpen(false); setAddOpen(!addOpen); setLinkOpen(false); setLinkError(false) }} title="Add element"><Plus size={19} /></button>
            {addOpen && <div className="add-menu">
              <button onClick={() => { setAddOpen(false); fileRef.current?.click() }}><Upload size={16} /><span>Add media</span></button>
              <button onClick={() => addElementAtCenter('note')}><StickyNote size={16} /><span>Note</span></button>
              <button onClick={() => addElementAtCenter('document')}><FileText size={16} /><span>Document</span></button>
              <button onClick={() => addElementAtCenter('csv')}><FileSpreadsheet size={16} /><span>CSV</span></button>
              <button onClick={() => { setAddOpen(false); setLinkOpen(true); setLinkError(false) }}><Globe2 size={16} /><span>Website</span></button>
            </div>}
            {linkOpen && <div className="link-popover">
              <label htmlFor="website-url">Embed website</label>
              <div><input id="website-url" value={linkValue} onChange={(event) => { setLinkValue(event.target.value); setLinkError(false) }} onKeyDown={(event) => event.key === 'Enter' && addWebReference()} placeholder="https://…" autoFocus /><button onClick={addWebReference}>Add</button></div>
              {linkError && <small>Enter a valid URL.</small>}
            </div>}
          </div>
        </nav>
        <input ref={fileRef} type="file" hidden accept="image/*,.md,.markdown,.pdf,.csv,.txt,text/markdown,text/csv,application/pdf" onChange={(event) => { handleFile(event.target.files?.[0]); event.currentTarget.value = '' }} />

        <div className="zoom-control"><button onClick={() => setViewport((v) => ({ ...v, scale: Math.max(.32, v.scale - .1) }))}><ZoomOut size={14} /></button><span>{Math.round(viewport.scale * 100)}%</span><button onClick={() => setViewport((v) => ({ ...v, scale: Math.min(1.6, v.scale + .1) }))}><ZoomIn size={14} /></button><button onClick={() => setViewport({ x: 60, y: 34, scale: .82 })}><Maximize2 size={14} /></button></div>

        <div className="minimap"><div className="minimap-label"><Layers3 size={11} /> Canvas</div><div className="mini-world">{elements.map((element) => <i key={element.id} className={selectedIds.includes(element.id) ? 'selected' : ''} style={{ left: `${6 + element.x / 10}px`, top: `${14 + element.y / 10}px`, width: `${Math.max(8, element.width / 10)}px`, height: `${Math.max(5, element.height / 10)}px` }} />)}{activeRegions.map((region) => <i key={region.id} className={`region ${selectedRegionId === region.id ? 'selected' : ''}`} style={{ left: `${6 + region.x / 10}px`, top: `${14 + region.y / 10}px`, width: `${Math.max(3, region.width / 10)}px`, height: `${Math.max(3, region.height / 10)}px` }} />)}<span style={{ transform: `translate(${Math.max(2, -viewport.x / 10)}px, ${Math.max(2, -viewport.y / 10)}px)` }} /></div></div>
      </div>

      {activities.length > 0 && <div className="activity-stack">{activities.slice(0, 3).map((activity) => (
        <div className={`activity-note ${activity.state}`} key={activity.id}>
          <button className="activity-main" onClick={() => activity.elementIds[0] && focusElement(activity.elementIds[0])}>
            <span><Sparkles size={13} /></span><div><small>{activity.state === 'attention' ? 'Agent needs input' : 'Agent'}</small><p>{activity.message}</p></div>
          </button>
          <button className="activity-dismiss" aria-label="Dismiss notification" onClick={() => setActivities((items) => items.filter((item) => item.id !== activity.id))}><X size={12} /></button>
        </div>
      ))}</div>}

      {deleteApprovalRequest && (
        <DeleteApprovalDialog
          items={deleteApprovalRequest.items}
          onApprove={approveDeleteRequest}
          onDecline={declineDeleteRequest}
        />
      )}

      {commentElement && <CommentsPanel element={commentElement} onClose={() => setCommentElementId(null)} onUpdate={(next) => setElements((items) => items.map((item) => item.id === next.id ? next : item))} />}
      {expandedElement && <FocusMode element={expandedElement} onClose={() => setExpandedElementId(null)} onChange={(patch) => patchElement(expandedElement.id, patch)} onOpenComments={() => setCommentElementId(expandedElement.id)} />}
    </main>
  )
}
