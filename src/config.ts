import { readFileSync, existsSync } from 'node:fs'
import * as yaml from 'js-yaml'
import { logger } from './logger.js'
import type { SyncConfig, SyncMode, FieldMappingConfig, FieldMappingEntry } from './types.js'

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Required environment variable ${name} is not set`)
  }
  return value
}

function optionalEnv(name: string, fallback: string): string {
  return process.env[name] || fallback
}

export function loadSyncConfig(): SyncConfig {
  return {
    backlogSpace: requireEnv('BACKLOG_SPACE'),
    backlogDomain: optionalEnv('BACKLOG_DOMAIN', 'backlog.com'),
    backlogApiKey: requireEnv('BACKLOG_API_KEY'),
    backlogProjectId: requireEnv('BACKLOG_PROJECT_ID'),
    githubToken: requireEnv('GITHUB_TOKEN'),
    projectOwner: requireEnv('PROJECT_OWNER'),
    projectNumber: parseInt(requireEnv('PROJECT_NUMBER'), 10),
    issuesOwner: optionalEnv('ISSUES_OWNER', ''),
    issuesRepo: optionalEnv('ISSUES_REPO', ''),
    syncMode: optionalEnv('SYNC_MODE', 'draft') as SyncMode,
    fieldMappingPath: optionalEnv('FIELD_MAPPING_PATH', 'config/field-mapping.yml'),
    initialSyncHours: parseInt(optionalEnv('INITIAL_SYNC_HOURS', '720'), 10),
    maxIssuesPerRun: parseInt(optionalEnv('MAX_ISSUES_PER_RUN', '500'), 10),
    overlapBufferMinutes: parseInt(optionalEnv('OVERLAP_BUFFER_MINUTES', '1'), 10),
  }
}

export function loadFieldMapping(filePath: string): FieldMappingConfig {
  if (!existsSync(filePath)) {
    logger.warn(`Field mapping file not found at ${filePath}, using empty mapping`)
    return { fields: [] }
  }

  const raw = readFileSync(filePath, 'utf-8')
  const parsed = yaml.load(raw) as { fields?: unknown[] }

  if (!parsed || !Array.isArray(parsed.fields)) {
    logger.warn('Field mapping file has no "fields" array, using empty mapping')
    return { fields: [] }
  }

  const fields = parsed.fields.map((entry: unknown, index: number) => {
    const e = entry as Record<string, unknown>
    if (!e.backlog_field || !e.project_field || !e.type) {
      throw new Error(
        `Field mapping entry at index ${index} missing required fields (backlog_field, project_field, type)`
      )
    }
    return {
      backlog_field: String(e.backlog_field),
      project_field: String(e.project_field),
      type: String(e.type) as FieldMappingEntry['type'],
      value_map: e.value_map as Record<string, string> | undefined,
    }
  })

  logger.info(`Loaded ${fields.length} field mappings from ${filePath}`)
  return { fields }
}
