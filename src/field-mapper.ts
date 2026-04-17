import { logger } from './logger.js'
import type {
  BacklogIssue,
  FieldMappingConfig,
  FieldMappingEntry,
  ProjectField,
  ProjectFieldValue,
} from './types.js'

type BacklogFieldExtractor = (issue: BacklogIssue, backlogUrl: string) => string | null

const FIELD_EXTRACTORS: Record<string, BacklogFieldExtractor> = {
  'status': (issue) => issue.status?.name ?? null,
  'priority': (issue) => issue.priority?.name ?? null,
  'assignee': (issue) => issue.assignee?.name ?? null,
  'dueDate': (issue) => issue.dueDate?.split('T')[0] ?? null,
  'issueKey': (issue) => issue.issueKey,
  'summary': (issue) => issue.summary,
  'url': (_issue, backlogUrl) => backlogUrl,
}

function extractBacklogValue(
  issue: BacklogIssue,
  fieldName: string,
  backlogUrl: string
): string | null {
  const extractor = FIELD_EXTRACTORS[fieldName]
  if (!extractor) {
    logger.warn(`No extractor for Backlog field: ${fieldName}`)
    return null
  }
  return extractor(issue, backlogUrl)
}

function resolveFieldValue(
  entry: FieldMappingEntry,
  rawValue: string,
  projectField: ProjectField
): ProjectFieldValue | null {
  switch (entry.type) {
    case 'single_select': {
      const mappedName = entry.value_map?.[rawValue]
      if (!mappedName) {
        logger.warn(`No value_map entry for "${rawValue}" in field "${entry.project_field}"`)
        return null
      }
      const option = projectField.options?.find((o) => o.name === mappedName)
      if (!option) {
        logger.warn(`Project field "${entry.project_field}" has no option "${mappedName}"`)
        return null
      }
      return { fieldId: projectField.fieldId, fieldType: 'single_select', value: option.id }
    }
    case 'text':
      return { fieldId: projectField.fieldId, fieldType: 'text', value: rawValue }
    case 'date':
      return { fieldId: projectField.fieldId, fieldType: 'date', value: rawValue }
    case 'number':
      return { fieldId: projectField.fieldId, fieldType: 'number', value: rawValue }
    default:
      logger.warn(`Unsupported field type: ${entry.type}`)
      return null
  }
}

export function mapTicketToFieldValues(
  issue: BacklogIssue,
  backlogUrl: string,
  mappingConfig: FieldMappingConfig,
  projectFields: Readonly<Record<string, ProjectField>>
): ReadonlyArray<ProjectFieldValue> {
  const values: ProjectFieldValue[] = []

  for (const entry of mappingConfig.fields) {
    const rawValue = extractBacklogValue(issue, entry.backlog_field, backlogUrl)
    if (rawValue === null) continue

    const projectField = projectFields[entry.project_field]
    if (!projectField) {
      logger.warn(`Project field "${entry.project_field}" not found in project`)
      continue
    }

    const fieldValue = resolveFieldValue(entry, rawValue, projectField)
    if (fieldValue) {
      values.push(fieldValue)
    }
  }

  return values
}

export function buildDraftIssueTitle(issue: BacklogIssue): string {
  return `[${issue.issueKey}] ${issue.summary}`
}

export function buildDraftIssueBody(issue: BacklogIssue, backlogUrl: string): string {
  const parts: string[] = []

  parts.push(`> Synced from [${issue.issueKey}](${backlogUrl})`)
  parts.push('')

  if (issue.description) {
    parts.push(issue.description)
    parts.push('')
  }

  parts.push('---')
  parts.push(`**Status:** ${issue.status?.name ?? 'Unknown'}`)
  parts.push(`**Priority:** ${issue.priority?.name ?? 'Unknown'}`)
  if (issue.assignee) parts.push(`**Assignee:** ${issue.assignee.name}`)
  if (issue.dueDate) parts.push(`**Due:** ${issue.dueDate.split('T')[0]}`)
  parts.push(`**Updated:** ${issue.updated}`)

  return parts.join('\n')
}
