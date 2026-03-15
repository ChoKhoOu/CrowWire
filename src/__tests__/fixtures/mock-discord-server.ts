import Fastify from 'fastify';

interface DiscordWebhookPayload {
  content?: string;
  embeds?: unknown[];
  username?: string;
  avatar_url?: string;
  [key: string]: unknown;
}

export interface MockDiscordServer {
  app: ReturnType<typeof Fastify>;
  address: string;
  port: number;
  receivedRequests: DiscordWebhookPayload[];
  simulateRateLimit: (enabled: boolean) => void;
  close: () => Promise<void>;
}

export async function createMockDiscordServer(port: number = 0): Promise<MockDiscordServer> {
  const app = Fastify();
  const receivedRequests: DiscordWebhookPayload[] = [];
  let rateLimitEnabled = false;

  // Discord webhook endpoint - POST /webhooks/:id/:token
  app.post('/webhooks/:id/:token', async (request, reply) => {
    if (rateLimitEnabled) {
      return reply
        .status(429)
        .header('Retry-After', '1')
        .header('X-RateLimit-Global', 'false')
        .send({
          message: 'You are being rate limited.',
          retry_after: 1.0,
          global: false,
        });
    }

    const body = request.body as DiscordWebhookPayload;
    receivedRequests.push(body);

    // Discord returns 204 No Content on success
    return reply.status(204).send();
  });

  const address = await app.listen({ port, host: '127.0.0.1' });
  const actualPort = (app.server.address() as { port: number }).port;

  return {
    app,
    address,
    port: actualPort,
    receivedRequests,
    simulateRateLimit: (enabled: boolean) => {
      rateLimitEnabled = enabled;
    },
    close: () => app.close(),
  };
}
