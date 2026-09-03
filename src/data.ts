import type { CanvasElement, KeywordGroup } from './types'

const now = Date.now()

export const KEYWORD_TTL_MS = 3 * 60 * 1000
export const OPENAI_WEBMCP_SHOWCASE_URL = 'https://developers.openai.com/showcase?view=webmcp-apps'

export const initialElements: CanvasElement[] = [
  {
    id: 'webmcp-brief', type: 'pdf', name: 'WebMCP challenge brief.pdf', x: 150, y: 145, width: 320, height: 410,
    content: 'Build a collaborative canvas where a human and an external AI agent share context through WebMCP. Human selections become temporary spoken keywords. The agent resolves those references, reads only the required content, communicates before acting, and leaves visible work on the canvas.',
    comments: [
      { id: 'brief-c1', author: 'You', body: 'Clarify how selection keywords survive transcription errors.', createdAt: now - 8_400_000 },
      { id: 'brief-c2', author: 'Agent', body: 'The tool-precedence requirement is now included.', createdAt: now - 7_900_000, resolved: true },
    ],
    createdBy: 'human', createdAt: now - 86_400_000,
  },
  {
    id: 'selection-flow', type: 'image', name: 'Selection to action flow', x: 520, y: 90, width: 500, height: 320,
    src: '/webmcp-flow.svg',
    content: 'Diagram showing the human selecting canvas items, receiving a temporary keyword, the agent resolving that keyword, and both collaborators sharing the resulting action.',
    comments: [{ id: 'flow-c1', author: 'Agent', body: 'The canonical keyword should remain visible in the response.', createdAt: now - 5_800_000, resolved: true }],
    createdBy: 'human', createdAt: now - 82_000_000,
  },
  {
    id: 'webmcp-spec', type: 'website', name: 'OpenAI WebMCP apps showcase', x: 1060, y: 130, width: 390, height: 300,
    src: OPENAI_WEBMCP_SHOWCASE_URL, content: 'developers.openai.com/showcase?view=webmcp-apps',
    comments: [], createdBy: 'human', createdAt: now - 64_000_000,
  },
  {
    id: 'agent-model', type: 'document', name: 'agent-collaboration-model.md', x: 520, y: 480, width: 500, height: 330,
    content: '# Shared understanding\n\nThe agent collaborates on the work, not on the webpage.\n\n## Sequence\n1. Resolve the human’s keyword.\n2. Read the selected item details.\n3. Communicate the intended action.\n4. Make the change.\n5. Report the result using the canonical keyword.',
    comments: [{ id: 'model-c1', author: 'You', body: 'Should the agent announce read-only actions too?', createdAt: now - 4_200_000 }],
    createdBy: 'human', createdAt: now - 48_000_000,
  },
  {
    id: 'tool-evaluation', type: 'csv', name: 'webmcp-tool-evaluation.csv', x: 1040, y: 500, width: 450, height: 300,
    content: 'tool,purpose,status\ncanvas_list,Orient agent,Ready\ncanvas_resolve,Match speech to targets,Ready\ncanvas_read,Read content and geometry,Ready\ncanvas_capture,Inspect pixels,Ready\ncanvas_create,Create in a region,Ready\ncanvas_update,Edit content and comments,Ready\ncanvas_delete,Approval-gated deletion,Ready',
    comments: [{ id: 'tools-c1', author: 'You', body: 'Validate screenshot behavior for embedded websites.', createdAt: now - 3_600_000 }],
    createdBy: 'human', createdAt: now - 32_000_000,
  },
  {
    id: 'agent-protocol', type: 'note', name: 'Agent protocol', x: 155, y: 620, width: 315, height: 225,
    content: 'Resolve first.\nUse the exact keyword.\nAnnounce before changing work.\nKeep the collaboration visible.',
    comments: [{ id: 'protocol-c1', author: 'Agent', body: 'Add a recovery rule for expired selections.', createdAt: now - 2_400_000 }],
    createdBy: 'human', createdAt: now - 24_000_000,
  },
]

const colors = ['quiet', 'open', 'bright', 'clear', 'soft', 'swift', 'north', 'true']
const objects = ['orbit', 'field', 'signal', 'frame', 'thread', 'path', 'room', 'wave']

export function makeKeyword(existing: KeywordGroup[]) {
  const used = new Set(existing.map((group) => group.keyword))
  for (let i = 0; i < 64; i += 1) {
    const keyword = `${colors[Math.floor(Math.random() * colors.length)]}-${objects[Math.floor(Math.random() * objects.length)]}`
    if (!used.has(keyword)) return keyword
  }
  return `group-${Date.now().toString(36).slice(-5)}`
}

export function createElement(type: CanvasElement['type'], x: number, y: number, createdBy: 'human' | 'agent' = 'human'): CanvasElement {
  const dimensions: Record<CanvasElement['type'], [number, number]> = {
    document: [360, 400], pdf: [320, 410], csv: [460, 300], website: [420, 310], note: [290, 210], image: [440, 310],
  }
  const labels: Record<CanvasElement['type'], string> = {
    document: 'untitled.md', pdf: 'untitled.pdf', csv: 'untitled.csv', website: 'Web reference', note: 'New note', image: 'Untitled image',
  }
  const [width, height] = dimensions[type]
  return {
    id: `${type}-${crypto.randomUUID()}`, type, name: labels[type], x, y, width, height,
    content: type === 'note' ? 'Start typing…' : type === 'document' ? '# Untitled document\n\nStart writing…' : type === 'csv' ? 'name,status\nExample,Open' : type === 'pdf' ? 'PDF content will appear here.' : undefined,
    comments: [], createdBy, createdAt: Date.now(), status: createdBy === 'agent' ? 'working' : 'idle',
  }
}
