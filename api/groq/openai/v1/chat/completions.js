// Vercel function — fixed path /api/groq/openai/v1/chat/completions
// One-to-one mapping; no catch-all routing involved.

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'GROQ_API_KEY env var not set on Vercel' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${apiKey}`,
    },
    body: await req.text(),
  });

  return new Response(await r.text(), {
    status: r.status,
    headers: { 'content-type': 'application/json' },
  });
}
