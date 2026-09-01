export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' })
    return
  }
  const key = process.env.XAI_API_KEY || process.env.OPENAI_API_KEY
  if (!key) {
    res.status(501).json({ error: 'no_key' })
    return
  }
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
  const messages = Array.isArray(body.messages) ? body.messages : []
  const context = String(body.context || '').slice(0, 14000)
  const system = `You are the BuildWatch job assistant for a contractor.
Answer only from the project context below. Use the current question AND earlier messages for which job they mean.
Be short and direct. No tips, no "you can also ask", no marketing.
If they ask for a quoted amount, give the quote and approved change-order total.
If context is missing an answer, say you do not have that on file.
Do not invent addresses, dollar amounts, or dates.

PROJECT CONTEXT:
${context}`

  const openai = !process.env.XAI_API_KEY && !!process.env.OPENAI_API_KEY
  const url = openai ? 'https://api.openai.com/v1/chat/completions' : 'https://api.x.ai/v1/chat/completions'
  const model = openai ? (process.env.OPENAI_MODEL || 'gpt-4o-mini') : (process.env.XAI_MODEL || 'grok-3')

  const r = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [{ role: 'system', content: system }, ...messages.slice(-16)],
    }),
  })
  const data = await r.json().catch(() => ({}))
  const text = data?.choices?.[0]?.message?.content
  if (!r.ok || !text) {
    res.status(502).json({ error: data?.error?.message || 'model_failed' })
    return
  }
  res.status(200).json({ text })
}
