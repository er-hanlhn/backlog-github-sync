import { readFileSync } from 'node:fs'
import { logger } from './logger.js'
import type { WebhookPayload } from './types.js'

// Backlog webhook event types
// 1=issue created, 2=updated, 3=commented, 14=deleted
const BACKLOG_EVENT_MAP: Record<number, WebhookPayload['action']> = {
  1: 'create',
  2: 'update',
  14: 'delete',
}

interface RepositoryDispatchPayload {
  action: string
  client_payload: {
    action?: string
    issueKey?: string
    backlog_event_type?: number
    raw?: Record<string, unknown>
  }
}

export function isWebhookTrigger(): boolean {
  return process.env.GITHUB_EVENT_NAME === 'repository_dispatch'
}

export function parseWebhookPayload(): WebhookPayload | null {
  const eventPath = process.env.GITHUB_EVENT_PATH
  if (!eventPath) {
    logger.warn('GITHUB_EVENT_PATH not set')
    return null
  }

  try {
    const raw = readFileSync(eventPath, 'utf-8')
    const event = JSON.parse(raw) as RepositoryDispatchPayload

    const clientPayload = event.client_payload
    if (!clientPayload) {
      logger.warn('No client_payload in repository_dispatch event')
      return null
    }

    // Support both direct action/issueKey and Backlog raw event type
    const action = clientPayload.action
      ?? (clientPayload.backlog_event_type
        ? BACKLOG_EVENT_MAP[clientPayload.backlog_event_type]
        : undefined)

    const issueKey = clientPayload.issueKey

    if (!action || !issueKey) {
      logger.warn('Missing action or issueKey in webhook payload', {
        action,
        issueKey,
      })
      return null
    }

    logger.info(`Webhook: ${action} ${issueKey}`)
    return { action: action as WebhookPayload['action'], issueKey }
  } catch (err) {
    logger.error(`Failed to parse webhook payload: ${err}`)
    return null
  }
}
