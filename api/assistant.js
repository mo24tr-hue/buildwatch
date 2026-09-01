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
  const focus = String(body.focus || '')
  const system = `You are the BuildWatch job assistant for a contractor.
Use the project list below plus the chat history to know which job they mean (street number + a word from the address is enough).
${focus ? `They are most likely talking about: ${focus}.` : ''}
Answer in 1-3 short sentences. Use the numbers in the context.
If they ask quoted / construction cost / contract, give "Quoted amount" and "Quoted total".
If a field says "No quoted amount set", say no quote is entered yet.
NEVER say "I do not have that on file" when the project appears in the list. Use the facts you have.
Do not invent dollar amounts or dates that are not in the context.

PROJECTS:
${context}`

  const openai = !process.env.XAI_API_KEY && !!process.env.OPENAI_API_KEY
  const url = openai ? 'https://api.openai.com/v1/chat/completions' : 'https://api.x.ai/v1/chat/completions'
  const models = openai
    ? [process.env.OPENAI_MODEL || 'gpt-4o-mini']
    : [process.env.XAI_MODEL || 'grok-3', 'grok-2-latest', 'grok-2']

  let text = null
  let lastErr = 'model_failed'
  for (const model of models) {
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
    text = data?.choices?.[0]?.message?.content
    if (r.ok && text) break
    lastErr = data?.error?.message || lastErr
    text = null
  }
  if (!text) {
    res.status(502).json({ error: lastErr })
    return
  }
  res.status(200).json({ text })
}
