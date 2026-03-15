import Fastify from 'fastify';

interface MessageRequest {
  model: string;
  max_tokens: number;
  temperature?: number;
  tools?: unknown[];
  tool_choice?: unknown;
  messages: Array<{ role: string; content: string }>;
}

export async function createMockModelServer(port: number = 0) {
  const app = Fastify();
  const receivedRequests: MessageRequest[] = [];

  app.post('/v1/messages', async (request, reply) => {
    const body = request.body as MessageRequest;
    receivedRequests.push(body);

    // Extract event title from the prompt
    const userMessage = body.messages.find(m => m.role === 'user')?.content || '';
    const titleMatch = userMessage.match(/Title:\s*(.+)/);
    const title = (titleMatch?.[1] || '').toLowerCase();

    // Deterministic scoring based on keywords
    let urgency = 70;
    let relevance = 65;
    let novelty = 60;
    let tags = ['other'];
    let reason = 'Standard news item with moderate significance.';

    if (title.includes('breaking') || title.includes('crash') || title.includes('outage')) {
      urgency = 90;
      relevance = 85;
      novelty = 80;
      tags = ['finance', 'macro'];
      reason = 'Breaking news with high market impact requiring immediate attention.';
    } else if (title.includes('quarterly') || title.includes('report') || title.includes('earnings')) {
      urgency = 50;
      relevance = 75;
      novelty = 40;
      tags = ['finance', 'earnings'];
      reason = 'Routine quarterly reporting with expected results.';
    } else if (title.includes('ai') || title.includes('model') || title.includes('startup')) {
      urgency = 65;
      relevance = 80;
      novelty = 75;
      tags = ['tech'];
      reason = 'Technology development with industry relevance.';
    }

    return reply.status(200).send({
      id: 'msg_mock_001',
      type: 'message',
      role: 'assistant',
      model: body.model,
      content: [
        {
          type: 'tool_use',
          id: 'toolu_mock_001',
          name: 'score_event',
          input: {
            urgency_score: urgency,
            relevance_score: relevance,
            novelty_score: novelty,
            category_tags: tags,
            reason,
          },
        },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 100, output_tokens: 50 },
    });
  });

  const address = await app.listen({ port, host: '127.0.0.1' });
  const actualPort = (app.server.address() as any).port;

  return {
    app,
    address,
    port: actualPort,
    receivedRequests,
    close: () => app.close(),
  };
}
