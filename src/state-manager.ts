import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { logger } from './logger.js'
import type { SyncState, ProjectField } from './types.js'

const DEFAULT_STATE: SyncState = {
  lastPolledAt: null,
  projectItemMap: {},
  projectFieldIds: {},
}

export function loadState(filePath: string): SyncState {
  if (!existsSync(filePath)) {
    logger.info('No sync state file found, starting fresh')
    return DEFAULT_STATE
  }

  try {
    const raw = readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<SyncState>
    return {
      lastPolledAt: parsed.lastPolledAt ?? null,
      projectItemMap: parsed.projectItemMap ?? {},
      projectFieldIds: parsed.projectFieldIds ?? {},
    }
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
