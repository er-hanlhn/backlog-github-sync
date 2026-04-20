# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Bidirectional sync between Nulab Backlog and GitHub Projects V2. Primary trigger is **webhooks** (Backlog -> Cloudflare Worker -> `repository_dispatch`), with hourly cron as fallback. Creates real **GitHub Issues** in `er-hanlhn/hanlhn-team`, adds them to a Project V2 board, maps fields via GraphQL, and supports parent/sub-issue hierarchy. Optional reverse sync closes Backlog tickets when GitHub Issues are closed.

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
2. `src/sync-engine.ts` — core orchestration logic (supports both `draft` and `issues` modes)
3. `config/field-mapping.yml` — user-facing configuration

For API-specific work, read `src/backlog-client.ts` (REST), `src/github-client.ts` (GraphQL), or `src/github-issues-client.ts` (REST Issues).

## Architecture

### Sync Flow (issues mode)

```
Backlog Webhook -> Cloudflare Worker (webhook-proxy/) -> repository_dispatch
  OR
Cron (hourly fallback) -> workflow_dispatch

  -> src/index.ts
      ├── config.ts                Load env vars + field-mapping.yml
      ├── webhook-handler.ts       Parse repository_dispatch payload (if webhook)
      ├── state-manager.ts         Read .sync-state.json (V2 format)
      ├── backlog-client.ts        Fetch issues (batch or single)
      ├── hierarchy-resolver.ts    Separate parents from children
      ├── github-issues-client.ts  Create/update real GitHub Issues (REST)
      ├── github-milestones.ts     Auto-create milestones
      ├── github-labels.ts         Auto-create labels from issue types
      ├── github-client.ts         Add Issues to Project V2 + set field values (GraphQL)
      ├── github-sub-issues.ts     Link parent/child issues (beta API)
      ├── field-mapper.ts          Transform Backlog fields -> Project V2 field values
      └── state-manager.ts         Write .sync-state.json

Reverse sync (GitHub -> Backlog):
  GitHub Issue closed/reopened -> reverse-sync.yml -> src/reverse-sync.ts -> Backlog API
```

### Two Sync Modes (`SYNC_MODE` env var)

- **`issues`** (default): Creates real GitHub Issues in target repo, adds to Project V2, supports hierarchy
- **`draft`** (legacy): Creates draft items directly in Project V2, no hierarchy support

### Key Design Decisions

**Real GitHub Issues with Project V2:** Issues created via REST in `er-hanlhn/hanlhn-team`, then added to Project via `addProjectV2ItemById` GraphQL mutation. Enables parent/sub-issue hierarchy.

**Webhook-first, cron-fallback:** Primary trigger is Backlog webhook via Cloudflare Worker proxy. Hourly cron catches missed webhooks.

**Parent-before-child ordering:** `hierarchy-resolver.ts` separates issues by `parentIssueId`. Parents synced first, then children linked via sub-issues API.

**State tracking via `.sync-state.json` (V2):** Contains `issueMap` (backlogKey -> `{ id, issueNumber, nodeId }`), `projectItemMap`, `milestoneMap`, `labelMap`, `projectFieldIds`. Auto-migrates from V1.

**Reverse sync loop prevention:** `reverse-sync.yml` checks `github.actor != 'github-actions[bot]'` to prevent infinite loops.

### APIs Used

- **Backlog REST API:** `GET /api/v2/issues` (batch), `GET /api/v2/issues/:key` (single), `PATCH /api/v2/issues/:key` (status update for reverse sync)
- **GitHub REST API:** Issues CRUD in `er-hanlhn/hanlhn-team`, milestones, labels, sub-issues (beta)
- **GitHub GraphQL API:** Project V2 mutations (`addProjectV2ItemById`, `updateProjectV2ItemFieldValue`) and queries (discover project ID, discover fields)

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
- **GitHub API errors:** Same retry pattern. 422 on sub-issues = already linked (idempotent).
- **Per-ticket failures:** Log error, skip ticket, continue with remaining. Don't block the sync.
- **Sub-issues API (beta):** Wrapped in try/catch, fails gracefully. Issue still created without parent link.
- **State corruption:** Throws (fail fast). Don't silently overwrite.
- **Concurrent runs:** Prevented by `concurrency` group in workflow YAML.

## File Conventions

- TypeScript with strict mode, immutable patterns (spread, never mutate)
- Pure functions where possible (field-mapper, state-manager)
- All source in `src/`, compiled to `dist/`
- State file: `.sync-state.json` (auto-managed, don't edit manually)
- Config file: `config/field-mapping.yml` (user-editable)
- GitHub Action metadata: `action.yml`
