import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { logger } from './logger.js'
import type { SyncState, ProjectField, GitHubIssueRef } from './types.js'

const DEFAULT_STATE: SyncState = {
  version: 2,
  lastPolledAt: null,
  issueMap: {},
  projectItemMap: {},
  projectFieldIds: {},
  milestoneMap: {},
  labelMap: {},
}

interface LegacyState {
  lastPolledAt?: string | null
  projectItemMap?: Record<string, string>
  projectFieldIds?: Record<string, ProjectField>
}

function migrateState(raw: Record<string, unknown>): SyncState {
  const legacy = raw as LegacyState
  logger.info('Migrating state from V1 to V2')
  return {
    version: 2,
    lastPolledAt: legacy.lastPolledAt ?? null,
    issueMap: {},
    projectItemMap: legacy.projectItemMap ?? {},
    projectFieldIds: (legacy.projectFieldIds ?? {}) as Record<string, ProjectField>,
    milestoneMap: {},
    labelMap: {},
  }
}

export function loadState(filePath: string): SyncState {
  if (!existsSync(filePath)) {
    logger.info('No sync state file found, starting fresh')
    return DEFAULT_STATE
  }

  try {
    const raw = readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(raw) as Record<string, unknown>

    if (parsed.version === 2) {
      return parsed as unknown as SyncState
    }

    return migrateState(parsed)
  } catch (err) {
    throw new Error(`Failed to parse sync state file at ${filePath}: ${err}`)
  }
}

export function saveState(filePath: string, state: SyncState): void {
  writeFileSync(filePath, JSON.stringify(state, null, 2) + '\n', 'utf-8')
  logger.info('Sync state saved', { path: filePath })
}

export function setLastPolledAt(state: SyncState, timestamp: string): SyncState {
  return { ...state, lastPolledAt: timestamp }
}

export function setIssueMapping(
  state: SyncState,
  backlogKey: string,
  ref: GitHubIssueRef
): SyncState {
  return {
    ...state,
    issueMap: { ...state.issueMap, [backlogKey]: ref },
  }
}

export function setProjectItemMapping(
  state: SyncState,
  backlogKey: string,
  projectItemId: string
): SyncState {
  return {
    ...state,
    projectItemMap: { ...state.projectItemMap, [backlogKey]: projectItemId },
  }
}

export function setProjectFieldIds(
  state: SyncState,
  fieldIds: Record<string, ProjectField>
): SyncState {
  return { ...state, projectFieldIds: fieldIds }
}

export function setMilestoneMapping(
  state: SyncState,
  milestoneName: string,
  milestoneNumber: number
): SyncState {
  return {
    ...state,
    milestoneMap: { ...state.milestoneMap, [milestoneName]: milestoneNumber },
  }
}

export function setLabelMapping(
  state: SyncState,
  backlogTypeName: string,
  githubLabelName: string
): SyncState {
  return {
    ...state,
    labelMap: { ...state.labelMap, [backlogTypeName]: githubLabelName },
  }
}
