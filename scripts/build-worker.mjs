import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const html = await readFile(resolve(root, 'dist/index.html'), 'utf8');
const manifest = await readFile(resolve(root, '.openai/hosting.json'), 'utf8');

const worker = `const page = ${JSON.stringify(html)};

const securityHeaders = {
  'content-security-policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'SAMEORIGIN'
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...securityHeaders, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

async function explain(request) {
  if (request.method !== 'POST') return json({ error: { message: 'Method not allowed.' } }, 405);
  const authorization = request.headers.get('authorization') || '';
  if (!authorization.startsWith('Bearer ') || authorization.length < 28) {
    return json({ error: { message: 'A valid OpenAI API key is required.' } }, 401);
  }

  let body;
  try { body = await request.json(); }
  catch { return json({ error: { message: 'Invalid request body.' } }, 400); }
  const passage = typeof body?.passage === 'string' ? body.passage.trim() : '';
  if (!passage) return json({ error: { message: 'A passage is required.' } }, 400);
  if (passage.length > 12000) return json({ error: { message: 'Passage exceeds the 12,000 character limit.' } }, 413);

  try {
    const upstream = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'authorization': authorization, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-5-mini',
        store: false,
        max_output_tokens: 900,
        instructions: 'You are a concise learning coach. Help the learner understand a passage before memorising it. Explain only what the supplied passage supports. Use plain language and preserve important distinctions. Return four short sections with these exact headings: PLAIN MEANING, STRUCTURE, KEY WORDS, CHECK YOUR UNDERSTANDING. Under the last heading, give exactly two short questions. Do not provide memorisation tricks yet.',
        input: 'Explain this passage for comprehension before memorisation:\\n\\n' + passage
      })
    });
    const responseBody = await upstream.text();
    return new Response(responseBody, {
      status: upstream.status,
      headers: { ...securityHeaders, 'content-type': upstream.headers.get('content-type') || 'application/json; charset=utf-8', 'cache-control': 'no-store' }
    });
  } catch {
    return json({ error: { message: 'The OpenAI request could not be completed.' } }, 502);
  }
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/api/explain') return explain(request);
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      return new Response(page, { headers: { ...securityHeaders, 'content-type': 'text/html; charset=utf-8' } });
    }
    return new Response('Not found', { status: 404, headers: securityHeaders });
  }
};
`;

await mkdir(resolve(root, 'dist/server'), { recursive: true });
await mkdir(resolve(root, 'dist/.openai'), { recursive: true });
await writeFile(resolve(root, 'dist/server/index.js'), worker);
await writeFile(resolve(root, 'dist/.openai/hosting.json'), manifest);
console.log('Built Worker with same-origin OpenAI proxy');
