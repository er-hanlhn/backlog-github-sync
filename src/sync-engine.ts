import { logger } from './logger.js'
import {
  fetchUpdatedIssues,
  fetchSingleIssue,
  buildBacklogUrl,
  createBacklogDeps,
} from './backlog-client.js'
import {
  discoverProjectId,
  discoverProjectFields,
  addDraftIssue,
  updateDraftIssue,
  addIssueToProject,
  updateItemField,
  createGitHubDeps,
} from './github-client.js'
import {
  createIssue,
  updateIssue,
  fetchExistingIssueMap,
  createIssuesClientDeps,
} from './github-issues-client.js'
import { getOrCreateMilestone } from './github-milestones.js'
import { getOrCreateLabel } from './github-labels.js'
import { addSubIssue } from './github-sub-issues.js'
import { resolveCreationOrder } from './hierarchy-resolver.js'
import {
  mapTicketToFieldValues,
  buildDraftIssueTitle,
  buildDraftIssueBody,
} from './field-mapper.js'
import {
  loadState,
  saveState,
  setLastPolledAt,
  setIssueMapping,
  setProjectItemMapping,
  setProjectFieldIds,
} from './state-manager.js'
import { loadFieldMapping } from './config.js'
import type {
  SyncConfig,
  SyncResult,
  SyncState,
  BacklogIssue,
  WebhookPayload,
} from './types.js'

function stateFilePath(projectName: string): string {
  return `.sync-state-${projectName}.json`
}

function computeSinceTimestamp(state: SyncState, config: SyncConfig): string {
  if (state.lastPolledAt) {
    const sinceDate = new Date(state.lastPolledAt)
    sinceDate.setMinutes(sinceDate.getMinutes() - config.overlapBufferMinutes)
    return sinceDate.toISOString()
  }

  const initialDate = new Date()
  initialDate.setHours(initialDate.getHours() - config.initialSyncHours)
  logger.info(`First run: looking back ${config.initialSyncHours} hours`)
  return initialDate.toISOString()
}

// ── Draft mode (legacy) ──

async function syncTicketDraft(
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
    itemId = await updateDraftIssue(githubDeps, projectId, existingItemId, title, body)
    action = 'updated'
    logger.info(`Updated draft: ${issue.issueKey} -> ${itemId}`)
  } else {
    itemId = await addDraftIssue(githubDeps, projectId, title, body)
    action = 'created'
    logger.info(`Created draft: ${issue.issueKey} -> ${itemId}`)
  }

  const mappingConfig = loadFieldMapping(config.fieldMappingPath)
  const fieldValues = mapTicketToFieldValues(issue, backlogUrl, mappingConfig, state.projectFieldIds)

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

// ── Issues mode (new) ──

async function syncTicketIssue(
  issue: BacklogIssue,
  state: SyncState,
  config: SyncConfig,
  projectId: string,
  allIssues: ReadonlyArray<BacklogIssue>,
  existingIssues: ReadonlyMap<string, import('./types.js').GitHubIssueRef>
): Promise<{ updatedState: SyncState; action: 'created' | 'updated' }> {
  const backlogDeps = createBacklogDeps(config)
  const githubDeps = createGitHubDeps(config)
  const issuesDeps = createIssuesClientDeps(config)
  const backlogUrl = buildBacklogUrl(backlogDeps, issue.issueKey)
  let currentState = state

  const title = `[${issue.issueKey}] ${issue.summary}`

  // Build body
  const bodyParts: string[] = [
    `> Synced from [${issue.issueKey}](${backlogUrl})`,
    '',
  ]
  if (issue.description) {
    bodyParts.push(issue.description, '')
  }
  bodyParts.push('---')
  bodyParts.push(`**Status:** ${issue.status?.name ?? 'Unknown'}`)
  bodyParts.push(`**Priority:** ${issue.priority?.name ?? 'Unknown'}`)
  bodyParts.push(`**Type:** ${issue.issueType?.name ?? 'Unknown'}`)
  if (issue.assignee) bodyParts.push(`**Assignee:** ${issue.assignee.name}`)
  if (issue.dueDate) bodyParts.push(`**Due:** ${issue.dueDate.split('T')[0]}`)
  const body = bodyParts.join('\n')

  // Resolve labels from issue type
  const labels: string[] = []
  if (issue.issueType?.name) {
    const labelResult = await getOrCreateLabel(issuesDeps, currentState, issue.issueType.name)
    labels.push(labelResult.labelName)
    currentState = labelResult.updatedState
  }

  // Resolve milestone
  let milestoneNumber: number | undefined
  if (issue.milestone.length > 0) {
    const msResult = await getOrCreateMilestone(issuesDeps, currentState, issue.milestone[0].name)
    milestoneNumber = msResult.milestoneNumber
    currentState = msResult.updatedState
  }

  let existing = currentState.issueMap[issue.issueKey]

  // Dedup: if not in state, check pre-fetched existing issues map
  if (!existing) {
    const found = existingIssues.get(issue.issueKey)
    if (found) {
      currentState = setIssueMapping(currentState, issue.issueKey, found)
      existing = found
      logger.info(`Recovered existing issue: ${issue.issueKey} -> #${found.issueNumber}`)
    }
  }

  let action: 'created' | 'updated'

  if (existing) {
    // Update existing issue
    await updateIssue(issuesDeps, existing.issueNumber, {
      title,
      body,
      labels,
      milestone: milestoneNumber,
    })
    action = 'updated'
    logger.info(`Updated issue: ${issue.issueKey} -> #${existing.issueNumber}`)
  } else {
    // Create new issue
    const ref = await createIssue(issuesDeps, {
      title,
      body,
      labels,
      milestone: milestoneNumber,
    })
    currentState = setIssueMapping(currentState, issue.issueKey, ref)
    action = 'created'
    logger.info(`Created issue: ${issue.issueKey} -> #${ref.issueNumber}`)

    // Add to Project V2
    try {
      const projectItemId = await addIssueToProject(githubDeps, projectId, ref.nodeId)
      currentState = setProjectItemMapping(currentState, issue.issueKey, projectItemId)

      // Set project field values
      const mappingConfig = loadFieldMapping(config.fieldMappingPath)
      const fieldValues = mapTicketToFieldValues(
        issue, backlogUrl, mappingConfig, currentState.projectFieldIds
      )
      for (const fieldValue of fieldValues) {
        try {
          await updateItemField(githubDeps, projectId, projectItemId, fieldValue)
        } catch (err) {
          logger.warn(`Failed to set field for ${issue.issueKey}: ${err}`)
        }
      }
    } catch (err) {
      logger.warn(`Failed to add ${issue.issueKey} to project: ${err}`)
    }

    // Link as sub-issue if has parent
    if (issue.parentIssueId) {
      const parentInBatch = allIssues.find((i) => i.id === issue.parentIssueId)
      const parentKey = parentInBatch?.issueKey
      const parentRef = parentKey ? currentState.issueMap[parentKey] : undefined

      if (parentRef) {
        await addSubIssue(issuesDeps, parentRef.issueNumber, ref.id)
      } else {
        logger.warn(`Parent not found for ${issue.issueKey} (parentId: ${issue.parentIssueId})`)
      }
    }
  }

  return { updatedState: currentState, action }
}

// ── Main sync ──

export async function runSync(config: SyncConfig, webhook?: WebhookPayload): Promise<SyncResult> {
  const syncStart = new Date().toISOString()
  const stateFile = stateFilePath(config.projectName)
  let state = loadState(stateFile)

  const githubDeps = createGitHubDeps(config)
  const backlogDeps = createBacklogDeps(config)

  // Discover project
  const projectId = await discoverProjectId(githubDeps)
  const projectFields = await discoverProjectFields(githubDeps, projectId)
  state = setProjectFieldIds(state, projectFields)

  // Get issues to sync
  let issues: ReadonlyArray<BacklogIssue>

  if (webhook) {
    if (webhook.action === 'delete') {
      logger.info(`Ignoring delete event for ${webhook.issueKey} (one-way sync)`)
      return { created: 0, updated: 0, failed: 0, skipped: 1, total: 1 }
    }

    // Fetch single issue for create/update
    const issue = await fetchSingleIssue(backlogDeps, webhook.issueKey)
    issues = [issue]
  } else {
    // Batch polling mode
    const since = computeSinceTimestamp(state, config)
    issues = await fetchUpdatedIssues(backlogDeps, since, config.maxIssuesPerRun)
  }

  if (issues.length === 0) {
    logger.info('No updated issues found')
    state = setLastPolledAt(state, syncStart)
    saveState(stateFile, state)
    return { created: 0, updated: 0, failed: 0, skipped: 0, total: 0 }
  }

  logger.info(`Processing ${issues.length} issues (mode: ${config.syncMode})`)

  let created = 0
  let updated = 0
  let failed = 0

  if (config.syncMode === 'issues') {
    // Pre-fetch all existing issues for dedup (uses List API, not Search API)
    const issuesDeps = createIssuesClientDeps(config)
    const existingIssues = await fetchExistingIssueMap(issuesDeps)

    // Resolve hierarchy: parents first, then children
    const { parents, children } = resolveCreationOrder(issues)

    // Fetch missing parents for children
    const missingParentIds = new Set<number>()
    for (const child of children) {
      if (child.parentIssueId && !state.issueMap[child.issueKey]) {
        const parentInBatch = parents.find((p) => p.id === child.parentIssueId)
        if (!parentInBatch) {
          missingParentIds.add(child.parentIssueId)
        }
      }
    }

    // Fetch and sync missing parents
    const fetchedParents: BacklogIssue[] = []
    for (const parentId of missingParentIds) {
      try {
        const parent = await fetchSingleIssue(backlogDeps, parentId)
        fetchedParents.push(parent)
      } catch (err) {
        logger.warn(`Failed to fetch parent issue ${parentId}: ${err}`)
      }
    }

    const allParents = [...parents, ...fetchedParents]
    const allIssues = [...allParents, ...children]

    // Sync parents first
    for (const issue of allParents) {
      try {
        const result = await syncTicketIssue(issue, state, config, projectId, allIssues, existingIssues)
        state = result.updatedState
        if (result.action === 'created') created++
        else updated++
      } catch (err) {
        failed++
        logger.error(`Failed to sync ${issue.issueKey}: ${err}`)
      }
    }

    // Then sync children
    for (const issue of children) {
      try {
        const result = await syncTicketIssue(issue, state, config, projectId, allIssues, existingIssues)
        state = result.updatedState
        if (result.action === 'created') created++
        else updated++
      } catch (err) {
        failed++
        logger.error(`Failed to sync ${issue.issueKey}: ${err}`)
      }
    }
  } else {
    // Draft mode (legacy)
    for (const issue of issues) {
      try {
        const result = await syncTicketDraft(issue, state, config, projectId)
        state = result.updatedState
        if (result.action === 'created') created++
        else updated++
      } catch (err) {
        failed++
        logger.error(`Failed to sync ${issue.issueKey}: ${err}`)
      }
    }
  }

  state = setLastPolledAt(state, syncStart)
  saveState(stateFile, state)

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
