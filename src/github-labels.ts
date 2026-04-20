import { logger } from './logger.js'
import { setLabelMapping } from './state-manager.js'
import type { IssuesClientDeps } from './github-issues-client.js'
import type { SyncState } from './types.js'

const DEFAULT_COLORS: Record<string, string> = {
  Bug: 'd73a4a',
  Task: '0075ca',
  Feature: 'a2eeef',
  Story: '7057ff',
  Improvement: '008672',
}

export async function getOrCreateLabel(
  deps: IssuesClientDeps,
  state: SyncState,
  backlogTypeName: string
): Promise<{ labelName: string; updatedState: SyncState }> {
  // Check cache first
  const cached = state.labelMap[backlogTypeName]
  if (cached) {
    return { labelName: cached, updatedState: state }
  }

  const labelName = backlogTypeName
  const baseUrl = `https://api.github.com/repos/${deps.owner}/${deps.repo}/labels`
  const headers: Record<string, string> = {
    Authorization: `token ${deps.token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
  }

  // Check if label exists
  const checkResponse = await fetch(
    `${baseUrl}/${encodeURIComponent(labelName)}`,
    { headers }
  )

  if (checkResponse.ok) {
    logger.debug(`Found existing label: "${labelName}"`)
    return {
      labelName,
      updatedState: setLabelMapping(state, backlogTypeName, labelName),
    }
  }

  // Create new label
  const color = DEFAULT_COLORS[backlogTypeName] ?? '666666'
  const createResponse = await fetch(baseUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: labelName, color }),
  })

  if (!createResponse.ok) {
    const body = await createResponse.text().catch(() => '')
    logger.warn(`Failed to create label "${labelName}": ${createResponse.status} ${body}`)
    return { labelName, updatedState: state }
  }

  logger.info(`Created label: "${labelName}" (color: #${color})`)
  return {
    labelName,
    updatedState: setLabelMapping(state, backlogTypeName, labelName),
  }
}
