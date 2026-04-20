/**
 * One-time script to delete all items from a GitHub Project V2.
 * Usage: GITHUB_TOKEN=xxx GITHUB_PROJECT_OWNER=xxx GITHUB_PROJECT_NUMBER=2 npx tsx scripts/clear-project.ts
 */

import { graphql } from '@octokit/graphql'

const token = process.env.GITHUB_TOKEN!
const owner = process.env.GITHUB_PROJECT_OWNER!
const number = parseInt(process.env.GITHUB_PROJECT_NUMBER!, 10)

const gql = graphql.defaults({ headers: { authorization: `token ${token}` } })

async function getProjectId(): Promise<string> {
  try {
    const result: any = await gql(`
      query($owner: String!, $number: Int!) {
        organization(login: $owner) { projectV2(number: $number) { id } }
      }
    `, { owner, number })
    return result.organization.projectV2.id
  } catch {
    const result: any = await gql(`
      query($owner: String!, $number: Int!) {
        user(login: $owner) { projectV2(number: $number) { id } }
      }
    `, { owner, number })
    return result.user.projectV2.id
  }
}

async function getAllItems(projectId: string): Promise<string[]> {
  const ids: string[] = []
  let cursor: string | null = null

  while (true) {
    const result: any = await gql(`
      query($projectId: ID!, $cursor: String) {
        node(id: $projectId) {
          ... on ProjectV2 {
            items(first: 100, after: $cursor) {
              nodes { id }
              pageInfo { hasNextPage endCursor }
            }
          }
        }
      }
    `, { projectId, cursor })

    const items = result.node.items
    ids.push(...items.nodes.map((n: any) => n.id))

    if (!items.pageInfo.hasNextPage) break
    cursor = items.pageInfo.endCursor
  }

  return ids
}

async function deleteItem(projectId: string, itemId: string): Promise<void> {
  await gql(`
    mutation($projectId: ID!, $itemId: ID!) {
      deleteProjectV2Item(input: { projectId: $projectId, itemId: $itemId }) {
        deletedItemId
      }
    }
  `, { projectId, itemId })
}

async function main() {
  console.log(`Finding project #${number} for ${owner}...`)
  const projectId = await getProjectId()
  console.log(`Project ID: ${projectId}`)

  console.log('Fetching all items...')
  const items = await getAllItems(projectId)
  console.log(`Found ${items.length} items to delete`)

  for (let i = 0; i < items.length; i++) {
    await deleteItem(projectId, items[i])
    console.log(`Deleted ${i + 1}/${items.length}`)
  }

  console.log('Done! All items removed.')
}

main().catch(console.error)
