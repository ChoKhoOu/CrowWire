import type { PushTargetType, PushTargetConfig, TargetsConfig, QueueType } from '../types.js'
import { splitMarkdownMessages } from './formatter.js'

const DISCORD_API_BASE = 'https://discord.com/api/v10'

export interface PushTarget {
  name: string
  type: PushTargetType
  queues: QueueType[]
  send(text: string): Promise<void>
  destroy(): Promise<void>
}

export class DiscordRestTarget implements PushTarget {
  readonly name: string
  readonly type: PushTargetType = 'discord'
  readonly queues: QueueType[]

  constructor(
    name: string,
    private channelId: string,
    private botToken: string,
    queues: QueueType[]
  ) {
    this.name = name
    this.queues = queues
  }

  async send(text: string): Promise<void> {
    const chunks = splitMarkdownMessages(text)
    for (const chunk of chunks) {
      if (!chunk.trim()) continue
      await this.sendChunk(chunk)
    }
  }

  private async sendChunk(content: string, retries = 3): Promise<void> {
    const url = `${DISCORD_API_BASE}/channels/${this.channelId}/messages`

    for (let attempt = 0; attempt <= retries; attempt++) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 30_000)
      let res: Response
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `Bot ${this.botToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ content }),
          signal: controller.signal,
        })
      } finally {
        clearTimeout(timer)
      }

      if (res.ok) return

      if (res.status === 429) {
        // Rate limited — parse Retry-After and wait
        const retryAfter = parseFloat(res.headers.get('Retry-After') || '1') * 1000
        process.stderr.write(`[discord] Rate limited, waiting ${retryAfter}ms\n`)
        await new Promise(resolve => setTimeout(resolve, retryAfter))
        continue
      }

      if (attempt === retries) {
        const body = await res.text()
        throw new Error(`Discord API error ${res.status}: ${body}`)
      }

      // Server error — brief wait before retry
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)))
    }
  }

  async destroy(): Promise<void> {
    // No persistent connection — no cleanup needed
  }
}

export function createPushTargets(config: TargetsConfig, botToken: string): PushTarget[] {
  return config.targets.map((target: PushTargetConfig) => {
    switch (target.type) {
      case 'discord':
        return new DiscordRestTarget(target.name, target.channel_id, botToken, target.queues)
      default:
        throw new Error(`Unsupported push target type: ${target.type}`)
    }
  })
}

export function getTargetsForQueue(targets: PushTarget[], queueType: QueueType): PushTarget[] {
  return targets.filter(t => t.queues.includes(queueType))
}
