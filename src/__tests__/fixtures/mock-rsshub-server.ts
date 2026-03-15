import Fastify from 'fastify';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function createMockRSSHubServer(port: number = 0) {
  const app = Fastify();
  const requestLog: Array<{ route: string; query: Record<string, string> }> = [];

  // Serve tech.json for any RSSHub route
  const techFixture = readFileSync(path.join(__dirname, 'rss-samples', 'tech.json'), 'utf-8');

  app.get('/*', async (request, reply) => {
    const route = request.url.split('?')[0];
    const query = request.query as Record<string, string>;
    requestLog.push({ route, query });

    return reply
      .header('Content-Type', 'application/json')
      .send(techFixture);
  });

  const address = await app.listen({ port, host: '127.0.0.1' });
  const actualPort = (app.server.address() as any).port;

  return {
    app,
    address,
    port: actualPort,
    requestLog,
    close: () => app.close(),
  };
}
