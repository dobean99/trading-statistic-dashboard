// Vercel serverless function — same-origin proxy to Groq.
// Client hits /api/groq/openai/v1/chat/completions; this forwards to Groq
// with the bearer token from the Vercel env var, then returns the response.
// Edge runtime: fast cold start, generous free-tier limits.

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api\/groq/, '');
  const target = `https://api.groq.com${path}${url.search}`;

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'GROQ_API_KEY env var not set on Vercel' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const r = await fetch(target, {
    method: req.method,
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${apiKey}`,
    },
    body: req.method === 'POST' ? await req.text() : undefined,
  });

  return new Response(await r.text(), {
    status: r.status,
    headers: { 'content-type': 'application/json' },
  });
}
