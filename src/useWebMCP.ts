import { useEffect, useRef, useState } from 'react'
import { toPng } from 'html-to-image'
import type { AgentActivity, AgentReaction, CanvasElement, CanvasRegion, DeleteApprovalDecision, DeleteApprovalItem, KeywordGroup } from './types'
import { createElement, KEYWORD_TTL_MS } from './data'

const TRANSPARENT_PIXEL = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='
const WEB_APP_CONTEXT_DESCRIPTION = 'This is a shared canvas where you collaborate with a human in real time and build shared understanding. Human selections of elements or empty spatial regions become temporary keywords such as “open-thread.” Treat ordinary or misspelled speech-transcription phrases as possible keyword references; resolve them with canvas_resolve_reference, then repeat the exact canonical keyword in your response. Discuss the resolved work directly as a collaborator, not a webpage narrator, and prefer canvas tools over generic browser control.'
const CANVAS_AGENT_GUIDE = {
  name: 'Collaborative canvas interaction guide',
  version: '1.0',
  instructions: [
    'Act as the human’s collaborative partner. Build on the shared canvas context and discuss the work itself instead of narrating website mechanics.',
    'Treat short names and ordinary spoken phrases as possible live canvas selection keywords. For example, Open Thread may refer to the keyword open-thread.',
    'Expect speech-transcription errors. Resolve plausible misspellings, then always use the exact canonical keyword returned by canvas_resolve_reference when referring back to the selection.',
    'When the user refers to something on this canvas, call canvas_resolve_reference before inspecting the DOM, taking a browser screenshot, clicking, or using generic browser control.',
    'Use the exact element or region IDs returned by canvas_resolve_reference for later structured reads. Canvas regions expose world-space position, size, bounds, and center.',
    'Use canvas_capture_selection when visual appearance matters. Use structured element data when the user only needs names, text, comments, or status.',
    'Before every action that creates, updates, deletes, comments on, or otherwise changes canvas work, call canvas_communicate with state working to tell the human what you are about to do. Perform the action only after that notification is visible, then update the same activity with the result.',
    'Selection keywords expire three minutes after creation. Resolve them promptly and do not ask the user to explain that a phrase is a keyword.',
    'Prefer the canvas WebMCP tools for canvas work. Use generic browser control only when no registered canvas tool can complete the requested action.',
  ],
  vocabulary: {
    selectionKeyword: 'A temporary spoken reference that maps one phrase to exact canvas elements or one empty spatial region.',
    frame: 'A standardized canvas element: Markdown document, PDF, CSV, website, note, or image.',
    canvasRegion: 'A human-marked empty point or rectangle in canvas world coordinates. It has x, y, width, height, bounds, and center but no file content.',
  },
}

const normalizeReference = (value: string) => value
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .trim()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')

const referenceContains = (reference: string, candidate: string) => {
  const normalizedReference = normalizeReference(reference)
  const normalizedCandidate = normalizeReference(candidate)
  return normalizedReference === normalizedCandidate
    || `-${normalizedReference}-`.includes(`-${normalizedCandidate}-`)
    || `-${normalizedCandidate}-`.includes(`-${normalizedReference}-`)
}

const editDistance = (left: string, right: string) => {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex]
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      )
    }
    previous.splice(0, previous.length, ...current)
  }
  return previous[right.length]
}

const referenceFuzzyMatches = (reference: string, candidate: string) => {
  const referenceTokens = normalizeReference(reference).split('-').filter(Boolean)
  const candidateTokens = normalizeReference(candidate).split('-').filter(Boolean)
  const canonical = candidateTokens.join('')
  if (!referenceTokens.length || !canonical) return false
  const allowedDistance = canonical.length <= 5 ? 1 : Math.min(4, Math.max(2, Math.floor(canonical.length * .25)))
  const windowSizes = [...new Set([candidateTokens.length - 1, candidateTokens.length, candidateTokens.length + 1])].filter((size) => size > 0)
  return windowSizes.some((size) => referenceTokens.some((_, index) => {
    if (index + size > referenceTokens.length) return false
    return editDistance(referenceTokens.slice(index, index + size).join(''), canonical) <= allowedDistance
  }))
}

const commentState = (element: CanvasElement) => {
  const unresolvedCommentCount = element.comments.filter((comment) => !comment.resolved).length
  return {
    commentCount: element.comments.length,
    unresolvedCommentCount,
    hasUnresolvedComments: unresolvedCommentCount > 0,
  }
}

const summarizeElement = (element: CanvasElement) => ({
  id: element.id,
  type: element.type,
  name: element.name,
  contentPreview: element.content?.replace(/\s+/g, ' ').trim().slice(0, 180) || null,
  ...commentState(element),
})

const readElement = (element: CanvasElement) => ({
  id: element.id,
  type: element.type,
  name: element.name,
  content: element.content || null,
  ...(element.type === 'website' ? { url: element.src || null } : {}),
  ...(element.type === 'pdf' ? { hasRenderedSource: Boolean(element.src) } : {}),
  ...(element.type === 'image' ? { hasImageSource: Boolean(element.src), visualDetailsTool: 'canvas_capture_selection' } : {}),
  ...commentState(element),
  comments: element.comments.map((comment) => ({
    id: comment.id,
    author: comment.author,
    body: comment.body,
    resolved: Boolean(comment.resolved),
  })),
})

const summarizeRegion = (region: CanvasRegion) => ({
  id: region.id,
  type: 'canvas_region',
  keyword: region.keyword,
  kind: region.width === 0 && region.height === 0 ? 'point' : 'area',
  position: { x: region.x, y: region.y },
  size: { width: region.width, height: region.height },
  bounds: {
    left: region.x,
    top: region.y,
    right: region.x + region.width,
    bottom: region.y + region.height,
  },
  center: {
    x: region.x + region.width / 2,
    y: region.y + region.height / 2,
  },
  coordinateSpace: 'canvas_world_units',
  expiresAt: region.expiresAt,
})

async function captureCanvasElements(elements: CanvasElement[], requestedPixelRatio: number) {
  const padding = 32
  const labelSpace = 26
  const bounds = elements.reduce((result, element) => ({
    left: Math.min(result.left, element.x),
    top: Math.min(result.top, element.y),
    right: Math.max(result.right, element.x + element.width),
    bottom: Math.max(result.bottom, element.y + element.height + labelSpace),
  }), { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity })
  const width = Math.ceil(bounds.right - bounds.left + padding * 2)
  const height = Math.ceil(bounds.bottom - bounds.top + padding * 2)
  const pixelRatio = Math.max(.5, Math.min(requestedPixelRatio, 2, 1600 / width, 1200 / height))
  const host = document.createElement('div')
  const surface = document.createElement('div')
  const iframeElementIds: string[] = []
  Object.assign(host.style, { position: 'fixed', left: '-100000px', top: '0', pointerEvents: 'none' })
  Object.assign(surface.style, {
    position: 'relative', width: `${width}px`, height: `${height}px`,
    overflow: 'hidden', pointerEvents: 'none', backgroundColor: '#f3f1eb',
    backgroundImage: 'radial-gradient(rgba(32, 31, 28, .14) .7px, transparent .7px)', backgroundSize: '18px 18px',
  })

  for (const element of elements) {
    const source = [...document.querySelectorAll<HTMLElement>('[data-element-id]')].find((node) => node.dataset.elementId === element.id)
    if (!source) continue
    const clone = source.cloneNode(true) as HTMLElement
    clone.classList.remove('selected')
    clone.querySelector('.selection-corners')?.remove()
    clone.querySelector('.expand-hint')?.remove()
    clone.querySelector('.agent-reaction')?.remove()
    clone.style.transform = `translate(${element.x - bounds.left + padding}px, ${element.y - bounds.top + padding}px)`
    clone.querySelectorAll('iframe').forEach((iframe) => {
      iframeElementIds.push(element.id)
      const placeholder = document.createElement('div')
      Object.assign(placeholder.style, {
        width: '100%', height: '100%', display: 'grid', placeItems: 'center', padding: '24px',
        color: '#77736a', background: '#eeece6', font: '11px monospace', textAlign: 'center',
      })
      placeholder.textContent = 'Embedded content is unavailable in browser capture'
      iframe.replaceWith(placeholder)
    })
    surface.appendChild(clone)
  }

  if (!surface.children.length) throw new Error('The selected canvas elements are not currently rendered.')
  host.appendChild(surface)
  document.body.appendChild(host)
  try {
    await document.fonts.ready
    const dataUrl = await toPng(surface, { backgroundColor: '#f3f1eb', imagePlaceholder: TRANSPARENT_PIXEL, pixelRatio })
    return { dataUrl, width, height, pixelRatio, iframeElementIds: [...new Set(iframeElementIds)] }
  } finally {
    host.remove()
  }
}

type API = {
  getElements: () => CanvasElement[]
  getKeywords: () => KeywordGroup[]
  getRegions: () => CanvasRegion[]
  getActiveElement: () => CanvasElement | undefined
  setElements: React.Dispatch<React.SetStateAction<CanvasElement[]>>
  setKeywords: React.Dispatch<React.SetStateAction<KeywordGroup[]>>
  setSelectedIds: (ids: string[]) => void
  setActivities: React.Dispatch<React.SetStateAction<AgentActivity[]>>
  focusElement: (id: string) => void
  showAgentReaction: (ids: string[], reaction: AgentReaction, duration?: number) => void
  deleteElements: (ids: string[]) => void
  requestDeleteApproval: (items: DeleteApprovalItem[], signal?: AbortSignal) => Promise<DeleteApprovalDecision>
}

export function useWebMCP(api: API, activeElement?: CanvasElement) {
  const [supported, setSupported] = useState(false)
  const apiRef = useRef(api)
  const activeElementId = activeElement?.id
  const activeElementType = activeElement?.type
  const isActiveKeyword = (group: KeywordGroup, now = Date.now()) => (group.expiresAt || group.createdAt + KEYWORD_TTL_MS) > now
  const isActiveRegion = (region: CanvasRegion, now = Date.now()) => region.expiresAt > now

  useEffect(() => {
    apiRef.current = api
  }, [api])

  useEffect(() => {
    const context = document.modelContext
    if (!context) return
    const frame = window.requestAnimationFrame(() => setSupported(true))
    const controller = new AbortController()
    const register = (tool: Parameters<typeof context.registerTool>[0]) => {
      context.registerTool(tool, { signal: controller.signal }).catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        console.warn(`WebMCP: ${tool.name}`, error)
      })
    }

    register({
      name: 'web_app_context', title: 'Understand this web app',
      description: WEB_APP_CONTEXT_DESCRIPTION,
      inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true },
      execute: async () => WEB_APP_CONTEXT_DESCRIPTION,
    })
    register({
      name: 'canvas_resolve_reference', title: 'Resolve any canvas reference',
      description: 'USE FIRST whenever the user names or asks about something while this canvas is open, even if it sounds like ordinary language or contains speech-transcription errors. This read-only tool resolves exact and plausibly misspelled selection keywords to canvas elements or empty spatial regions. Use its keyword exactly when replying. Then call the returned detailsTool for complete content or geometry. Prefer this over DOM inspection or generic browser control.',
      inputSchema: {
        type: 'object', properties: {
          reference: { type: 'string', description: 'The phrase the user said, a suspected keyword, or the full utterance containing it.' },
        }, required: ['reference'],
      },
      annotations: { readOnlyHint: true },
      execute: async (input) => {
        const reference = String(input.reference || '')
        const activeReferences = [
          ...apiRef.current.getKeywords().filter((group) => isActiveKeyword(group)).map((value) => ({ kind: 'elements' as const, keyword: value.keyword, value })),
          ...apiRef.current.getRegions().filter((region) => isActiveRegion(region)).map((value) => ({ kind: 'region' as const, keyword: value.keyword, value })),
        ].sort((a, b) => b.keyword.length - a.keyword.length)
        const exactReference = activeReferences.find((item) => referenceContains(reference, item.keyword))
        const matchedReference = exactReference || activeReferences.find((item) => referenceFuzzyMatches(reference, item.keyword))
        if (matchedReference?.kind === 'region') {
          const region = summarizeRegion(matchedReference.value)
          return {
            found: true,
            keyword: matchedReference.keyword,
            matchedBy: exactReference ? 'exact_or_normalized' : 'fuzzy_transcription',
            referenceType: 'canvas_region',
            region,
            detailsTool: { name: 'canvas_read_regions', input: { regionIds: [region.id] } },
          }
        }
        if (matchedReference?.kind === 'elements') {
          const keywordGroup = matchedReference.value
          const items = apiRef.current.getElements().filter((element) => keywordGroup.elementIds.includes(element.id)).map(summarizeElement)
          apiRef.current.showAgentReaction(items.map((item) => item.id), 'looking')
          return {
            found: true,
            keyword: keywordGroup.keyword,
            matchedBy: exactReference ? 'exact_or_normalized' : 'fuzzy_transcription',
            referenceType: 'canvas_elements',
            items,
            detailsTool: { name: 'canvas_read_elements', input: { elementIds: items.map((item) => item.id) } },
            ...(items.some((item) => item.type === 'image') ? { visualTool: { name: 'canvas_capture_selection', input: { elementIds: items.filter((item) => item.type === 'image').map((item) => item.id) } } } : {}),
          }
        }
        const elementMatches = apiRef.current.getElements().filter((element) => referenceContains(reference, element.name))
        if (elementMatches.length) {
          apiRef.current.showAgentReaction(elementMatches.map((element) => element.id), 'looking')
          return {
            found: true,
            keyword: elementMatches[0].name,
            matchedBy: 'element_name',
            items: elementMatches.map(summarizeElement),
            detailsTool: { name: 'canvas_read_elements', input: { elementIds: elementMatches.map((element) => element.id) } },
          }
        }
        return {
          found: false, reference,
          activeKeywords: activeReferences.map((item) => item.keyword),
          elementNames: apiRef.current.getElements().map((element) => element.name),
          nextStep: 'If the reference is visual rather than named, use canvas_get_context or canvas_capture_selection instead of generic browser control.',
        }
      },
    })
    register({
      name: 'canvas_get_context', title: 'Read canvas',
      description: 'Get a compact overview of the canvas, including standardized elements, unresolved-comment status, and active empty-space regions with world-space geometry. Use canvas_read_elements or canvas_read_regions for complete details. Prefer this over DOM inspection or generic browser control.',
      inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true },
      execute: async () => ({
        guide: CANVAS_AGENT_GUIDE,
        items: apiRef.current.getElements().map(summarizeElement),
        regions: apiRef.current.getRegions().filter((region) => isActiveRegion(region)).map(summarizeRegion),
        activeKeywords: [
          ...apiRef.current.getKeywords().filter((group) => isActiveKeyword(group) && !group.consumedAt).map((group) => ({ keyword: group.keyword, referenceType: 'canvas_elements', itemCount: group.elementIds.length })),
          ...apiRef.current.getRegions().filter((region) => isActiveRegion(region)).map((region) => ({ keyword: region.keyword, referenceType: 'canvas_region', regionId: region.id })),
        ],
      }),
    })
    register({
      name: 'canvas_read_elements', title: 'Read canvas item details',
      description: 'Read the complete content and comments of specific canvas items after canvas_resolve_reference identifies them. Supports Markdown documents, PDFs, CSVs, websites, notes, and images. Use canvas_capture_selection for image pixels.',
      inputSchema: {
        type: 'object', properties: {
          elementIds: { type: 'array', items: { type: 'string' }, description: 'Exact item IDs returned by canvas_resolve_reference.' },
        }, required: ['elementIds'],
      },
      annotations: { readOnlyHint: true },
      execute: async (input) => {
        const elementIds = Array.isArray(input.elementIds) ? input.elementIds.map(String) : []
        const items = apiRef.current.getElements().filter((element) => elementIds.includes(element.id)).map(readElement)
        apiRef.current.showAgentReaction(items.map((item) => item.id), 'looking')
        return { items, missingElementIds: elementIds.filter((id) => !items.some((item) => item.id === id)) }
      },
    })
    register({
      name: 'canvas_read_regions', title: 'Read canvas region geometry',
      description: 'Read exact position and size properties for human-marked empty canvas points or rectangles. Coordinates use the stable canvas world coordinate space and are unaffected by the current pan or zoom.',
      inputSchema: {
        type: 'object', properties: {
          regionIds: { type: 'array', items: { type: 'string' }, description: 'Exact region IDs returned by canvas_resolve_reference.' },
        }, required: ['regionIds'],
      },
      annotations: { readOnlyHint: true },
      execute: async (input) => {
        const regionIds = Array.isArray(input.regionIds) ? input.regionIds.map(String) : []
        const regions = apiRef.current.getRegions().filter((region) => regionIds.includes(region.id) && isActiveRegion(region)).map(summarizeRegion)
        return { regions, missingRegionIds: regionIds.filter((id) => !regions.some((region) => region.id === id)) }
      },
    })
    register({
      name: 'canvas_list_keywords', title: 'List selection keywords',
      description: 'List recent human-created element-selection and spatial-region keywords in newest-first order. These keywords may appear in speech as normal words with spaces or different capitalization. Prefer canvas_resolve_reference when interpreting what the user said.',
      inputSchema: { type: 'object', properties: { includeConsumed: { type: 'boolean', description: 'Include keywords already used by an agent.' } } }, annotations: { readOnlyHint: true },
      execute: async (input) => ({
        keywords: [
          ...apiRef.current.getKeywords()
          .filter((group) => isActiveKeyword(group) && (input.includeConsumed || !group.consumedAt))
          .map((group) => {
            const items = apiRef.current.getElements().filter((element) => group.elementIds.includes(element.id))
            return { keyword: group.keyword, referenceType: 'canvas_elements', itemCount: items.length, types: [...new Set(items.map((item) => item.type))], createdAt: group.createdAt }
          }),
          ...apiRef.current.getRegions().filter((region) => isActiveRegion(region)).map((region) => ({
            keyword: region.keyword,
            referenceType: 'canvas_region',
            region: summarizeRegion(region),
            createdAt: region.createdAt,
          })),
        ].sort((a, b) => b.createdAt - a.createdAt),
      }),
    })
    register({
      name: 'canvas_capture_selection', title: 'Capture selection screenshot',
      description: 'Capture one or more canvas elements as a cropped PNG for visual inspection. Resolve by a live selection keyword or pass exact element IDs. This is read-only and does not move the canvas or consume the keyword. Cross-origin iframe pixels are replaced with a labeled placeholder and reported in the result.',
      inputSchema: {
        type: 'object', properties: {
          keyword: { type: 'string', description: 'Live selection keyword, for example bright-room.' },
          elementIds: { type: 'array', items: { type: 'string' }, description: 'Exact canvas element IDs. Used when keyword is omitted.' },
          pixelRatio: { type: 'number', minimum: .5, maximum: 2, description: 'PNG scale from 0.5 to 2. Defaults to 1.5 and is capped for a 1600 by 1200 output.' },
        },
      },
      annotations: { readOnlyHint: true },
      execute: async (input) => {
        const keyword = input.keyword ? String(input.keyword) : ''
        const group = keyword ? apiRef.current.getKeywords().find((item) => normalizeReference(item.keyword) === normalizeReference(keyword) && isActiveKeyword(item)) : undefined
        const elementIds = group?.elementIds || (Array.isArray(input.elementIds) ? input.elementIds.map(String) : [])
        if (!elementIds.length) return {
          captured: false,
          error: keyword ? `No active selection exists for keyword ${keyword}.` : 'Provide a live keyword or at least one element ID.',
          availableKeywords: apiRef.current.getKeywords().filter((item) => isActiveKeyword(item)).map((item) => item.keyword),
        }
        const elements = apiRef.current.getElements().filter((element) => elementIds.includes(element.id))
        const missingElementIds = elementIds.filter((id) => !elements.some((element) => element.id === id))
        if (!elements.length) return { captured: false, error: 'None of the requested elements exist.', missingElementIds }
        apiRef.current.showAgentReaction(elements.map((element) => element.id), 'looking', 2400)
        try {
          const capture = await captureCanvasElements(elements, Number(input.pixelRatio ?? 1.5))
          return {
            content: [{ type: 'image', data: capture.dataUrl, mimeType: 'image/png', alt: `Canvas selection ${keyword || elementIds.join(', ')}` }],
            captured: true, keyword: keyword || undefined, elementIds: elements.map((element) => element.id), missingElementIds,
            width: capture.width, height: capture.height, pixelRatio: capture.pixelRatio,
            iframeElementIds: capture.iframeElementIds,
          }
        } catch (error) {
          return { captured: false, error: error instanceof Error ? error.message : 'Canvas capture failed.', elementIds }
        }
      },
    })
    register({
      name: 'canvas_create_element', title: 'Create canvas element',
      description: 'Create an agent-authored canvas item. You MUST call canvas_communicate first and tell the human what you are about to create before calling this tool.',
      inputSchema: {
        type: 'object', properties: {
          type: { type: 'string', enum: ['document', 'pdf', 'csv', 'website', 'note', 'image'], description: 'Standardized canvas item type.' },
          name: { type: 'string' }, content: { type: 'string' }, src: { type: 'string', description: 'Optional source URL or data URL for website, PDF, or image items.' }, x: { type: 'number' }, y: { type: 'number' }, message: { type: 'string' },
        }, required: ['type', 'name', 'content'],
      },
      execute: async (input) => {
        const id = `agent-${crypto.randomUUID()}`
        const element: CanvasElement = { ...createElement(String(input.type) as CanvasElement['type'], Number(input.x ?? 760), Number(input.y ?? 860), 'agent'), id, name: String(input.name), content: String(input.content), src: input.src ? String(input.src) : undefined }
        const activity: AgentActivity = { id: crypto.randomUUID(), message: String(input.message || `Creating ${element.name}`), elementIds: [id], createdAt: Date.now(), state: 'working' }
        apiRef.current.setElements((els) => [...els, element])
        apiRef.current.showAgentReaction([id], 'creating', 2400)
        apiRef.current.setActivities((items) => [activity, ...items])
        apiRef.current.setSelectedIds([id]); apiRef.current.focusElement(id)
        await new Promise((resolve) => setTimeout(resolve, 900))
        apiRef.current.setElements((els) => els.map((el) => el.id === id ? { ...el, status: 'done' } : el))
        apiRef.current.setActivities((items) => items.map((item) => item.id === activity.id ? { ...item, state: 'done' } : item))
        return { created: true, elementId: id, name: element.name }
      },
    })
    register({
      name: 'canvas_update_elements', title: 'Update selected work',
      description: 'Update the name or content of canvas items after resolving their IDs. You MUST call canvas_communicate first and tell the human what you are about to change before calling this tool.',
      inputSchema: { type: 'object', properties: { elementIds: { type: 'array', items: { type: 'string' } }, name: { type: 'string' }, content: { type: 'string' }, message: { type: 'string' } }, required: ['elementIds'] },
      execute: async (input) => {
        const ids = Array.isArray(input.elementIds) ? input.elementIds.map(String) : []
        apiRef.current.showAgentReaction(ids, 'editing', 2200)
        apiRef.current.setElements((els) => els.map((el) => ids.includes(el.id) ? { ...el, name: input.name ? String(input.name) : el.name, content: input.content ? String(input.content) : el.content, status: 'done' } : el))
        apiRef.current.setSelectedIds(ids)
        apiRef.current.setActivities((items) => [{ id: crypto.randomUUID(), message: String(input.message || `Updated ${ids.length} item${ids.length === 1 ? '' : 's'}`), elementIds: ids, createdAt: Date.now(), state: 'done' }, ...items])
        return { updated: ids, count: ids.length }
      },
    })
    register({
      name: 'canvas_delete_elements', title: 'Delete canvas items',
      description: 'Request permanent deletion of one or more canvas items after resolving their exact IDs. You MUST call canvas_communicate first and tell the human what you want to delete. This tool then pauses for explicit human approval in the canvas; never claim deletion succeeded unless the returned deleted field is true. Deleted items are also removed from active selections and selection keywords.',
      inputSchema: {
        type: 'object', properties: {
          elementIds: { type: 'array', items: { type: 'string' }, minItems: 1, uniqueItems: true, description: 'Exact item IDs returned by canvas_resolve_reference.' },
          message: { type: 'string', description: 'Optional completion message shown in canvas activity.' },
        }, required: ['elementIds'],
      },
      execute: async (input, options) => {
        const requestedIds = [...new Set(Array.isArray(input.elementIds) ? input.elementIds.map(String) : [])]
        if (!requestedIds.length) return { deleted: false, count: 0, error: 'Provide at least one exact canvas element ID.' }
        const items = apiRef.current.getElements().filter((element) => requestedIds.includes(element.id))
        const deletedElementIds = items.map((item) => item.id)
        const missingElementIds = requestedIds.filter((id) => !deletedElementIds.includes(id))
        if (!deletedElementIds.length) return { deleted: false, count: 0, deletedElementIds, missingElementIds, error: 'None of the requested canvas elements exist.' }
        const decision = await apiRef.current.requestDeleteApproval(
          items.map(({ id, name, type }) => ({ id, name, type })),
          options?.signal,
        )
        if (decision !== 'approved') {
          const reason = decision === 'declined' ? 'human_declined' : decision === 'busy' ? 'another_approval_is_pending' : 'request_canceled'
          const activity: AgentActivity = {
            id: crypto.randomUUID(),
            message: decision === 'declined' ? 'Deletion canceled — canvas items were kept' : 'Deletion request canceled',
            elementIds: deletedElementIds,
            createdAt: Date.now(),
            state: decision === 'declined' ? 'done' : 'attention',
          }
          apiRef.current.setActivities((activities) => [activity, ...activities].slice(0, 12))
          return { deleted: false, count: 0, deletedElementIds: [], missingElementIds, reason }
        }
        apiRef.current.deleteElements(deletedElementIds)
        const defaultMessage = `Deleted ${items.length} canvas item${items.length === 1 ? '' : 's'}${items.length === 1 ? `: ${items[0].name}` : ''}`
        const activity: AgentActivity = {
          id: crypto.randomUUID(), message: String(input.message || defaultMessage), elementIds: deletedElementIds,
          createdAt: Date.now(), state: 'done',
        }
        apiRef.current.setActivities((activities) => [activity, ...activities].slice(0, 12))
        return {
          deleted: true, count: deletedElementIds.length, deletedElementIds, missingElementIds,
          deletedItems: items.map(({ id, name, type }) => ({ id, name, type })),
        }
      },
    })
    register({
      name: 'canvas_add_comment', title: 'Leave a canvas comment',
      description: 'Leave an agent comment attached to a canvas item. You MUST call canvas_communicate first and tell the human that you are about to add the comment before calling this tool.',
      inputSchema: { type: 'object', properties: { elementId: { type: 'string' }, body: { type: 'string' } }, required: ['elementId', 'body'] },
      execute: async (input) => {
        const elementId = String(input.elementId); const body = String(input.body)
        apiRef.current.showAgentReaction([elementId], 'editing')
        apiRef.current.setElements((els) => els.map((el) => el.id === elementId ? { ...el, comments: [...el.comments, { id: crypto.randomUUID(), author: 'Agent', body, createdAt: Date.now() }] } : el))
        apiRef.current.setSelectedIds([elementId]); apiRef.current.focusElement(elementId)
        return { added: true, elementId }
      },
    })
    register({
      name: 'canvas_communicate', title: 'Communicate on canvas',
      description: 'ALWAYS call this before any tool that creates, updates, deletes, comments on, or otherwise changes canvas work. First show a visible, non-blocking notification saying what you are about to do; only then perform the action. Afterward, update the same activityId with what changed or where human attention is needed. This makes agent work legible while it happens.',
      inputSchema: {
        type: 'object', properties: {
          message: { type: 'string', description: 'Short human-readable status message.' },
          state: { type: 'string', enum: ['working', 'done', 'attention'] },
          elementIds: { type: 'array', items: { type: 'string' }, description: 'Optional canvas elements connected to this message.' },
          activityId: { type: 'string', description: 'Existing activity ID to update instead of creating a new notification.' },
        }, required: ['message', 'state'],
      },
      execute: async (input) => {
        const id = input.activityId ? String(input.activityId) : crypto.randomUUID()
        const message = String(input.message)
        const state = ['working', 'done', 'attention'].includes(String(input.state)) ? String(input.state) as AgentActivity['state'] : 'working'
        const elementIds = Array.isArray(input.elementIds) ? input.elementIds.map(String) : []
        apiRef.current.setActivities((items) => {
          const existing = items.some((item) => item.id === id)
          const activity: AgentActivity = { id, message, state, elementIds, createdAt: Date.now() }
          return (existing ? items.map((item) => item.id === id ? activity : item) : [activity, ...items]).slice(0, 12)
        })
        if (elementIds.length) {
          apiRef.current.setElements((items) => items.map((item) => elementIds.includes(item.id) ? { ...item, status: state === 'working' ? 'working' : 'done' } : item))
        }
        return { activityId: id, shown: true, state, elementIds }
      },
    })
    return () => { window.cancelAnimationFrame(frame); controller.abort() }
  }, [])

  useEffect(() => {
    const context = document.modelContext
    if (!context || !activeElementId || !activeElementType) return
    const controller = new AbortController()
    const register = (tool: Parameters<typeof context.registerTool>[0]) => {
      context.registerTool(tool, { signal: controller.signal }).catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        console.warn(`WebMCP contextual: ${tool.name}`, error)
      })
    }

    if (['document', 'pdf', 'csv', 'note', 'image'].includes(activeElementType)) {
      register({
        name: 'document_get_content', title: 'Read active document',
        description: 'Read the complete collaboration-relevant details of the document, PDF, CSV, note, or image open in focus mode.',
        inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true },
        execute: async () => {
          const item = apiRef.current.getActiveElement()
          if (item) apiRef.current.showAgentReaction([item.id], 'looking')
          return item ? readElement(item) : { found: false }
        },
      })
      register({
        name: 'document_update_content', title: 'Edit active document',
        description: 'Update the name or editable text of the document, PDF, CSV, or note open in focus mode. Rendered PDF source pixels remain read-only.',
        inputSchema: { type: 'object', properties: { name: { type: 'string' }, content: { type: 'string' } } },
        execute: async (input) => {
          const item = apiRef.current.getActiveElement(); if (!item) return { updated: false }
          apiRef.current.showAgentReaction([item.id], 'editing', 2200)
          apiRef.current.setElements((items) => items.map((element) => element.id === item.id ? { ...element, name: input.name ? String(input.name) : element.name, content: input.content ? String(input.content) : element.content } : element))
          return { updated: true, elementId: item.id }
        },
      })
    }

    return () => controller.abort()
  }, [activeElementId, activeElementType])

  return supported
}
