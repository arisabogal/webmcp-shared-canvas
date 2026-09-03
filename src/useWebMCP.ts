import { useEffect, useRef, useState } from 'react'
import { toPng } from 'html-to-image'
import type { AgentActivity, AgentReaction, CanvasElement, CanvasRegion, DeleteApprovalDecision, DeleteApprovalItem, KeywordGroup } from './types'
import { createElement, KEYWORD_TTL_MS } from './data'

const TRANSPARENT_PIXEL = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='

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

const elementGeometry = (element: CanvasElement) => ({
  position: { x: element.x, y: element.y },
  size: { width: element.width, height: element.height },
  bounds: {
    left: element.x,
    top: element.y,
    right: element.x + element.width,
    bottom: element.y + element.height,
  },
  center: {
    x: element.x + element.width / 2,
    y: element.y + element.height / 2,
  },
  coordinateSpace: 'canvas_world_units',
})

const summarizeElement = (element: CanvasElement) => ({
  id: element.id,
  kind: 'item',
  type: element.type,
  name: element.name,
  contentPreview: element.content?.replace(/\s+/g, ' ').trim().slice(0, 180) || null,
  geometry: elementGeometry(element),
  ...commentState(element),
})

const readElement = (element: CanvasElement) => ({
  id: element.id,
  kind: 'item',
  type: element.type,
  name: element.name,
  content: element.content ?? null,
  geometry: elementGeometry(element),
  ...(element.type === 'website' ? { url: element.src || null } : {}),
  ...(element.type === 'pdf' ? { hasRenderedSource: Boolean(element.src) } : {}),
  ...(element.type === 'image' ? { hasImageSource: Boolean(element.src), visualDetailsTool: 'canvas_capture' } : {}),
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
  kind: 'region',
  type: 'canvas_region',
  canonicalReference: region.keyword,
  geometry: {
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
  },
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
  selectTargets: (ids: string[]) => string | null
  setActivities: React.Dispatch<React.SetStateAction<AgentActivity[]>>
  focusElement: (id: string) => void
  showAgentReaction: (ids: string[], reaction: AgentReaction, duration?: number) => void
  deleteElements: (ids: string[]) => void
  requestDeleteApproval: (items: DeleteApprovalItem[], signal?: AbortSignal) => Promise<DeleteApprovalDecision>
}

const asRecord = (value: unknown): Record<string, unknown> => (
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
)

const uniqueStrings = (value: unknown) => (
  Array.isArray(value) ? [...new Set(value.map(String).filter(Boolean))] : []
)

const sameTargetIds = (left: string[], right: string[]) => (
  [...new Set(left)].sort().join('\u001f') === [...new Set(right)].sort().join('\u001f')
)

const waitForVisiblePaint = (signal?: AbortSignal) => new Promise<boolean>((resolve) => {
  if (signal?.aborted) { resolve(false); return }
  let firstFrame = 0
  let secondFrame = 0
  const cancel = () => {
    window.cancelAnimationFrame(firstFrame)
    window.cancelAnimationFrame(secondFrame)
    signal?.removeEventListener('abort', cancel)
    resolve(false)
  }
  firstFrame = window.requestAnimationFrame(() => {
    secondFrame = window.requestAnimationFrame(() => {
      signal?.removeEventListener('abort', cancel)
      resolve(true)
    })
  })
  signal?.addEventListener('abort', cancel, { once: true })
})

export function useWebMCP(api: API) {
  const [supported, setSupported] = useState(false)
  const apiRef = useRef(api)
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

    const setActivity = (id: string, message: string, state: AgentActivity['state'], elementIds: string[]) => {
      apiRef.current.setActivities((items) => {
        const activity: AgentActivity = { id, message, state, elementIds, createdAt: Date.now() }
        return (items.some((item) => item.id === id)
          ? items.map((item) => item.id === id ? activity : item)
          : [activity, ...items]).slice(0, 12)
      })
      if (elementIds.length) {
        apiRef.current.setElements((items) => items.map((item) => elementIds.includes(item.id)
          ? { ...item, status: state === 'working' ? 'working' : 'done' }
          : item))
      }
    }

    const beginMutation = (intent: unknown, elementIds: string[]) => {
      const activityId = crypto.randomUUID()
      setActivity(activityId, String(intent), 'working', elementIds)
      return activityId
    }

    const finishMutation = (activityId: string, message: string, elementIds: string[], state: AgentActivity['state'] = 'done') => {
      setActivity(activityId, message, state, elementIds)
    }

    const canonicalReferenceFor = (targetIds: string[]) => apiRef.current.getKeywords()
      .filter((group) => isActiveKeyword(group))
      .find((group) => sameTargetIds(group.elementIds, targetIds))?.keyword || null

    register({
      name: 'canvas_list', title: 'List canvas context',
      description: 'Get a compact overview when the human has not named a specific canvas reference. Prefer canvas_resolve for spoken keywords or item names.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      execute: async () => ({
        collaboration: 'Work on the shared canvas directly. Resolve human references before reading or changing their targets, and repeat canonical references when replying.',
        items: apiRef.current.getElements().map(summarizeElement),
        regions: apiRef.current.getRegions().filter((region) => isActiveRegion(region)).map(summarizeRegion),
        activeReferences: [
          ...apiRef.current.getKeywords().filter((group) => isActiveKeyword(group)).map((group) => ({ canonicalReference: group.keyword, kind: 'selection', targetIds: group.elementIds, createdAt: group.createdAt })),
          ...apiRef.current.getRegions().filter((region) => isActiveRegion(region)).map((region) => ({ canonicalReference: region.keyword, kind: 'region', targetIds: [region.id], createdAt: region.createdAt })),
        ].sort((left, right) => right.createdAt - left.createdAt),
        focusedTarget: apiRef.current.getActiveElement() ? summarizeElement(apiRef.current.getActiveElement()!) : null,
      }),
    })
    register({
      name: 'canvas_resolve', title: 'Resolve canvas reference',
      description: 'Resolve a human-spoken keyword or item name into stable target IDs. Use before reading or changing referenced work, and return ambiguity rather than guessing.',
      inputSchema: {
        type: 'object', properties: {
          reference: { type: 'string', minLength: 1, description: 'The phrase or full utterance containing the reference.' },
        }, required: ['reference'], additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (input) => {
        const reference = String(input.reference || '')
        const activeReferences = [
          ...apiRef.current.getKeywords().filter((group) => isActiveKeyword(group)).map((value) => ({ kind: 'elements' as const, keyword: value.keyword, value })),
          ...apiRef.current.getRegions().filter((region) => isActiveRegion(region)).map((value) => ({ kind: 'region' as const, keyword: value.keyword, value })),
        ].sort((a, b) => b.keyword.length - a.keyword.length)
        const exactMatches = activeReferences.filter((item) => referenceContains(reference, item.keyword))
        const fuzzyMatches = exactMatches.length ? [] : activeReferences.filter((item) => referenceFuzzyMatches(reference, item.keyword))
        const candidates = exactMatches.length ? exactMatches : fuzzyMatches
        if (candidates.length > 1) return {
          found: false,
          reason: 'ambiguous',
          candidates: candidates.map((item) => item.keyword),
        }
        const matchedReference = candidates[0]
        if (matchedReference?.kind === 'region') {
          const region = summarizeRegion(matchedReference.value)
          return {
            found: true,
            canonicalReference: matchedReference.keyword,
            matchedBy: exactMatches.length ? 'exact_or_normalized' : 'fuzzy_transcription',
            targets: [region],
            nextTool: { name: 'canvas_read', input: { targetIds: [region.id] } },
          }
        }
        if (matchedReference?.kind === 'elements') {
          const keywordGroup = matchedReference.value
          const items = apiRef.current.getElements().filter((element) => keywordGroup.elementIds.includes(element.id)).map(summarizeElement)
          apiRef.current.setKeywords((groups) => groups.map((group) => group.keyword === keywordGroup.keyword ? { ...group, consumedAt: Date.now() } : group))
          apiRef.current.showAgentReaction(items.map((item) => item.id), 'looking')
          return {
            found: true,
            canonicalReference: keywordGroup.keyword,
            matchedBy: exactMatches.length ? 'exact_or_normalized' : 'fuzzy_transcription',
            targets: items,
            nextTool: { name: 'canvas_read', input: { targetIds: items.map((item) => item.id) } },
            ...(items.some((item) => item.type === 'image') ? { visualTool: { name: 'canvas_capture', input: { targetIds: items.map((item) => item.id) } } } : {}),
          }
        }
        const elementMatches = apiRef.current.getElements().filter((element) => referenceContains(reference, element.name))
        if (elementMatches.length > 1) return { found: false, reason: 'ambiguous', candidates: elementMatches.map((element) => element.name) }
        if (elementMatches.length) {
          apiRef.current.showAgentReaction(elementMatches.map((element) => element.id), 'looking')
          return {
            found: true,
            canonicalReference: elementMatches[0].name,
            matchedBy: 'element_name',
            targets: elementMatches.map(summarizeElement),
            nextTool: { name: 'canvas_read', input: { targetIds: elementMatches.map((element) => element.id) } },
          }
        }
        return {
          found: false,
          reason: 'not_found',
          reference,
          availableReferences: activeReferences.map((item) => item.keyword),
          availableItemNames: apiRef.current.getElements().map((element) => element.name),
        }
      },
    })
    register({
      name: 'canvas_read', title: 'Read canvas targets',
      description: 'Read content, comments, and world-space geometry for resolved items or regions. Omit targetIds with scope focused to read the item open in focus mode.',
      inputSchema: {
        type: 'object', properties: {
          targetIds: { type: 'array', items: { type: 'string' }, minItems: 1, uniqueItems: true, description: 'Stable IDs returned by canvas_resolve.' },
          scope: { type: 'string', enum: ['focused'], description: 'Read the item currently open in focus mode.' },
        }, additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (input) => {
        const requestedIds = uniqueStrings(input.targetIds)
        const focused = input.scope === 'focused' ? apiRef.current.getActiveElement() : undefined
        const targetIds = requestedIds.length ? requestedIds : focused ? [focused.id] : []
        if (!targetIds.length) return { read: false, error: 'Provide targetIds or use scope focused while an item is open.' }
        const items = apiRef.current.getElements().filter((element) => targetIds.includes(element.id)).map(readElement)
        const regions = apiRef.current.getRegions().filter((region) => targetIds.includes(region.id) && isActiveRegion(region)).map(summarizeRegion)
        apiRef.current.showAgentReaction(items.map((item) => item.id), 'looking')
        return {
          read: true,
          targets: [...items, ...regions],
          missingTargetIds: targetIds.filter((id) => !items.some((item) => item.id === id) && !regions.some((region) => region.id === id)),
        }
      },
    })
    register({
      name: 'canvas_capture', title: 'Capture canvas targets',
      description: 'Capture resolved canvas items as a cropped PNG when visual appearance matters. Cross-origin iframe pixels are replaced with labeled placeholders.',
      inputSchema: {
        type: 'object', properties: {
          canonicalReference: { type: 'string', description: 'An active canonical selection reference.' },
          targetIds: { type: 'array', items: { type: 'string' }, minItems: 1, uniqueItems: true, description: 'Stable item IDs returned by canvas_resolve.' },
          pixelRatio: { type: 'number', minimum: .5, maximum: 2, description: 'PNG scale from 0.5 to 2. Defaults to 1.5 and is capped for a 1600 by 1200 output.' },
        }, additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (input) => {
        const canonicalReference = input.canonicalReference ? String(input.canonicalReference) : ''
        const group = canonicalReference ? apiRef.current.getKeywords().find((item) => normalizeReference(item.keyword) === normalizeReference(canonicalReference) && isActiveKeyword(item)) : undefined
        const targetIds = group?.elementIds || uniqueStrings(input.targetIds)
        if (!targetIds.length) return {
          captured: false,
          error: canonicalReference ? `No active selection exists for ${canonicalReference}.` : 'Provide a canonicalReference or targetIds.',
          availableReferences: apiRef.current.getKeywords().filter((item) => isActiveKeyword(item)).map((item) => item.keyword),
        }
        const elements = apiRef.current.getElements().filter((element) => targetIds.includes(element.id))
        const missingTargetIds = targetIds.filter((id) => !elements.some((element) => element.id === id))
        if (!elements.length) return { captured: false, error: 'None of the requested items exist.', missingTargetIds }
        apiRef.current.showAgentReaction(elements.map((element) => element.id), 'looking', 2400)
        try {
          const capture = await captureCanvasElements(elements, Number(input.pixelRatio ?? 1.5))
          return {
            content: [{ type: 'image', data: capture.dataUrl, mimeType: 'image/png', alt: `Canvas targets ${canonicalReference || targetIds.join(', ')}` }],
            captured: true, canonicalReference: canonicalReference || undefined, targetIds: elements.map((element) => element.id), missingTargetIds,
            width: capture.width, height: capture.height, pixelRatio: capture.pixelRatio,
            iframeElementIds: capture.iframeElementIds,
          }
        } catch (error) {
          return { captured: false, error: error instanceof Error ? error.message : 'Canvas capture failed.', targetIds }
        }
      },
    })
    register({
      name: 'canvas_create', title: 'Create canvas item',
      description: 'Create an agent-authored item. The required intent is shown to the human before the item is created; use placementTargetId to place it inside a selected region.',
      inputSchema: {
        type: 'object', properties: {
          type: { type: 'string', enum: ['document', 'pdf', 'csv', 'website', 'note', 'image'], description: 'Standardized canvas item type.' },
          name: { type: 'string', minLength: 1 },
          content: { type: 'string' },
          src: { type: 'string', description: 'Optional source URL or data URL for a website, PDF, or image.' },
          placementTargetId: { type: 'string', description: 'Optional active region ID returned by canvas_resolve.' },
          intent: { type: 'string', minLength: 1, description: 'Short explanation shown before creation.' },
        }, required: ['type', 'name', 'intent'], additionalProperties: false,
      },
      execute: async (input, options) => {
        const validTypes: CanvasElement['type'][] = ['document', 'pdf', 'csv', 'website', 'note', 'image']
        const type = String(input.type) as CanvasElement['type']
        if (!validTypes.includes(type)) return { created: false, error: 'Unsupported item type.' }
        const placementTargetId = input.placementTargetId ? String(input.placementTargetId) : ''
        const region = placementTargetId ? apiRef.current.getRegions().find((item) => item.id === placementTargetId && isActiveRegion(item)) : undefined
        if (placementTargetId && !region) return { created: false, error: 'The placement target is missing or expired.', missingTargetIds: [placementTargetId] }
        const id = `agent-${crypto.randomUUID()}`
        const base = createElement(type, 0, 0, 'agent')
        const x = region ? region.x + Math.max(0, (region.width - base.width) / 2) : 760
        const y = region ? region.y + Math.max(0, (region.height - base.height) / 2) : 860
        const element: CanvasElement = { ...base, id, x, y, name: String(input.name), content: input.content === undefined ? base.content : String(input.content), src: input.src ? String(input.src) : undefined }
        const activityId = beginMutation(input.intent, [])
        if (!await waitForVisiblePaint(options?.signal)) {
          finishMutation(activityId, 'Creation canceled', [], 'attention')
          return { created: false, reason: 'request_canceled' }
        }
        apiRef.current.setElements((els) => [...els, element])
        apiRef.current.showAgentReaction([id], 'creating', 2400)
        apiRef.current.setElements((els) => els.map((el) => el.id === id ? { ...el, status: 'done' } : el))
        const resultReference = apiRef.current.selectTargets([id])
        window.requestAnimationFrame(() => apiRef.current.focusElement(id))
        finishMutation(activityId, `Created ${element.name}`, [id])
        return { created: true, targetId: id, resultReference, placementTargetId: region?.id || null }
      },
    })
    register({
      name: 'canvas_update', title: 'Update canvas items',
      description: 'Update resolved items, add comments, or resolve comments. The required intent is shown to the human before changes are applied.',
      inputSchema: {
        type: 'object', properties: {
          targetIds: { type: 'array', items: { type: 'string' }, minItems: 1, uniqueItems: true },
          scope: { type: 'string', enum: ['focused'] },
          intent: { type: 'string', minLength: 1, description: 'Short explanation shown before the update.' },
          changes: {
            type: 'object', properties: {
              name: { type: 'string' },
              content: { type: 'string' },
              addComment: { type: 'string', minLength: 1 },
              resolveCommentIds: { type: 'array', items: { type: 'string' }, uniqueItems: true },
            }, additionalProperties: false,
          },
        }, required: ['intent', 'changes'], additionalProperties: false,
      },
      execute: async (input, options) => {
        const requestedIds = uniqueStrings(input.targetIds)
        const focused = input.scope === 'focused' ? apiRef.current.getActiveElement() : undefined
        const targetIds = requestedIds.length ? requestedIds : focused ? [focused.id] : []
        if (!targetIds.length) return { updated: false, error: 'Provide targetIds or use scope focused while an item is open.' }
        const existing = apiRef.current.getElements().filter((element) => targetIds.includes(element.id))
        const updatedTargetIds = existing.map((element) => element.id)
        const missingTargetIds = targetIds.filter((id) => !updatedTargetIds.includes(id))
        if (!updatedTargetIds.length) return { updated: false, error: 'None of the requested items exist.', missingTargetIds }
        const changes = asRecord(input.changes)
        const hasChanges = ['name', 'content', 'addComment', 'resolveCommentIds'].some((key) => Object.hasOwn(changes, key))
        if (!hasChanges) return { updated: false, error: 'Provide at least one supported change.' }
        const activityId = beginMutation(input.intent, updatedTargetIds)
        if (!await waitForVisiblePaint(options?.signal)) {
          finishMutation(activityId, 'Update canceled', updatedTargetIds, 'attention')
          return { updated: false, reason: 'request_canceled', missingTargetIds }
        }
        const resolveCommentIds = new Set(uniqueStrings(changes.resolveCommentIds))
        apiRef.current.showAgentReaction(updatedTargetIds, 'editing', 2200)
        apiRef.current.setElements((elements) => elements.map((element) => {
          if (!updatedTargetIds.includes(element.id)) return element
          const comments = element.comments
            .map((comment) => resolveCommentIds.has(comment.id) ? { ...comment, resolved: true } : comment)
          if (typeof changes.addComment === 'string' && changes.addComment.trim()) {
            comments.push({ id: crypto.randomUUID(), author: 'Agent', body: changes.addComment.trim(), createdAt: Date.now() })
          }
          return {
            ...element,
            ...(Object.hasOwn(changes, 'name') ? { name: String(changes.name) } : {}),
            ...(Object.hasOwn(changes, 'content') ? { content: String(changes.content) } : {}),
            comments,
            status: 'done',
          }
        }))
        const resultReference = apiRef.current.selectTargets(updatedTargetIds)
        finishMutation(activityId, `Updated ${updatedTargetIds.length} item${updatedTargetIds.length === 1 ? '' : 's'}`, updatedTargetIds)
        return { updated: true, targetIds: updatedTargetIds, resultReference, missingTargetIds }
      },
    })
    register({
      name: 'canvas_delete', title: 'Delete canvas items',
      description: 'Request deletion of resolved items. The required intent is shown first, and deletion occurs only after explicit human approval.',
      inputSchema: {
        type: 'object', properties: {
          targetIds: { type: 'array', items: { type: 'string' }, minItems: 1, uniqueItems: true, description: 'Stable item IDs returned by canvas_resolve.' },
          intent: { type: 'string', minLength: 1, description: 'Short explanation shown before approval is requested.' },
        }, required: ['targetIds', 'intent'], additionalProperties: false,
      },
      execute: async (input, options) => {
        const requestedIds = uniqueStrings(input.targetIds)
        if (!requestedIds.length) return { deleted: false, count: 0, error: 'Provide at least one exact canvas element ID.' }
        const items = apiRef.current.getElements().filter((element) => requestedIds.includes(element.id))
        const deletedElementIds = items.map((item) => item.id)
        const missingTargetIds = requestedIds.filter((id) => !deletedElementIds.includes(id))
        if (!deletedElementIds.length) return { deleted: false, count: 0, targetIds: [], missingTargetIds, error: 'None of the requested canvas items exist.' }
        const canonicalReference = canonicalReferenceFor(deletedElementIds)
        const activityId = beginMutation(input.intent, deletedElementIds)
        if (!await waitForVisiblePaint(options?.signal)) {
          finishMutation(activityId, 'Deletion request canceled', deletedElementIds, 'attention')
          return { deleted: false, count: 0, targetIds: [], missingTargetIds, reason: 'request_canceled' }
        }
        const decision = await apiRef.current.requestDeleteApproval(
          items.map(({ id, name, type }) => ({ id, name, type })),
          options?.signal,
        )
        if (decision !== 'approved') {
          const reason = decision === 'declined' ? 'human_declined' : decision === 'busy' ? 'another_approval_is_pending' : 'request_canceled'
          finishMutation(activityId, decision === 'declined' ? 'Deletion canceled — canvas items were kept' : 'Deletion request canceled', deletedElementIds, decision === 'declined' ? 'done' : 'attention')
          return { deleted: false, count: 0, targetIds: [], missingTargetIds, reason }
        }
        apiRef.current.deleteElements(deletedElementIds)
        finishMutation(activityId, `Deleted ${items.length} canvas item${items.length === 1 ? `: ${items[0].name}` : 's'}`, [])
        return {
          deleted: true, count: deletedElementIds.length, targetIds: deletedElementIds, missingTargetIds, canonicalReference,
          deletedItems: items.map(({ id, name, type }) => ({ id, name, type })),
        }
      },
    })
    return () => { window.cancelAnimationFrame(frame); controller.abort() }
  }, [])

  return supported
}
