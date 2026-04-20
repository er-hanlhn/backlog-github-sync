import { logger } from './logger.js'
import type { GitHubIssueRef, SyncConfig } from './types.js'

const MAX_RETRIES = 3
const RETRY_BASE_MS = 1000

export interface IssuesClientDeps {
  readonly token: string
  readonly owner: string
  readonly repo: string
}

interface CreateIssueParams {
  readonly title: string
  readonly body: string
  readonly labels?: ReadonlyArray<string>
  readonly milestone?: number
}

interface GitHubIssueResponse {
  readonly id: number
  readonly number: number
  readonly node_id: string
}

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = MAX_RETRIES
): Promise<Response> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const response = await fetch(url, options)

    if (response.ok) return response

    if (response.status === 429 || response.status >= 500) {
      if (attempt < retries) {
        const delay = RETRY_BASE_MS * Math.pow(2, attempt - 1)
        logger.warn(`GitHub API ${response.status}, retrying in ${delay}ms`, {
          attempt,
          status: response.status,
        })
        await new Promise((resolve) => setTimeout(resolve, delay))
        continue
      }
    }

    const body = await response.text().catch(() => 'unable to read body')
    throw new Error(`GitHub API error ${response.status}: ${body}`)
  }

  throw new Error('GitHub API: max retries exceeded')
}

function headers(token: string): Record<string, string> {
  return {
    Authorization: `token ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

export async function createIssue(
  deps: IssuesClientDeps,
  params: CreateIssueParams
): Promise<GitHubIssueRef> {
  const url = `https://api.github.com/repos/${deps.owner}/${deps.repo}/issues`

  const body: Record<string, unknown> = {
    title: params.title,
    body: params.body,
  }
  if (params.labels && params.labels.length > 0) body.labels = params.labels
  if (params.milestone) body.milestone = params.milestone

  const response = await fetchWithRetry(url, {
    method: 'POST',
    headers: headers(deps.token),
    body: JSON.stringify(body),
  })

  const data = (await response.json()) as GitHubIssueResponse
  logger.debug(`Created issue #${data.number} in ${deps.owner}/${deps.repo}`)

  return {
    id: data.id,
    issueNumber: data.number,
    nodeId: data.node_id,
  }
}

export async function updateIssue(
  deps: IssuesClientDeps,
  issueNumber: number,
  params: CreateIssueParams
): Promise<void> {
  const url = `https://api.github.com/repos/${deps.owner}/${deps.repo}/issues/${issueNumber}`

  const body: Record<string, unknown> = {
    title: params.title,
    body: params.body,
  }
  if (params.labels && params.labels.length > 0) body.labels = params.labels
  if (params.milestone) body.milestone = params.milestone

  await fetchWithRetry(url, {
    method: 'PATCH',
    headers: headers(deps.token),
    body: JSON.stringify(body),
  })

  logger.debug(`Updated issue #${issueNumber} in ${deps.owner}/${deps.repo}`)
}

export async function closeIssue(
  deps: IssuesClientDeps,
  issueNumber: number
): Promise<void> {
  const url = `https://api.github.com/repos/${deps.owner}/${deps.repo}/issues/${issueNumber}`

  await fetchWithRetry(url, {
    method: 'PATCH',
    headers: headers(deps.token),
    body: JSON.stringify({ state: 'closed' }),
  })

  logger.debug(`Closed issue #${issueNumber}`)
}

export function createIssuesClientDeps(config: SyncConfig): IssuesClientDeps {
  return {
    token: config.githubToken,
    owner: config.issuesOwner,
    repo: config.issuesRepo,
  }
}
