import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const source = await readFile(resolve(root, 'dist/server/index.js'), 'utf8');
const manifest = JSON.parse(await readFile(resolve(root, 'dist/.openai/hosting.json'), 'utf8'));
assert.equal(manifest.project_id, 'appgprj_6ab1f37d944c8191aa242cdec9dcb1e1');
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const worker = await import(moduleUrl);
assert.equal(typeof worker.default?.fetch, 'function');

const page = await worker.default.fetch(new Request('https://flow.test/'));
assert.equal(page.status, 200);
assert.match(await page.text(), /Understand before you memorise/);

const missingKey = await worker.default.fetch(new Request('https://flow.test/api/explain', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ passage: 'A short passage.' })
}));
assert.equal(missingKey.status, 401);

const nativeFetch = globalThis.fetch;
let upstreamRequest;
globalThis.fetch = async (url, options) => {
  upstreamRequest = { url, options };
  return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'PLAIN MEANING\nTest explanation' }] }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
};
try {
  const explanation = await worker.default.fetch(new Request('https://flow.test/api/explain', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer sk-test-not-a-real-key-1234567890' },
    body: JSON.stringify({ passage: 'A short passage.' })
  }));
  assert.equal(explanation.status, 200);
  assert.equal(upstreamRequest.url, 'https://api.openai.com/v1/responses');
  assert.equal(upstreamRequest.options.headers.authorization, 'Bearer sk-test-not-a-real-key-1234567890');
  const upstreamBody = JSON.parse(upstreamRequest.options.body);
  assert.equal(upstreamBody.store, false);
  assert.equal(upstreamBody.model, 'gpt-5-mini');
} finally {
  globalThis.fetch = nativeFetch;
}
console.log('Worker artifact and protected AI endpoint are valid');
