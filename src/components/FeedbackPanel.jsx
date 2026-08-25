import { useState } from 'react'
import { ChevronLeft } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { FEEDBACK_EMAIL, feedbackMailto } from '../lib/platform'

export default function FeedbackPanel({ profile, company, onBack }) {
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    if (!message.trim()) {
      setError('Write a short note about what you need or what is not working.')
      return
    }
    setSending(true)
    try {
      const row = {
        message: message.trim(),
        email: profile?.email || null,
        user_id: profile?.id || null,
        company_id: profile?.company_id || company?.id || null,
        company_name: company?.name || null,
        user_role: profile?.role || null,
        status: 'new',
      }
      const { error: insErr } = await supabase.from('app_feedback').insert(row)
      if (insErr) {
        // Still offer mailto if table missing
        console.warn(insErr)
        window.location.href = feedbackMailto({
          subject: 'BuildWatch feedback',
          body: message.trim(),
          fromEmail: profile?.email,
        })
        setDone(true)
        setSending(false)
        return
      }
      setDone(true)
      setMessage('')
    } catch (err) {
      setError(err.message || 'Could not send feedback.')
    }
    setSending(false)
  }

  return (
    <div>
      <button type="button" onClick={onBack} className="flex items-center gap-1 text-sm text-[#6B6E72] mb-4">
        <ChevronLeft size={16} /> Back
      </button>
      <h2 className="font-display text-2xl mb-1">Feedback</h2>
      <p className="text-sm text-[#6B6E72] mb-4">
        Tell us what to improve. Messages go to the BuildWatch team ({FEEDBACK_EMAIL}).
      </p>

      {done ? (
        <div className="bg-white border border-black rounded-md p-4 space-y-3">
          <p className="text-sm">Thanks — your feedback was sent.</p>
          <button
            type="button"
            className="text-sm underline"
            onClick={() => setDone(false)}
          >
            Send another
          </button>
          <div>
            <a
              href={feedbackMailto({
                subject: 'BuildWatch feedback',
                body: '',
                fromEmail: profile?.email,
              })}
              className="text-sm text-[#6B6E72] underline"
            >
              Or email {FEEDBACK_EMAIL} directly
            </a>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="bg-white border border-black rounded-md p-4 space-y-3 max-w-md">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={5}
            placeholder="What is working, what is missing, or what broke…"
            className="w-full border border-black rounded px-3 py-2 text-sm"
            required
          />
          {error && <p className="text-sm text-[#B5533C]">{error}</p>}
          <button
            type="submit"
            disabled={sending}
            className="w-full py-2.5 rounded text-sm text-white bg-black disabled:opacity-50"
          >
            {sending ? 'Sending…' : 'Send feedback'}
          </button>
          <a
            href={feedbackMailto({
              subject: 'BuildWatch feedback',
              body: message || '',
              fromEmail: profile?.email,
            })}
            className="block text-center text-xs text-[#6B6E72] underline"
          >
            Prefer email app → {FEEDBACK_EMAIL}
          </a>
        </form>
      )}
    </div>
  )
}
