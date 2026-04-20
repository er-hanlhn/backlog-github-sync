import { graphql } from '@octokit/graphql'
import { logger } from './logger.js'
import type { ProjectField, ProjectFieldValue, SyncConfig } from './types.js'

export interface GitHubClientDeps {
  readonly token: string
  readonly projectOwner: string
  readonly projectNumber: number
}

function createGraphqlClient(token: string) {
  return graphql.defaults({
    headers: { authorization: `token ${token}` },
  })
}

// ── Discover project node ID ──

const DISCOVER_PROJECT_ORG = `
  query($owner: String!, $number: Int!) {
    organization(login: $owner) {
      projectV2(number: $number) {
        id
        title
      }
    }
  }
`

const DISCOVER_PROJECT_USER = `
  query($owner: String!, $number: Int!) {
    user(login: $owner) {
      projectV2(number: $number) {
        id
        title
      }
    }
  }
`

interface DiscoverProjectResponse {
  organization?: { projectV2: { id: string; title: string } }
  user?: { projectV2: { id: string; title: string } }
}

export async function discoverProjectId(deps: GitHubClientDeps): Promise<string> {
  const gql = createGraphqlClient(deps.token)

  // Try organization first, fall back to user
  try {
    const result = await gql<DiscoverProjectResponse>(DISCOVER_PROJECT_ORG, {
      owner: deps.projectOwner,
      number: deps.projectNumber,
    })
    const project = result.organization?.projectV2
    if (project) {
      logger.info(`Found org project: "${project.title}" (${project.id})`)
      return project.id
    }
  } catch {
    logger.debug('Not an org project, trying user project...')
  }

  try {
    const result = await gql<DiscoverProjectResponse>(DISCOVER_PROJECT_USER, {
      owner: deps.projectOwner,
      number: deps.projectNumber,
    })
    const project = result.user?.projectV2
    if (project) {
      logger.info(`Found user project: "${project.title}" (${project.id})`)
      return project.id
    }
  } catch (err) {
    throw new Error(
      `Failed to find project #${deps.projectNumber} for owner "${deps.projectOwner}": ${err}`
    )
  }

  throw new Error(
    `Project #${deps.projectNumber} not found for owner "${deps.projectOwner}"`
  )
}

// ── Discover project fields ──

const DISCOVER_FIELDS = `
  query($projectId: ID!) {
    node(id: $projectId) {
      ... on ProjectV2 {
        fields(first: 50) {
          nodes {
            ... on ProjectV2Field {
              id
              name
              dataType
            }
            ... on ProjectV2SingleSelectField {
              id
              name
              dataType
              options {
                id
                name
              }
            }
            ... on ProjectV2IterationField {
              id
              name
              dataType
            }
          }
        }
      }
    }
  }
`

interface FieldNode {
  id: string
  name: string
  dataType: string
  options?: Array<{ id: string; name: string }>
}

interface DiscoverFieldsResponse {
  node: { fields: { nodes: FieldNode[] } }
}

export async function discoverProjectFields(
  deps: GitHubClientDeps,
  projectId: string
): Promise<Record<string, ProjectField>> {
  const gql = createGraphqlClient(deps.token)
  const result = await gql<DiscoverFieldsResponse>(DISCOVER_FIELDS, { projectId })

  const fields: Record<string, ProjectField> = {}
  for (const node of result.node.fields.nodes) {
    if (!node.name || !node.id) continue
    fields[node.name] = {
      fieldId: node.id,
      name: node.name,
      dataType: node.dataType,
      options: node.options?.map((o) => ({ id: o.id, name: o.name })),
    }
  }

  logger.info(`Discovered ${Object.keys(fields).length} project fields`, {
    fieldNames: Object.keys(fields),
  })
  return fields
}

// ── Add draft issue to project ──

const ADD_DRAFT_ISSUE = `
  mutation($projectId: ID!, $title: String!, $body: String) {
    addProjectV2DraftIssue(input: {
      projectId: $projectId
      title: $title
      body: $body
    }) {
      projectItem {
        id
      }
    }
  }
`

interface AddDraftIssueResponse {
  addProjectV2DraftIssue: { projectItem: { id: string } }
}

export async function addDraftIssue(
  deps: GitHubClientDeps,
  projectId: string,
  title: string,
  body: string
): Promise<string> {
  const gql = createGraphqlClient(deps.token)
  const result = await gql<AddDraftIssueResponse>(ADD_DRAFT_ISSUE, {
    projectId,
    title,
    body,
  })

  const itemId = result.addProjectV2DraftIssue.projectItem.id
  logger.debug(`Created draft issue: ${title} -> ${itemId}`)
  return itemId
}

// ── Update draft issue (delete + recreate) ──

const DELETE_PROJECT_ITEM = `
  mutation($projectId: ID!, $itemId: ID!) {
    deleteProjectV2Item(input: {
      projectId: $projectId
      itemId: $itemId
    }) {
      deletedItemId
    }
  }
`

export async function updateDraftIssue(
  deps: GitHubClientDeps,
  projectId: string,
  itemId: string,
  title: string,
  body: string
): Promise<string> {
  const gql = createGraphqlClient(deps.token)

  // GitHub API has no updateProjectV2DraftIssue mutation.
  // Delete the old item and create a new one.
  await gql(DELETE_PROJECT_ITEM, { projectId, itemId })
  const newItemId = await addDraftIssue(deps, projectId, title, body)
  logger.debug(`Recreated draft issue: ${title} -> ${newItemId}`)
  return newItemId
}

// ── Add existing issue to project ──

const ADD_ITEM_BY_ID = `
  mutation($projectId: ID!, $contentId: ID!) {
    addProjectV2ItemById(input: {
      projectId: $projectId
      contentId: $contentId
    }) {
      item {
        id
      }
    }
  }
`

interface AddItemByIdResponse {
  addProjectV2ItemById: { item: { id: string } }
}

export async function addIssueToProject(
  deps: GitHubClientDeps,
  projectId: string,
  issueNodeId: string
): Promise<string> {
  const gql = createGraphqlClient(deps.token)
  const result = await gql<AddItemByIdResponse>(ADD_ITEM_BY_ID, {
    projectId,
    contentId: issueNodeId,
  })

  const itemId = result.addProjectV2ItemById.item.id
  logger.debug(`Added issue to project: ${issueNodeId} -> ${itemId}`)
  return itemId
}

// ── Update project item field value ──

const UPDATE_FIELD_SINGLE_SELECT = `
  mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
    updateProjectV2ItemFieldValue(input: {
      projectId: $projectId
      itemId: $itemId
      fieldId: $fieldId
      value: { singleSelectOptionId: $optionId }
    }) {
      projectV2Item { id }
    }
  }
`

const UPDATE_FIELD_TEXT = `
  mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $text: String!) {
    updateProjectV2ItemFieldValue(input: {
      projectId: $projectId
      itemId: $itemId
      fieldId: $fieldId
      value: { text: $text }
    }) {
      projectV2Item { id }
    }
  }
`

const UPDATE_FIELD_DATE = `
  mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $date: Date!) {
    updateProjectV2ItemFieldValue(input: {
      projectId: $projectId
      itemId: $itemId
      fieldId: $fieldId
      value: { date: $date }
    }) {
      projectV2Item { id }
    }
  }
`

const UPDATE_FIELD_NUMBER = `
  mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $number: Float!) {
    updateProjectV2ItemFieldValue(input: {
      projectId: $projectId
      itemId: $itemId
      fieldId: $fieldId
      value: { number: $number }
    }) {
      projectV2Item { id }
    }
  }
`

export async function updateItemField(
  deps: GitHubClientDeps,
  projectId: string,
  itemId: string,
  fieldValue: ProjectFieldValue
): Promise<void> {
  const gql = createGraphqlClient(deps.token)

  switch (fieldValue.fieldType) {
    case 'single_select':
      await gql(UPDATE_FIELD_SINGLE_SELECT, {
        projectId,
        itemId,
        fieldId: fieldValue.fieldId,
        optionId: fieldValue.value,
      })
      break
    case 'text':
      await gql(UPDATE_FIELD_TEXT, {
        projectId,
        itemId,
        fieldId: fieldValue.fieldId,
        text: fieldValue.value,
      })
      break
    case 'date':
      await gql(UPDATE_FIELD_DATE, {
        projectId,
        itemId,
        fieldId: fieldValue.fieldId,
        date: fieldValue.value,
      })
      break
    case 'number':
      await gql(UPDATE_FIELD_NUMBER, {
        projectId,
        itemId,
        fieldId: fieldValue.fieldId,
        number: parseFloat(fieldValue.value),
      })
      break
    default:
      logger.warn(`Unsupported field type: ${fieldValue.fieldType}`)
  }
}

export function createGitHubDeps(config: SyncConfig): GitHubClientDeps {
  return {
    token: config.githubToken,
    projectOwner: config.projectOwner,
    projectNumber: config.projectNumber,
  }
}
