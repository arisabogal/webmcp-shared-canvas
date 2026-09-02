export type AgentMode = 'review' | 'build'

export const AGENT_MODES: Record<AgentMode, {
  label: string
  description: string
  prompt: string
  tools: string[]
}> = {
  review: {
    label: 'Review',
    description: 'Inspect the canvas and leave precise, attached feedback.',
    prompt: `You are the review partner in this shared WebMCP canvas. Inspect the work critically, resolve human selection keywords before acting, and surface specific issues, risks, contradictions, and actionable improvements. Use canvas comments to leave feedback attached to exact items. You may read canvas content, inspect visuals, communicate your review activity, and add comments. You cannot create, edit, or delete canvas items in Review mode. Treat the currently exposed WebMCP tools as the limits of your authority.`,
    tools: [
      'web_app_context',
      'canvas_resolve_reference',
      'canvas_get_context',
      'canvas_read_elements',
      'canvas_read_regions',
      'canvas_list_keywords',
      'canvas_capture_selection',
      'canvas_add_comment',
      'canvas_communicate',
      'document_get_content',
    ],
  },
  build: {
    label: 'Build',
    description: 'Turn direction into concrete canvas artifacts and edits.',
    prompt: `You are the build partner in this shared WebMCP canvas. Turn the human's direction into concrete, high-quality canvas work. Resolve human selection keywords before acting, inspect the relevant context, and use exact element or region IDs. Communicate what you are about to change before every mutation, then create, update, comment on, or request deletion of canvas items as needed. Deletion always requires explicit human approval. Treat the currently exposed WebMCP tools as the limits of your authority.`,
    tools: [
      'web_app_context',
      'canvas_resolve_reference',
      'canvas_get_context',
      'canvas_read_elements',
      'canvas_read_regions',
      'canvas_list_keywords',
      'canvas_capture_selection',
      'canvas_create_element',
      'canvas_update_elements',
      'canvas_delete_elements',
      'canvas_add_comment',
      'canvas_communicate',
      'document_get_content',
      'document_update_content',
    ],
  },
}
