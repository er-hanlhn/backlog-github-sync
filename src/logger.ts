const PREFIX = '[backlog-sync]'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

function timestamp(): string {
  return new Date().toISOString()
}

export function debug(message: string, data?: Record<string, unknown>): void {
  const parts = [timestamp(), PREFIX, message]
  if (data) parts.push(JSON.stringify(data))
  console.log(parts.join(' '))
}

export function info(message: string, data?: Record<string, unknown>): void {
  const parts = [timestamp(), PREFIX, message]
  if (data) parts.push(JSON.stringify(data))
  console.log(parts.join(' '))
}

export function warn(message: string, data?: Record<string, unknown>): void {
  const parts = [timestamp(), PREFIX, message]
  if (data) parts.push(JSON.stringify(data))
  console.warn(`::warning::${message}`)
  console.warn(parts.join(' '))
}

export function error(message: string, data?: Record<string, unknown>): void {
  const parts = [timestamp(), PREFIX, message]
  if (data) parts.push(JSON.stringify(data))
  console.error(`::error::${message}`)
  console.error(parts.join(' '))
}

export const logger = { debug, info, warn, error }
