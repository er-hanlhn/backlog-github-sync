import { loadSyncConfig } from './config.js'
import { runSync } from './sync-engine.js'
import { isWebhookTrigger, parseWebhookPayload } from './webhook-handler.js'
import { logger } from './logger.js'

async function main(): Promise<void> {
  logger.info('Starting Backlog -> GitHub sync')

  const config = loadSyncConfig()

  logger.info('Config loaded', {
    space: config.backlogSpace,
    domain: config.backlogDomain,
    projectOwner: config.projectOwner,
    projectNumber: config.projectNumber,
    syncMode: config.syncMode,
    issuesRepo: config.syncMode === 'issues' ? `${config.issuesOwner}/${config.issuesRepo}` : 'N/A',
  })

  // Validate issues mode config
  if (config.syncMode === 'issues' && (!config.issuesOwner || !config.issuesRepo)) {
    throw new Error('GITHUB_ISSUES_OWNER and GITHUB_ISSUES_REPO are required when SYNC_MODE=issues')
  }

  // Detect trigger mode
  const webhook = isWebhookTrigger() ? parseWebhookPayload() : undefined

  if (webhook) {
    logger.info(`Webhook trigger: ${webhook.action} ${webhook.issueKey}`)
  } else {
    logger.info('Polling trigger (cron/manual)')
  }

  const result = await runSync(config, webhook ?? undefined)

  logger.info('Sync finished', {
    created: result.created,
    updated: result.updated,
    failed: result.failed,
    total: result.total,
  })

  if (result.failed > 0) {
    process.exitCode = 1
    logger.error(`${result.failed} ticket(s) failed to sync`)
  }
}

main().catch((err) => {
  logger.error(`Fatal error: ${err}`)
  process.exitCode = 1
})
