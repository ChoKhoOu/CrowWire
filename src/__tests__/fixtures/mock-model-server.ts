import Fastify from 'fastify';

interface ChatCompletionRequest {
  model: string;
  max_tokens: number;
  temperature?: number;
  tools?: unknown[];
  tool_choice?: unknown;
  messages: Array<{ role: string; content: string }>;
}

export async function createMockModelServer(port: number = 0) {
  const app = Fastify();
  const receivedRequests: ChatCompletionRequest[] = [];

  app.post('/v1/chat/completions', async (request, reply) => {
    const body = request.body as ChatCompletionRequest;
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

    const toolCallArgs = JSON.stringify({
      urgency_score: urgency,
      relevance_score: relevance,
      novelty_score: novelty,
      category_tags: tags,
      reason,
    });

    return reply.status(200).send({
      id: 'chatcmpl-mock-001',
      object: 'chat.completion',
      model: body.model,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_mock_001',
                type: 'function',
                function: {
                  name: 'score_event',
                  arguments: toolCallArgs,
                },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
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
