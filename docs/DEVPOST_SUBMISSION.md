# Devpost submission draft

This document maps WebMCP Shared Canvas to the published WebMCP Challenge submission requirements. Replace the two pending URLs only after the corresponding public artifacts have been verified.

## Required links

- Live project: https://webmcp-shared-canvas.vercel.app
- Public repository: https://github.com/arisabogal/webmcp-shared-canvas
- Public YouTube demo: **Pending recording and upload**

## Project description

### Inspiration

Project feedback becomes fragmented when teams pass screenshots, links, files, and comments through separate chat channels. The context that connects those artifacts is spatial and conversational, but existing agent interactions force people to translate that context into rigid prompts.

### What it does

WebMCP Shared Canvas is an infinite project workspace for Markdown documents, PDFs, CSV files, websites, notes, and images. A human can select one or several items while speaking naturally. The canvas immediately creates a short-lived keyword for that selection, and the external agent can resolve the spoken phrase—even when speech transcription changes capitalization, spacing, or spelling—to stable canvas element IDs.

The agent can then read the selected contents, comments, and geometry, inspect a visual capture, and create, update, comment on, or delete canvas work. Every mutation includes an intent that appears before the change and evolves into its completion status. Agent activity remains visible through that continuous notification and lightweight reactions attached to affected elements.

### Why this is a strong fit for WebMCP

The core problem is not automating a button click. It is giving a human and agent a reliable shared vocabulary for spatial, multi-file work. WebMCP lets the page expose selection meaning, stable identifiers, content types, geometry, comment state, and safe mutations directly. That semantic contract is more accurate and efficient than guessing from pixels or scraping the DOM.

### Better user experience

The human does not need to stop dictating to enumerate filenames, describe coordinates, or explain that a phrase refers to a website selection. Immediate keywords provide feedback in the same conversational moment. The agent resolves those references first, reads only what it needs, and supplies a visible intent with each mutation. The resulting work receives its own canonical reference, so both collaborators can continue using the same vocabulary.

### What was difficult before

Before this interaction model, teams had to move context between the canvas and chat manually: take screenshots, copy links, describe which version was meant, and reconstruct unresolved feedback. Generic browser agents could navigate the UI but did not have a stable semantic link between a spoken phrase and a group of spatial elements. WebMCP makes that link explicit and actionable.

### How WebMCP was implemented

The Next.js client registers seven focused tools through `document.modelContext.registerTool`. A three-minute selection registry maps generated keywords to stable target IDs. `canvas_resolve` normalizes natural speech and performs conservative fuzzy matching for transcription errors. `canvas_read` handles both items and spatial regions through one target vocabulary, while `canvas_capture` provides pixels only when needed. Three mutation tools handle creation, updates, and approval-gated deletion; each renders its required intent before applying the change and returns a canonical reference when appropriate. Tool registration follows the page lifecycle through an abort signal.

## Suggested tags

`webmcp`, `nextjs`, `human-ai-collaboration`, `productivity`, `spatial-computing`, `open-source`

## Demo video outline — maximum 2:45

The published video must be public on YouTube, include audio, show the working project, and explain how WebMCP is used.

| Time | Demonstration | Narration focus |
| --- | --- | --- |
| 0:00–0:20 | Show the full WebMCP project canvas | The fragmented-feedback problem and shared-canvas premise |
| 0:20–0:45 | Marquee-select two different media items | Immediate spoken keyword and three-minute stable selection |
| 0:45–1:10 | Ask about a slightly misspelled/spaced version of the keyword | Semantic resolution and canonical keyword recovery |
| 1:10–1:35 | Read contents and unresolved comments | Structured WebMCP output instead of DOM scraping |
| 1:35–2:05 | Request a comment or content update | Required mutation intent appears before the change and becomes its completion status |
| 2:05–2:25 | Ask for a visual capture or create a new item | Screenshot tool and visible agent reactions |
| 2:25–2:45 | Show resulting shared state | What humans and agents can now do together |

Do not use copyrighted music or third-party footage without permission.

## Final compliance checklist

- [x] Built during the August 25–September 3, 2026 submission period
- [x] WebMCP-powered web application
- [x] Public GitHub repository
- [x] Full source code and local assets included
- [x] MIT open-source license at repository root
- [x] Installation and testing instructions
- [x] English project description covering WebMCP fit, UX, collaboration, and implementation
- [x] Working public URL deployed on Vercel
- [ ] Public URL tested end-to-end in ChatGPT's in-app browser
- [ ] Public YouTube demo shorter than three minutes, with audio
- [ ] Live URL and YouTube URL inserted above and in Devpost
- [ ] Devpost project saved and submitted before September 3, 2026 at 1:00 PM PDT
- [ ] No repository, live-app, or submission changes during judging unless Devpost explicitly permits them
