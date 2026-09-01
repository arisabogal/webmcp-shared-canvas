export type ElementType = 'document' | 'pdf' | 'csv' | 'website' | 'note' | 'image'
export type AgentReaction = 'looking' | 'editing' | 'creating'

export type CanvasComment = {
  id: string
  author: 'You' | 'Agent'
  body: string
  createdAt: number
  resolved?: boolean
}

export type CanvasElement = {
  id: string
  type: ElementType
  name: string
  x: number
  y: number
  width: number
  height: number
  content?: string
  src?: string
  status?: 'idle' | 'working' | 'done'
  comments: CanvasComment[]
  createdBy: 'human' | 'agent'
  createdAt: number
}

export type KeywordGroup = {
  keyword: string
  elementIds: string[]
  createdAt: number
  expiresAt: number
  consumedAt?: number
}

export type AgentActivity = {
  id: string
  message: string
  elementIds: string[]
  createdAt: number
  state: 'working' | 'done' | 'attention'
}

export type DeleteApprovalItem = Pick<CanvasElement, 'id' | 'name' | 'type'>
export type DeleteApprovalDecision = 'approved' | 'declined' | 'canceled' | 'busy'

export type Viewport = { x: number; y: number; scale: number }

declare global {
  interface Document {
    modelContext?: {
      registerTool: (tool: {
        name: string
        title?: string
        description: string
        inputSchema?: Record<string, unknown>
        annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean }
        execute: (input: Record<string, unknown>, options?: { signal: AbortSignal }) => Promise<unknown> | unknown
      }, options?: { signal?: AbortSignal }) => Promise<void>
    }
  }
}
