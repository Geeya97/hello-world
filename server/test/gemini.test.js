import test from 'node:test';
import assert from 'node:assert/strict';

import { runGeminiTurn } from '../src/llm/gemini.js';

/**
 * These pin the three Gemini wire-format details that were established by
 * testing against the live API and are easy to break by "tidying up":
 *
 *  - tool results use role "user"; role "function" is rejected outright
 *  - the model turn is echoed back verbatim so thoughtSignature survives
 *  - functionResponse.response must be an object
 */

/** A fake Gemini that replays scripted candidates and records what it received. */
function fakeGemini(candidates) {
  const requests = [];
  let i = 0;
  const fetchImpl = async (url, init) => {
    requests.push({ url, body: JSON.parse(init.body) });
    const candidate = candidates[i++];
    return { json: async () => (candidate.error ? candidate : { candidates: [candidate] }) };
  };
  return { fetchImpl, requests };
}

const PING_TOOL = [{
  name: 'ping',
  description: 'test tool',
  input_schema: { type: 'object', properties: { q: { type: 'string' } } },
}];

const base = {
  system: 'be helpful',
  tools: PING_TOOL,
  history: [{ role: 'user', content: 'hello' }],
};

test.beforeEach(() => { process.env.GEMINI_API_KEY = 'test-key'; });
test.afterEach(() => { delete process.env.GEMINI_API_KEY; });

test('returns plain text when the model makes no tool call', async () => {
  const { fetchImpl } = fakeGemini([{ content: { role: 'model', parts: [{ text: 'hi there' }] }, finishReason: 'STOP' }]);
  const result = await runGeminiTurn({ ...base, runTool: async () => ({ result: {} }), fetchImpl });
  assert.equal(result.reply, 'hi there');
  assert.deepEqual(result.actions, []);
});

test('sends tool results with role "user" — role "function" is rejected by the API', async () => {
  const { fetchImpl, requests } = fakeGemini([
    { content: { role: 'model', parts: [{ functionCall: { name: 'ping', args: { q: 'x' } } }] }, finishReason: 'STOP' },
    { content: { role: 'model', parts: [{ text: 'done' }] }, finishReason: 'STOP' },
  ]);

  await runGeminiTurn({ ...base, runTool: async () => ({ result: { ok: true } }), fetchImpl });

  const contents = requests[1].body.contents;
  const toolTurn = contents.at(-1);
  assert.equal(toolTurn.role, 'user', 'tool results must be role "user"');
  assert.equal(toolTurn.parts[0].functionResponse.name, 'ping');
  assert.deepEqual(toolTurn.parts[0].functionResponse.response, { ok: true });
});

test('echoes the model turn verbatim so thoughtSignature survives', async () => {
  const modelTurn = {
    role: 'model',
    parts: [{ functionCall: { name: 'ping', args: {} } }, { thoughtSignature: 'OPAQUE-SIG' }],
  };
  const { fetchImpl, requests } = fakeGemini([
    { content: modelTurn, finishReason: 'STOP' },
    { content: { role: 'model', parts: [{ text: 'done' }] }, finishReason: 'STOP' },
  ]);

  await runGeminiTurn({ ...base, runTool: async () => ({ result: {} }), fetchImpl });

  const echoed = requests[1].body.contents[1];
  assert.deepEqual(echoed, modelTurn, 'the model turn must be passed back unmodified');
});

test('wraps a non-object tool result, since response must be an object', async () => {
  const { fetchImpl, requests } = fakeGemini([
    { content: { role: 'model', parts: [{ functionCall: { name: 'ping', args: {} } }] }, finishReason: 'STOP' },
    { content: { role: 'model', parts: [{ text: 'done' }] }, finishReason: 'STOP' },
  ]);

  await runGeminiTurn({ ...base, runTool: async () => ({ result: 'a bare string' }), fetchImpl });

  const response = requests[1].body.contents.at(-1).parts[0].functionResponse.response;
  assert.deepEqual(response, { result: 'a bare string' });
});

test('maps assistant history to Gemini\'s "model" role', async () => {
  const { fetchImpl, requests } = fakeGemini([{ content: { role: 'model', parts: [{ text: 'ok' }] }, finishReason: 'STOP' }]);

  await runGeminiTurn({
    ...base,
    history: [
      { role: 'user', content: 'one' },
      { role: 'assistant', content: 'two' },
      { role: 'user', content: 'three' },
    ],
    runTool: async () => ({ result: {} }),
    fetchImpl,
  });

  assert.deepEqual(requests[0].body.contents.map((c) => c.role), ['user', 'model', 'user']);
});

test('converts tool schemas to functionDeclarations', async () => {
  const { fetchImpl, requests } = fakeGemini([{ content: { role: 'model', parts: [{ text: 'ok' }] }, finishReason: 'STOP' }]);
  await runGeminiTurn({ ...base, runTool: async () => ({ result: {} }), fetchImpl });

  const declarations = requests[0].body.tools[0].functionDeclarations;
  assert.equal(declarations.length, 1);
  assert.equal(declarations[0].name, 'ping');
  assert.deepEqual(declarations[0].parameters, PING_TOOL[0].input_schema);
});

test('collects actions from tool calls', async () => {
  const { fetchImpl } = fakeGemini([
    { content: { role: 'model', parts: [{ functionCall: { name: 'ping', args: {} } }] }, finishReason: 'STOP' },
    { content: { role: 'model', parts: [{ text: 'sent' }] }, finishReason: 'STOP' },
  ]);

  const result = await runGeminiTurn({
    ...base,
    runTool: async () => ({ result: { ok: true }, action: { type: 'send', to: 'dad@refrigerationservices.com.au' } }),
    fetchImpl,
  });

  assert.deepEqual(result.actions, [{ type: 'send', to: 'dad@refrigerationservices.com.au' }]);
});

test('stops looping instead of calling tools forever', async () => {
  const toolCall = { content: { role: 'model', parts: [{ functionCall: { name: 'ping', args: {} } }] }, finishReason: 'STOP' };
  const { fetchImpl, requests } = fakeGemini(Array(10).fill(toolCall));

  const result = await runGeminiTurn({ ...base, runTool: async () => ({ result: {} }), maxRounds: 3, fetchImpl });

  assert.equal(requests.length, 3);
  assert.match(result.reply, /stopped to avoid looping/);
});

test('quota errors say what to do about them', async () => {
  const { fetchImpl } = fakeGemini([{ error: { code: 429, message: 'You exceeded your current quota' } }]);
  await assert.rejects(
    () => runGeminiTurn({ ...base, runTool: async () => ({ result: {} }), fetchImpl }),
    /free-tier quota exceeded.*Wait a minute/is,
  );
});

test('a model closed to new keys points at one that works', async () => {
  const { fetchImpl } = fakeGemini([
    { error: { code: 404, message: 'This model models/gemini-2.5-flash is no longer available to new users.' } },
  ]);
  await assert.rejects(
    () => runGeminiTurn({ ...base, runTool: async () => ({ result: {} }), fetchImpl }),
    /gemini-flash-latest works/,
  );
});

test('a safety block is reported rather than silently returning nothing', async () => {
  const fetchImpl = async () => ({ json: async () => ({ promptFeedback: { blockReason: 'SAFETY' } }) });
  await assert.rejects(
    () => runGeminiTurn({ ...base, runTool: async () => ({ result: {} }), fetchImpl }),
    /declined that request \(SAFETY\)/,
  );
});

test('a missing key explains where to get one', async () => {
  delete process.env.GEMINI_API_KEY;
  await assert.rejects(
    () => runGeminiTurn({ ...base, runTool: async () => ({ result: {} }), fetchImpl: async () => ({ json: async () => ({}) }) }),
    /aistudio\.google\.com\/apikey/,
  );
});
