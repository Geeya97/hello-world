/**
 * Anthropic provider for the weather agent.
 *
 * Kept alongside the Gemini provider so switching brains is one environment
 * variable rather than a code change — this project has already changed its mind
 * once. Selected with LLM_PROVIDER=anthropic.
 */

const DEFAULT_MODEL = 'claude-sonnet-5';

/**
 * Run one conversation turn, including any tool round-trips.
 * Same signature as runGeminiTurn.
 */
export async function runAnthropicTurn({ system, tools, history, runTool, maxRounds = 6, client = null }) {
  const anthropic = client ?? (await defaultClient());
  const model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;

  const messages = history.map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: m.content,
  }));

  const actions = [];

  for (let round = 0; round < maxRounds; round += 1) {
    const response = await anthropic.messages.create({
      model,
      max_tokens: 2048,
      system,
      tools,
      messages,
    });

    if (response.stop_reason !== 'tool_use') {
      const reply = response.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
      return { reply: reply || "I didn't manage a reply to that — try rephrasing?", actions };
    }

    messages.push({ role: 'assistant', content: response.content });

    const results = [];
    for (const block of response.content) {
      if (block.type !== 'tool_use') continue;
      const { result, action } = await runTool(block.name, block.input ?? {});
      if (action) actions.push(action);
      results.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: JSON.stringify(result),
        ...(result?.error ? { is_error: true } : {}),
      });
    }
    messages.push({ role: 'user', content: results });
  }

  return {
    reply: "That took more steps than I expected and I've stopped to avoid looping. Could you narrow the request down?",
    actions,
  };
}

let cached = null;

async function defaultClient() {
  if (!cached) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      const err = new Error(
        'LLM_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set. Note an Anthropic API key is a separate paid product from a Claude.ai subscription.',
      );
      err.status = 400;
      throw err;
    }
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    cached = new Anthropic({ apiKey });
  }
  return cached;
}

export { DEFAULT_MODEL };
