import Fastify from 'fastify';

interface DeliveryRequest {
  message: string;
  name: string;
  agentId: string;
  wakeMode: string;
  deliver: boolean;
  channel: string;
}

export async function createMockOpenClawServer(port: number = 0, expectedToken: string = 'test-token') {
  const app = Fastify();
  const receivedPayloads: Array<{ body: DeliveryRequest; headers: Record<string, string>; idempotencyKey?: string }> = [];
  let nextStatus = 202;

  app.post('/hooks/agent', async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (authHeader !== `Bearer ${expectedToken}`) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const body = request.body as DeliveryRequest;
    const idempotencyKey = request.headers['idempotency-key'] as string | undefined;

    receivedPayloads.push({
      body,
      headers: request.headers as Record<string, string>,
      idempotencyKey,
    });

    return reply.status(nextStatus).send({ status: 'accepted' });
  });

  const address = await app.listen({ port, host: '127.0.0.1' });
  const actualPort = (app.server.address() as any).port;

  return {
    app,
    address,
    port: actualPort,
    receivedPayloads,
    setNextStatus: (status: number) => { nextStatus = status; },
    close: () => app.close(),
  };
}
