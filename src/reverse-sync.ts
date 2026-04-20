import { readFileSync } from 'node:fs'
import { loadSyncConfig } from './config.js'
import { updateIssueStatus, createBacklogDeps } from './backlog-client.js'
import { loadState } from './state-manager.js'
import { logger } from './logger.js'

const STATE_FILE = '.sync-state.json'

interface GitHubIssueEvent {
  action: string
  issue: {
    number: number
    title: string
    state: string
  }
}

// Backlog status IDs (common defaults — configurable via env)
const BACKLOG_CLOSED_STATUS_ID = parseInt(process.env.BACKLOG_CLOSED_STATUS_ID ?? '4', 10)
const BACKLOG_OPEN_STATUS_ID = parseInt(process.env.BACKLOG_OPEN_STATUS_ID ?? '1', 10)

function findBacklogKeyByIssueNumber(
  state: ReturnType<typeof loadState>,
  issueNumber: number
): string | null {
  for (const [key, ref] of Object.entries(state.issueMap)) {
    if (ref.issueNumber === issueNumber) return key
  }
  return null
}

async function main(): Promise<void> {
  const eventPath = process.env.GITHUB_EVENT_PATH
  if (!eventPath) {
    logger.error('GITHUB_EVENT_PATH not set')
    process.exitCode = 1
    return
  }

  const raw = readFileSync(eventPath, 'utf-8')
  const event = JSON.parse(raw) as GitHubIssueEvent

  const { action, issue } = event
  logger.info(`Reverse sync: issue #${issue.number} ${action}`)

  if (action !== 'closed' && action !== 'reopened') {
    logger.info(`Ignoring action: ${action}`)
    return
  }

  const state = loadState(STATE_FILE)
  const backlogKey = findBacklogKeyByIssueNumber(state, issue.number)

  if (!backlogKey) {
    logger.info(`Issue #${issue.number} not found in sync state, skipping`)
    return
  }

  const config = loadSyncConfig()
  const backlogDeps = createBacklogDeps(config)

  const statusId = action === 'closed' ? BACKLOG_CLOSED_STATUS_ID : BACKLOG_OPEN_STATUS_ID

  try {
    await updateIssueStatus(backlogDeps, backlogKey, statusId)
    logger.info(`Reverse sync complete: ${backlogKey} -> status ${statusId}`)
  } catch (err) {
    logger.error(`Failed to update Backlog status for ${backlogKey}: ${err}`)
    process.exitCode = 1
  }
}

main().catch((err) => {
  logger.error(`Fatal error: ${err}`)
  process.exitCode = 1
})
