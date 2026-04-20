import { logger } from './logger.js'
import type { BacklogIssue, SyncConfig } from './types.js'

const MAX_PER_PAGE = 100
const MAX_RETRIES = 3
const RETRY_BASE_MS = 1000

interface BacklogClientDeps {
  readonly space: string
  readonly domain: string
  readonly apiKey: string
  readonly projectId: string
}

function buildBaseUrl(deps: BacklogClientDeps): string {
  return `https://${deps.space}.${deps.domain}/api/v2`
}

async function fetchWithRetry(url: string, options?: RequestInit, retries = MAX_RETRIES): Promise<Response> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const response = await fetch(url, options)

    if (response.ok) return response

    if (response.status === 429 || response.status >= 500) {
      if (attempt < retries) {
        const delay = RETRY_BASE_MS * Math.pow(2, attempt - 1)
        logger.warn(`Backlog API ${response.status}, retrying in ${delay}ms`, {
          attempt,
          status: response.status,
        })
        await new Promise((resolve) => setTimeout(resolve, delay))
        continue
      }
    }

    const body = await response.text().catch(() => 'unable to read body')
    throw new Error(`Backlog API error ${response.status}: ${body}`)
  }

  throw new Error('Backlog API: max retries exceeded')
}

export async function fetchUpdatedIssues(
  config: BacklogClientDeps,
  since: string,
  maxIssues: number
): Promise<ReadonlyArray<BacklogIssue>> {
  const baseUrl = buildBaseUrl(config)
  const allIssues: BacklogIssue[] = []
  let offset = 0

  logger.info(`Fetching Backlog issues updated since ${since}`)

  while (allIssues.length < maxIssues) {
    const params = new URLSearchParams({
      'projectId[]': config.projectId,
      updatedSince: since.split('T')[0],
      sort: 'updated',
      order: 'asc',
      count: String(MAX_PER_PAGE),
      offset: String(offset),
      apiKey: config.apiKey,
    })

    const url = `${baseUrl}/issues?${params.toString()}`
    const response = await fetchWithRetry(url)
    const issues = (await response.json()) as BacklogIssue[]

    if (issues.length === 0) break

    allIssues.push(...issues)
    logger.debug(`Fetched ${issues.length} issues (total: ${allIssues.length})`)

    if (issues.length < MAX_PER_PAGE) break

    offset += MAX_PER_PAGE
  }

  const result = allIssues.slice(0, maxIssues)
  logger.info(`Fetched ${result.length} Backlog issues total`)
  return result
}

export async function fetchSingleIssue(
  config: BacklogClientDeps,
  issueIdOrKey: string | number
): Promise<BacklogIssue> {
  const baseUrl = buildBaseUrl(config)
  const url = `${baseUrl}/issues/${issueIdOrKey}?apiKey=${config.apiKey}`
  const response = await fetchWithRetry(url)
  return (await response.json()) as BacklogIssue
}

export function buildBacklogUrl(config: BacklogClientDeps, issueKey: string): string {
  return `https://${config.space}.${config.domain}/view/${issueKey}`
}

export function createBacklogDeps(config: SyncConfig): BacklogClientDeps {
  return {
    space: config.backlogSpace,
    domain: config.backlogDomain,
    apiKey: config.backlogApiKey,
    projectId: config.backlogProjectId,
  }
}
