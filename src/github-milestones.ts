import { logger } from './logger.js'
import { setMilestoneMapping } from './state-manager.js'
import type { IssuesClientDeps } from './github-issues-client.js'
import type { SyncState } from './types.js'

interface GitHubMilestone {
  readonly number: number
  readonly title: string
}

export async function getOrCreateMilestone(
  deps: IssuesClientDeps,
  state: SyncState,
  milestoneName: string
): Promise<{ milestoneNumber: number; updatedState: SyncState }> {
  // Check cache first
  const cached = state.milestoneMap[milestoneName]
  if (cached) {
    return { milestoneNumber: cached, updatedState: state }
  }

  const baseUrl = `https://api.github.com/repos/${deps.owner}/${deps.repo}/milestones`
  const headers: Record<string, string> = {
    Authorization: `token ${deps.token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
  }

  // Search existing milestones
  const searchResponse = await fetch(`${baseUrl}?state=all&per_page=100`, { headers })
  if (searchResponse.ok) {
    const milestones = (await searchResponse.json()) as GitHubMilestone[]
    const found = milestones.find((m) => m.title === milestoneName)
    if (found) {
      logger.debug(`Found existing milestone: "${milestoneName}" (#${found.number})`)
      return {
        milestoneNumber: found.number,
        updatedState: setMilestoneMapping(state, milestoneName, found.number),
      }
    }
  }

  // Create new milestone
  const createResponse = await fetch(baseUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({ title: milestoneName }),
  })

  if (!createResponse.ok) {
    const body = await createResponse.text().catch(() => '')
    throw new Error(`Failed to create milestone "${milestoneName}": ${createResponse.status} ${body}`)
  }

  const created = (await createResponse.json()) as GitHubMilestone
  logger.info(`Created milestone: "${milestoneName}" (#${created.number})`)

  return {
    milestoneNumber: created.number,
    updatedState: setMilestoneMapping(state, milestoneName, created.number),
  }
}
