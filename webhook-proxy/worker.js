/**
 * Cloudflare Worker: Backlog Webhook -> GitHub repository_dispatch proxy
 *
 * Environment variables (set in Cloudflare dashboard or wrangler.toml):
 *   GITHUB_TOKEN   - GitHub PAT with repo scope
 *   GITHUB_REPO    - "owner/repo" of the sync repo (e.g., "er-hanlhn/backlog-github-sync")
 *   WEBHOOK_SECRET - (optional) shared secret for request validation
 */

// Backlog webhook event type -> action mapping
const EVENT_TYPE_MAP = {
  1: 'create',   // Issue created
  2: 'update',   // Issue updated
  3: 'update',   // Comment added (treat as update)
  14: 'delete',  // Issue deleted
}

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 })
    }

    // Optional: validate webhook secret
    if (env.WEBHOOK_SECRET) {
      const authHeader = request.headers.get('Authorization')
      if (authHeader !== `Bearer ${env.WEBHOOK_SECRET}`) {
        return new Response('Unauthorized', { status: 401 })
      }
    }

    try {
      const body = await request.json()

      const eventType = body.type
      const action = EVENT_TYPE_MAP[eventType]
      if (!action) {
        return new Response(`Ignoring event type: ${eventType}`, { status: 200 })
      }

      const issueKey = body.content?.key_id
        ? `${body.project?.projectKey}-${body.content.key_id}`
        : null

      if (!issueKey) {
        return new Response('No issue key found in payload', { status: 200 })
      }

      // Trigger GitHub repository_dispatch
      const response = await fetch(
        `https://api.github.com/repos/${env.GITHUB_REPO}/dispatches`,
        {
          method: 'POST',
          headers: {
            Authorization: `token ${env.GITHUB_TOKEN}`,
            Accept: 'application/vnd.github+json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            event_type: 'backlog-webhook',
            client_payload: {
              action,
              issueKey,
              backlog_event_type: eventType,
            },
          }),
        }
      )

      if (!response.ok) {
        const text = await response.text()
        return new Response(`GitHub API error: ${response.status} ${text}`, { status: 502 })
      }

      return new Response(`Dispatched: ${action} ${issueKey}`, { status: 200 })
    } catch (err) {
      return new Response(`Error: ${err.message}`, { status: 500 })
    }
  },
}
