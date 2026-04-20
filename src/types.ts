// ── Backlog API types ──

export interface BacklogIssue {
  readonly id: number
  readonly issueKey: string
  readonly summary: string
  readonly description: string | null
  readonly issueType: { readonly id: number; readonly name: string }
  readonly status: { readonly id: number; readonly name: string }
  readonly priority: { readonly id: number; readonly name: string }
  readonly assignee: { readonly id: number; readonly name: string } | null
  readonly parentIssueId: number | null
  readonly dueDate: string | null
  readonly created: string
  readonly updated: string
  readonly attachments: ReadonlyArray<{ readonly id: number; readonly name: string }>
  readonly milestone: ReadonlyArray<{ readonly id: number; readonly name: string }>
  readonly category: ReadonlyArray<{ readonly id: number; readonly name: string }>
}

// ── GitHub types ──

export interface GitHubIssueRef {
  readonly id: number
  readonly issueNumber: number
  readonly nodeId: string
}

export type ProjectFieldType = 'single_select' | 'text' | 'date' | 'number'

export interface ProjectFieldOption {
  readonly id: string
  readonly name: string
}

export interface ProjectField {
  readonly fieldId: string
  readonly name: string
  readonly dataType: string
  readonly options?: ReadonlyArray<ProjectFieldOption>
}

export interface ProjectFieldValue {
  readonly fieldId: string
  readonly fieldType: ProjectFieldType
  readonly value: string
}

// ── State ──

export interface SyncState {
  readonly version: 2
  readonly lastPolledAt: string | null
  readonly issueMap: Readonly<Record<string, GitHubIssueRef>>
  readonly projectItemMap: Readonly<Record<string, string>>
  readonly projectFieldIds: Readonly<Record<string, ProjectField>>
  readonly milestoneMap: Readonly<Record<string, number>>
  readonly labelMap: Readonly<Record<string, string>>
}

// ── Config ──

export type SyncMode = 'draft' | 'issues'

export interface FieldMappingEntry {
  readonly backlog_field: string
  readonly project_field: string
  readonly type: ProjectFieldType
  readonly value_map?: Readonly<Record<string, string>>
}

export interface FieldMappingConfig {
  readonly fields: ReadonlyArray<FieldMappingEntry>
}

export interface SyncConfig {
  readonly backlogSpace: string
  readonly backlogDomain: string
  readonly backlogApiKey: string
  readonly backlogProjectId: string
  readonly githubToken: string
  readonly projectOwner: string
  readonly projectNumber: number
  readonly issuesOwner: string
  readonly issuesRepo: string
  readonly syncMode: SyncMode
  readonly fieldMappingPath: string
  readonly initialSyncHours: number
  readonly maxIssuesPerRun: number
  readonly overlapBufferMinutes: number
}

// ── Sync results ──

export interface SyncResult {
  readonly created: number
  readonly updated: number
  readonly failed: number
  readonly skipped: number
  readonly total: number
}

// ── Webhook ──

export type WebhookAction = 'create' | 'update' | 'delete'

export interface WebhookPayload {
  readonly action: WebhookAction
  readonly issueKey: string
}
