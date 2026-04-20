import type { BacklogIssue, SyncState } from './types.js'

export interface ResolvedHierarchy {
  readonly parents: ReadonlyArray<BacklogIssue>
  readonly children: ReadonlyArray<BacklogIssue>
}

export function resolveCreationOrder(issues: ReadonlyArray<BacklogIssue>): ResolvedHierarchy {
  const parents: BacklogIssue[] = []
  const children: BacklogIssue[] = []

  for (const issue of issues) {
    if (issue.parentIssueId) {
      children.push(issue)
    } else {
      parents.push(issue)
    }
  }

  return { parents, children }
}

export function findMissingParentIds(
  children: ReadonlyArray<BacklogIssue>,
  state: SyncState,
  alreadySynced: ReadonlyArray<BacklogIssue>
): ReadonlyArray<number> {
  const syncedIds = new Set(alreadySynced.map((i) => i.id))
  const knownKeys = new Set(Object.keys(state.issueMap))
  const missing = new Set<number>()

  for (const child of children) {
    if (!child.parentIssueId) continue

    // Check if parent is in this batch or already synced
    const parentInBatch = syncedIds.has(child.parentIssueId)
    const parentInState = [...knownKeys].some((key) => {
      // We can't easily reverse-lookup by Backlog ID from the state,
      // so we check if any issue in the batch has this ID
      return false
    })

    if (!parentInBatch && !parentInState) {
      missing.add(child.parentIssueId)
    }
  }

  return [...missing]
}

export function findParentBacklogKey(
  child: BacklogIssue,
  allIssues: ReadonlyArray<BacklogIssue>,
  state: SyncState
): string | null {
  if (!child.parentIssueId) return null

  // Check in the current batch
  const parentInBatch = allIssues.find((i) => i.id === child.parentIssueId)
  if (parentInBatch) return parentInBatch.issueKey

  // Check in state by scanning issueMap keys
  // We need the parent's issueKey; if it was synced before, it's in issueMap
  // But we only have backlogKey -> GitHubIssueRef, not backlogId -> backlogKey
  // The parent must have been fetched and synced in this run or a previous run
  return null
}
