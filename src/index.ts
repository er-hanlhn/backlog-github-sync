import { loadSyncConfig } from './config.js'
import { runSync } from './sync-engine.js'
import { logger } from './logger.js'

async function main(): Promise<void> {
  logger.info('Starting Backlog -> GitHub Projects V2 sync')

  const config = loadSyncConfig()

  logger.info('Config loaded', {
    space: config.backlogSpace,
    domain: config.backlogDomain,
    projectOwner: config.projectOwner,
    projectNumber: config.projectNumber,
    fieldMappingPath: config.fieldMappingPath,
  })

  const result = await runSync(config)

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
