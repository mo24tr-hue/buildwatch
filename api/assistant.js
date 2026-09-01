const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'schedule_phases',
      description: 'Set a start date on one or more phases. Each phase can have a different date. Dates must be YYYY-MM-DD. Do not mark in progress; only set the date.',
      parameters: {
        type: 'object',
        properties: {
          address: { type: 'string', description: 'Project address as listed in context' },
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                phase: { type: 'string' },
                date: { type: 'string', description: 'YYYY-MM-DD' },
              },
              required: ['phase', 'date'],
            },
          },
        },
        required: ['items'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_meeting',
      description: 'Add a calendar meeting.',
      parameters: {
        type: 'object',
        properties: {
          address: { type: 'string' },
          title: { type: 'string' },
          date: { type: 'string', description: 'YYYY-MM-DD' },
          time: { type: 'string', description: 'HH:MM 24h optional' },
        },
        required: ['title', 'date'],
      },
    },
  },
]

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
  const today = String(body.today || '')
  const system = `You are the BuildWatch contractor assistant.
Today is ${today || 'unknown'}.
${focus ? `Current job in this chat: ${focus}.` : ''}
Use chat history plus the project list. A street number plus one word from the address is enough.
When they schedule several trades in one message, call schedule_phases ONCE with a separate date for each trade.
Resolve relative dates from today and from the previous item in that same list:
- "Monday" = the next Monday after today
- "next Thursday" after a Monday = the Thursday after that Monday
- "the Monday after that" = the Monday after the last date you just chose
Return dates as YYYY-MM-DD.
If they are only asking a question, do not call a tool. Answer in 1-3 sentences from the project list.
Never say you do not have it on file if the project is listed. If a quote is missing, say no quote is entered.
Do not invent money or dates.

PROJECTS:
${context}`

  const openai = !process.env.XAI_API_KEY && !!process.env.OPENAI_API_KEY
  const url = openai ? 'https://api.openai.com/v1/chat/completions' : 'https://api.x.ai/v1/chat/completions'
  const models = openai
    ? [process.env.OPENAI_MODEL || 'gpt-4o-mini']
    : [process.env.XAI_MODEL || 'grok-3', 'grok-4', 'grok-2-latest', 'grok-2']

  let text = null
  let tool_calls = null
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
        temperature: 0.1,
        tools: TOOLS,
        tool_choice: 'auto',
        messages: [{ role: 'system', content: system }, ...messages.slice(-16)],
      }),
    })
    const data = await r.json().catch(() => ({}))
    const msg = data?.choices?.[0]?.message
    if (r.ok && msg) {
      tool_calls = msg.tool_calls || null
      text = msg.content || null
      if (tool_calls || text) break
    }
    lastErr = data?.error?.message || lastErr
    text = null
    tool_calls = null
  }
  if (!text && !tool_calls) {
    res.status(502).json({ error: lastErr })
    return
  }
  res.status(200).json({ text, tool_calls })
}
