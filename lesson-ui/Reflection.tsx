import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { ReflectionOptions } from './types';

const SUGGEST_ERRORS: Record<number, string> = { 401: 'Please sign in again.', 429: 'You have reached today’s limit for suggestions. Try again tomorrow.' };
const FAILED = 'Could not send that. Check your connection and try again.';

export function Reflection({ sessionId, headers, close }: ReflectionOptions) {
  const dialog = useRef<HTMLDialogElement>(null);
  const alive = useRef(true);
  const request = useRef<AbortController | null>(null);
  const [category, setCategory] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [thanks, setThanks] = useState(false);
  const [error, setError] = useState('');
  useLayoutEffect(() => {
    alive.current = true;
    dialog.current?.showModal();
    return () => { alive.current = false; request.current?.abort(); dialog.current?.close(); };
  }, []);
  useEffect(() => {
    if (!thanks) return;
    const timer = setTimeout(() => { alive.current = false; dialog.current?.close(); close(); }, 4000);
    return () => clearTimeout(timer);
  }, [thanks, close]);
  const dismiss = () => { alive.current = false; request.current?.abort(); dialog.current?.close(); close(); };
  const send = async () => {
    if (!category || !body.trim() || body.trim().length > 2000 || request.current) return;
    const controller = new AbortController();
    request.current = controller; setSending(true); setError('');
    try {
      const auth = new Headers(await headers());
      if (!alive.current) return;
      auth.set('Content-Type', 'application/json');
      const response = await fetch('/api/suggestions', { method: 'POST', headers: auth, signal: controller.signal, body: JSON.stringify({ body: body.trim(), category, sessionId }) });
      if (!alive.current) return;
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        if (alive.current) setError(SUGGEST_ERRORS[response.status] || (typeof data?.error === 'string' ? data.error : FAILED));
        return;
      }
      setThanks(true);
    } catch {
      if (alive.current) setError(FAILED);
    } finally {
      request.current = null;
      if (alive.current) setSending(false);
    }
  };
  return <dialog id="lesson-reflection" className="lesson-reflection" ref={dialog} aria-labelledby="reflection-title" onCancel={event => { event.preventDefault(); dismiss(); }}>
    <header><h2 id="reflection-title">Session reflection</h2><button id="reflection-close" type="button" aria-label="Close reflection" onClick={dismiss}><X aria-hidden="true"/></button></header>
    {thanks ? <p id="reflection-thanks" role="status">Thanks! We read every suggestion.</p> : <form onSubmit={event => { event.preventDefault(); send(); }}>
      <fieldset disabled={sending}><legend>What would you like to share?</legend>{[['teaching', 'Teaching'], ['app', 'App'], ['other', 'Other']].map(([value, text]) => <label key={value}><input type="radio" name="reflection-category" value={value} checked={category === value} onChange={() => setCategory(value)}/>{text}</label>)}</fieldset>
      <label htmlFor="reflection-body">Your feedback</label><textarea id="reflection-body" maxLength={2000} value={body} disabled={sending} onChange={event => setBody(event.target.value)} placeholder="What worked well? What could be better?"/>
      <p id="reflection-error" role="alert">{error}</p>
      <button id="reflection-send" className="lesson-submit" type="submit" disabled={sending || !category || !body.trim()}>{sending ? 'Sending…' : 'Send'}</button>
    </form>}
  </dialog>;
}
