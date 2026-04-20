import { logger } from './logger.js'
import type { IssuesClientDeps } from './github-issues-client.js'

export async function addSubIssue(
  deps: IssuesClientDeps,
  parentIssueNumber: number,
  childIssueId: number
): Promise<void> {
  const url = `https://api.github.com/repos/${deps.owner}/${deps.repo}/issues/${parentIssueNumber}/sub_issues`

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `token ${deps.token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({ sub_issue_id: childIssueId }),
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      // 422 = already a sub-issue (idempotent)
      if (response.status === 422 && body.includes('already')) {
        logger.debug(`Issue #${childIssueId} is already a sub-issue of #${parentIssueNumber}`)
        return
      }
      logger.warn(
        `Failed to add sub-issue: parent=#${parentIssueNumber}, child=${childIssueId}: ${response.status} ${body}`
      )
      return
    }

    logger.info(`Linked sub-issue: #${childIssueId} -> parent #${parentIssueNumber}`)
  } catch (err) {
    // Sub-issues API is in beta; fail gracefully
    logger.warn(`Sub-issues API error (beta): ${err}`)
  }
}
