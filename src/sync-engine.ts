import { logger } from './logger.js'
import { fetchUpdatedIssues, buildBacklogUrl, createBacklogDeps } from './backlog-client.js'
import {
  discoverProjectId,
  discoverProjectFields,
  addDraftIssue,
  updateDraftIssue,
  updateItemField,
  createGitHubDeps,
} from './github-client.js'
import {
  mapTicketToFieldValues,
  buildDraftIssueTitle,
  buildDraftIssueBody,
} from './field-mapper.js'
import {
  loadState,
  saveState,
  setLastPolledAt,
  setProjectItemMapping,
  setProjectFieldIds,
} from './state-manager.js'
import { loadFieldMapping } from './config.js'
import type { SyncConfig, SyncResult, SyncState, BacklogIssue } from './types.js'

const STATE_FILE = '.sync-state.json'

function computeSinceTimestamp(state: SyncState, config: SyncConfig): string {
  if (state.lastPolledAt) {
    const sinceDate = new Date(state.lastPolledAt)
    sinceDate.setMinutes(sinceDate.getMinutes() - config.overlapBufferMinutes)
    return sinceDate.toISOString()
  }

  // First run: look back by initialSyncHours
  const initialDate = new Date()
  initialDate.setHours(initialDate.getHours() - config.initialSyncHours)
  logger.info(`First run: looking back ${config.initialSyncHours} hours`)
  return initialDate.toISOString()
}

async function syncTicket(
  issue: BacklogIssue,
  state: SyncState,
  config: SyncConfig,
  projectId: string
): Promise<{ updatedState: SyncState; action: 'created' | 'updated' }> {
  const backlogDeps = createBacklogDeps(config)
  const githubDeps = createGitHubDeps(config)
  const backlogUrl = buildBacklogUrl(backlogDeps, issue.issueKey)
  const title = buildDraftIssueTitle(issue)
  const body = buildDraftIssueBody(issue, backlogUrl)

  const existingItemId = state.projectItemMap[issue.issueKey]
  let itemId: string
  let action: 'created' | 'updated'

  if (existingItemId) {
    await updateDraftIssue(githubDeps, projectId, existingItemId, title, body)
    itemId = existingItemId
    action = 'updated'
    logger.info(`Updated: ${issue.issueKey}`)
  } else {
    itemId = await addDraftIssue(githubDeps, projectId, title, body)
    action = 'created'
    logger.info(`Created: ${issue.issueKey} -> ${itemId}`)
  }

  // Map and update field values
  const mappingConfig = loadFieldMapping(config.fieldMappingPath)
  const fieldValues = mapTicketToFieldValues(
    issue,
    backlogUrl,
    mappingConfig,
    state.projectFieldIds
  )

  for (const fieldValue of fieldValues) {
    try {
      await updateItemField(githubDeps, projectId, itemId, fieldValue)
    } catch (err) {
      logger.warn(`Failed to set field ${fieldValue.fieldId} for ${issue.issueKey}: ${err}`)
    }
  }

  const updatedState = setProjectItemMapping(state, issue.issueKey, itemId)
  return { updatedState, action }
}

export async function runSync(config: SyncConfig): Promise<SyncResult> {
  const syncStart = new Date().toISOString()
  let state = loadState(STATE_FILE)

  const githubDeps = createGitHubDeps(config)
  const backlogDeps = createBacklogDeps(config)

  // Discover project
  const projectId = await discoverProjectId(githubDeps)

  // Discover and cache project fields
  const projectFields = await discoverProjectFields(githubDeps, projectId)
  state = setProjectFieldIds(state, projectFields)

  // Fetch updated Backlog issues
  const since = computeSinceTimestamp(state, config)
  const issues = await fetchUpdatedIssues(backlogDeps, since, config.maxIssuesPerRun)

  if (issues.length === 0) {
    logger.info('No updated issues found')
    state = setLastPolledAt(state, syncStart)
    saveState(STATE_FILE, state)
    return { created: 0, updated: 0, failed: 0, skipped: 0, total: 0 }
  }

  logger.info(`Processing ${issues.length} issues`)

  let created = 0
  let updated = 0
  let failed = 0

  for (const issue of issues) {
    try {
      const result = await syncTicket(issue, state, config, projectId)
      state = result.updatedState

      if (result.action === 'created') created++
      else updated++
    } catch (err) {
      failed++
      logger.error(`Failed to sync ${issue.issueKey}: ${err}`)
    }
  }

  state = setLastPolledAt(state, syncStart)
  saveState(STATE_FILE, state)

  const result: SyncResult = {
    created,
    updated,
    failed,
    skipped: 0,
    total: issues.length,
  }

  logger.info('Sync complete', result as unknown as Record<string, unknown>)
  return result
}
