# WebMCP Shared Canvas

An infinite collaborative workspace where a human and an external AI agent build shared context through WebMCP.

Instead of describing a file by location or passing screenshots through chat, a human can select canvas items or mark an empty point or rectangular region and immediately receive a short, temporary keyword such as `open-thread`. The agent resolves that spoken reference to stable element or region IDs, reads only the necessary content or geometry, communicates its intent on the canvas, and performs structured actions through the page's WebMCP tools.

> Built for the [OpenAI WebMCP Challenge](https://webmcp.devpost.com/) during the August 25–September 3, 2026 submission period.

**Live app:** [webmcp-shared-canvas.vercel.app](https://webmcp-shared-canvas.vercel.app)

## Why WebMCP

Cross-functional project feedback is often fragmented across chat messages, screenshots, links, and file versions. A browser agent can see a page, but visual browser control alone does not provide a reliable shared vocabulary or structured access to the work.

WebMCP Shared Canvas gives the human and agent a common interaction model:

1. The human selects related canvas items while speaking naturally.
2. The canvas immediately assigns that selection a memorable keyword.
3. The agent resolves the exact or transcription-imperfect phrase through WebMCP.
4. The agent receives stable IDs, media types, content previews, and comment state.
5. Before making a change, the agent posts a visible, non-blocking canvas notification.
6. The agent reads, comments on, creates, or updates the selected work using structured tools.

This makes spatial context addressable without forcing the human to interrupt dictation, name every file, or explain how the website works.

## What humans and agents can do together

- Arrange Markdown documents, PDFs, CSV files, websites, notes, and images on an infinite canvas.
- Select one item or marquee-select several items and refer to the group using a temporary spoken keyword.
- Click empty canvas space to mark a point, or drag across an empty area to mark a rectangular region; the agent can read its world-space position, size, bounds, and center through the assigned keyword.
- Reuse the same keyword for the same selection while it remains active; selecting it again resets its three-minute lifetime.
- Resolve capitalization differences and plausible speech-transcription errors while always returning the canonical keyword.
- Read structured content and unresolved-comment counts without scraping the rendered interface.
- Capture selected canvas frames as PNG images when visual appearance matters.
- Show live agent activity and reactions while the agent looks at, edits, or creates canvas elements.
- Open a focused collaboration mode for an individual canvas element.

## WebMCP implementation

The app registers tools directly with `document.modelContext.registerTool(...)`. Tool registration is scoped to the page lifecycle with an `AbortController`; contextual tools can change with the active canvas item.

| Tool | Purpose | Access |
| --- | --- | --- |
| `web_app_context` | Gives the agent the collaboration contract and terminology | Read only |
| `canvas_resolve_reference` | Resolves exact or fuzzy spoken references to canonical keywords and element IDs | Read only |
| `canvas_get_context` | Returns a compact overview of elements, types, comments, and active selections | Read only |
| `canvas_read_elements` | Reads full content and comment details for exact element IDs | Read only |
| `canvas_read_regions` | Reads position, size, bounds, and center for exact spatial region IDs | Read only |
| `canvas_list_keywords` | Lists active selection keywords in recency order | Read only |
| `canvas_capture_selection` | Produces a cropped PNG of selected canvas elements | Read only |
| `canvas_communicate` | Posts visible agent intent, progress, results, or requests for attention | Mutating |
| `canvas_create_element` | Creates a standardized canvas element | Mutating |
| `canvas_update_elements` | Updates selected work by stable element ID | Mutating |
| `canvas_add_comment` | Leaves a contextual comment on a canvas element | Mutating |

The tool contract lives in [`src/useWebMCP.ts`](src/useWebMCP.ts). Canvas data types are defined in [`src/types.ts`](src/types.ts), and the WebMCP-focused demo dataset is in [`src/data.ts`](src/data.ts).

## Run locally

### Requirements

- Node.js 20.9 or newer
- npm
- ChatGPT's in-app browser, or Google Chrome 149+ with `chrome://flags/#enable-webmcp-testing` enabled

### Install and start

```bash
git clone https://github.com/arisabogal/webmcp-shared-canvas.git
cd webmcp-shared-canvas
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The canvas UI works in modern browsers; WebMCP tool discovery requires a compatible WebMCP implementation.

### Production build

```bash
npm run lint
npm run build
npm start
```

No environment variables, database, account, or external API key are required for this demo.

## Judge testing flow

1. Open the app in ChatGPT's in-app browser or WebMCP-enabled Chrome.
2. Drag a marquee around two canvas elements. A keyword appears immediately.
3. Tell the agent: “Summarize **[keyword]** and tell me which items still have unresolved comments.” A transcription variation or spaced/capitalized version should also resolve.
4. Ask the agent to update or comment on the selection.
5. Confirm that the agent first posts a visible canvas notification, then performs the requested action and reports the result with the canonical keyword.
6. Ask the agent to capture the selected frames when visual inspection matters.

## Project structure

```text
src/app/                 Next.js App Router entry points and global styles
src/components/          Canvas, element, comment, and focus-mode UI
src/data.ts              WebMCP-focused demo elements and keyword generation
src/types.ts             Shared canvas and WebMCP TypeScript types
src/useWebMCP.ts         WebMCP registration, schemas, and tool execution
public/                  Locally owned demo assets
docs/                    Submission copy and challenge checklist
```

## Submission status

- [x] Functional WebMCP-enabled application source
- [x] Public open-source repository
- [x] Detectable open-source license
- [x] Local setup and judge testing instructions
- [x] Public live deployment URL
- [ ] Public YouTube demo with audio, under three minutes
- [ ] Final Devpost submission

The copy-ready description, checklist, and video outline are in [`docs/DEVPOST_SUBMISSION.md`](docs/DEVPOST_SUBMISSION.md).

## License

Copyright © 2026 Ari Sabogal. Released under the [MIT License](LICENSE).
