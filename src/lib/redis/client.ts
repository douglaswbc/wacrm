import Redis from 'ioredis'

let client: Redis | null = null
let connectErrorLogged = false

/**
 * Returns a shared Redis client, or null if REDIS_URL is not set or
 * the connection fails.  When Redis is unavailable the system degrades
 * gracefully (no debounce, messages are processed immediately).
 */
export function getRedis(): Redis | null {
  const url = process.env.REDIS_URL
  if (!url) return null

  if (!client) {
    client = new Redis(url, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        if (times > 3) return null
        return Math.min(times * 200, 2000)
      },
      lazyConnect: true,
      enableReadyCheck: true,
    })

    client.on('error', (err) => {
      if (!connectErrorLogged) {
        console.error('[redis] connection error:', err.message)
        connectErrorLogged = true
      }
    })

    client.connect().catch(() => {
      console.warn('[redis] initial connect failed — running without debounce')
      client = null
    })
  }

  return client
}
