/**
 * Gemini provider for the weather agent.
 *
 * Uses the REST API through fetch rather than an SDK: the wire format below was
 * verified directly against generativelanguage.googleapis.com, and it keeps the
 * project free of a dependency whose major versions churn.
 *
 * Three things about this API that are easy to get wrong, all confirmed by
 * testing rather than assumed:
 *
 *  1. Tool results go back with `role: "user"`. `role: "function"` is rejected
 *     outright with "Role 'function' is not supported", despite appearing in
 *     some of Google's own examples.
 *  2. Gemini 3 models return a `thoughtSignature` part alongside `functionCall`.
 *     The model turn must be appended to the history *verbatim* so that survives
 *     — reconstructing it from just the function call degrades multi-turn calling.
 *  3. `functionResponse.response` must be a JSON object, never a bare string.
 */

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_MODEL = 'gemini-flash-latest';
const REQUEST_TIMEOUT_MS = 90_000;

/**
 * Run one conversation turn, including any tool round-trips.
 *
 * @param {object} options
 * @param {string} options.system              system instruction
 * @param {Array} options.tools                tool defs in the shared shape { name, description, input_schema }
 * @param {Array} options.history              [{ role: 'user'|'assistant', content: string }]
 * @param {Function} options.runTool           async (name, args) => { result, action? }
 * @param {number} [options.maxRounds]
 * @returns {Promise<{ reply: string, actions: object[] }>}
 */
export async function runGeminiTurn({ system, tools, history, runTool, maxRounds = 6, fetchImpl = fetch }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw badRequest(
      'The chat agent needs a Gemini API key. Set GEMINI_API_KEY in the server environment — get one free at aistudio.google.com/apikey.',
    );
  }

  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const functionDeclarations = tools.map(toFunctionDeclaration);
  const contents = history.map(toContent);
  const actions = [];

  for (let round = 0; round < maxRounds; round += 1) {
    const candidate = await generate({ apiKey, model, system, contents, functionDeclarations, fetchImpl });

    const parts = candidate?.content?.parts ?? [];
    const calls = parts.filter((p) => p.functionCall).map((p) => p.functionCall);

    if (calls.length === 0) {
      const reply = parts.filter((p) => typeof p.text === 'string').map((p) => p.text).join('').trim();

      if (!reply && candidate?.finishReason === 'MAX_TOKENS') {
        return { reply: 'That answer ran long and got cut off. Could you narrow the question down?', actions };
      }
      return { reply: reply || "I didn't manage a reply to that — try rephrasing?", actions };
    }

    // Verbatim, so thoughtSignature and part ordering survive.
    contents.push(candidate.content);

    const responseParts = [];
    for (const call of calls) {
      const { result, action } = await runTool(call.name, call.args ?? {});
      if (action) actions.push(action);
      responseParts.push({
        functionResponse: { name: call.name, response: asObject(result) },
      });
    }
    contents.push({ role: 'user', parts: responseParts });
  }

  return {
    reply: "That took more steps than I expected and I've stopped to avoid looping. Could you narrow the request down?",
    actions,
  };
}

async function generate({ apiKey, model, system, contents, functionDeclarations, fetchImpl }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let data;
  try {
    const response = await fetchImpl(`${ENDPOINT}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents,
        tools: [{ functionDeclarations }],
        generationConfig: { maxOutputTokens: 2048, temperature: 0.4 },
      }),
    });
    data = await response.json();
  } catch (err) {
    if (err.name === 'AbortError') throw badRequest('Gemini took too long to answer. Try again.');
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (data?.error) throw translateError(data.error, model);

  // A safety filter can reject the prompt before any candidate is produced.
  const blockReason = data?.promptFeedback?.blockReason;
  if (blockReason) throw badRequest(`Gemini declined that request (${blockReason}). Try rewording it.`);

  const candidate = data?.candidates?.[0];
  if (!candidate) throw badRequest('Gemini returned no answer. Try again.');

  return candidate;
}

/**
 * Turn Gemini's errors into something a presenter can act on. The free tier's
 * quota is tight enough that 429 is a realistic mid-demo failure, so it gets a
 * specific message rather than a generic one.
 */
function translateError(error, model) {
  const { code, message = '' } = error;

  if (code === 429) {
    return badRequest(
      'Gemini free-tier quota exceeded. Wait a minute and try again, or enable billing in Google AI Studio for higher limits.',
    );
  }
  if (code === 404 && /no longer available|not found/i.test(message)) {
    return badRequest(
      `The model "${model}" is not available to this API key. Set GEMINI_MODEL to one that is — gemini-flash-latest works. Run \`npm run check\` to list the options.`,
    );
  }
  if (code === 400 && /API key not valid/i.test(message)) {
    return badRequest('That Gemini API key was rejected. Generate a new one at aistudio.google.com/apikey.');
  }
  if (code === 403) {
    return badRequest('Gemini refused the key (403). Check it is enabled for the Generative Language API.');
  }

  return badRequest(`Gemini error ${code}: ${message}`);
}

/** Shared tool shape → Gemini functionDeclaration. */
function toFunctionDeclaration(tool) {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.input_schema ?? { type: 'object', properties: {} },
  };
}

/** Our history shape → Gemini content. Gemini calls the assistant "model". */
function toContent(message) {
  return {
    role: message.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: message.content }],
  };
}

/** functionResponse.response must be an object; wrap anything that isn't. */
function asObject(result) {
  if (result && typeof result === 'object' && !Array.isArray(result)) return result;
  return { result };
}

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

export { DEFAULT_MODEL };
