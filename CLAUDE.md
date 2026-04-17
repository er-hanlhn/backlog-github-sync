# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

One-way sync from Nulab Backlog to GitHub Projects V2. Runs as a GitHub Action on a 5-minute cron schedule. Polls Backlog for new/updated tickets since last sync, creates or updates **draft items** directly in a GitHub Project V2 board (no GitHub Issues involved), and maps Backlog fields to Project custom fields via GraphQL.

## Development Commands

```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript to dist/
npm run typecheck    # Type-check without emitting
npm run dev          # Watch mode compilation
npm run start        # Run sync (requires env vars, see below)
npm run test         # Run tests (node:test, requires build first)
```

### Required Environment Variables

| Variable | Description |
|----------|-------------|
| `BACKLOG_SPACE` | Backlog space name (e.g., `mycompany` for mycompany.backlog.com) |
| `BACKLOG_API_KEY` | Backlog API key |
| `BACKLOG_PROJECT_ID` | Backlog project ID (numeric) |
| `GITHUB_TOKEN` | GitHub PAT with `repo` + `project` scopes |
| `GITHUB_PROJECT_OWNER` | GitHub Project V2 owner (user or org login) |
| `GITHUB_PROJECT_NUMBER` | GitHub Project V2 number |

Optional: `BACKLOG_DOMAIN` (default `backlog.com`), `FIELD_MAPPING_PATH` (default `config/field-mapping.yml`), `INITIAL_SYNC_HOURS` (default `720`), `MAX_ISSUES_PER_RUN` (default `500`), `OVERLAP_BUFFER_MINUTES` (default `1`).

**Important:** The default GitHub Actions `GITHUB_TOKEN` does NOT have `project` scope. A PAT (classic with `repo` + `project`, or fine-grained with appropriate permissions) is required.

## Context Priority

When starting a new session, read these files first to understand the project:
1. `src/types.ts` — all shared types and interfaces
2. `src/sync-engine.ts` — core orchestration logic
3. `config/field-mapping.yml` — user-facing configuration

For API-specific work, read `src/backlog-client.ts` (REST) or `src/github-client.ts` (GraphQL).

## Architecture

### Sync Flow

```
Cron (5 min) -> src/index.ts
  ├── config.ts           Load env vars + field-mapping.yml
  ├── state-manager.ts    Read .sync-state.json (lastPolledAt, projectItemMap)
  ├── backlog-client.ts   Fetch issues updated since lastPolledAt (REST, paginated)
  ├── field-mapper.ts     Transform Backlog fields -> Project V2 field values
  ├── github-client.ts    Create/update draft items + set field values (GraphQL)
  ├── sync-engine.ts      Orchestrate per-ticket: create or update, map fields
  └── state-manager.ts    Write .sync-state.json, committed by workflow
```

### Key Design Decisions

**Draft items only (no GitHub Issues):** Items are created directly in the Project V2 board via `addProjectV2DraftIssue` GraphQL mutation. No REST API for issues needed.

**State tracking via `.sync-state.json`:** Committed to the repo by the workflow. Contains `lastPolledAt`, `projectItemMap` (Backlog key -> project item ID), and `projectFieldIds` (cached field/option IDs). Chosen over artifacts (expire) or issue comments (pollute tracker).

**Idempotency:** `projectItemMap` maps Backlog issue keys to project item IDs. If key exists, update; if not, create.

**Overlap buffer:** Fetches with a 1-minute overlap on `updatedSince` to avoid missing edge-case updates at the boundary.

**First run backfill:** Uses `INITIAL_SYNC_HOURS` (default 720h = 30 days) to look back on first sync when `lastPolledAt` is null.

### APIs Used

- **Backlog REST API:** `GET /api/v2/issues?projectId[]={id}&updatedSince={iso}&sort=updated&order=asc&count=100&offset={n}&apiKey={key}` — max 100 per page, paginate with offset.
- **GitHub GraphQL API:** Project V2 mutations (`addProjectV2DraftIssue`, `updateProjectV2DraftIssue`, `updateProjectV2ItemFieldValue`) and queries (discover project ID, discover fields). Tries `organization` first, falls back to `user` for project discovery.

### Field Mapping

Configured via `config/field-mapping.yml`. Maps Backlog fields to Project V2 custom fields:

| Backlog Field | Project V2 Field | Type |
|---|---|---|
| `status.name` | Status | Single Select (via value_map) |
| `priority.name` | Priority | Single Select (via value_map) |
| `assignee.name` | Backlog Assignee | Text |
| `dueDate` | Due Date | Date |
| `issueKey` | Backlog Key | Text |
| computed URL | Backlog URL | Text |

Field IDs and option IDs are auto-discovered at runtime by querying the project's fields via GraphQL, then cached in `.sync-state.json`.

### Error Handling

- **Backlog API errors:** Retry 3x with exponential backoff (1s, 2s, 4s) for 429/5xx. Fail fast on 401.
- **Per-ticket failures:** Log error, skip ticket, continue with remaining. Don't block the sync.
- **State corruption:** Throws (fail fast). Don't silently overwrite.
- **Concurrent runs:** Prevented by `concurrency` group in workflow YAML.

## File Conventions

- TypeScript with strict mode, immutable patterns (spread, never mutate)
- Pure functions where possible (field-mapper, state-manager)
- All source in `src/`, compiled to `dist/`
- State file: `.sync-state.json` (auto-managed, don't edit manually)
- Config file: `config/field-mapping.yml` (user-editable)
- GitHub Action metadata: `action.yml`
