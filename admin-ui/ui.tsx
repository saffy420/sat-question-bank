import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Inbox, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { previewHTML } from '/shared/renderer.js';
import { api, mathify, type BankQuestion } from './helpers';

export function useResource<T>(url: string) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let ignore = false; setData(undefined); setError('');
    api<T>(url).then(d => { if (!ignore) setData(d); }).catch(e => { if (!ignore) setError(e.message); });
    return () => { ignore = true; };
  }, [url, version]);
  return { data, error, retry: () => setVersion(n => n + 1) };
}
export function Empty({ children }: { children: ReactNode }) { return <div className="empty"><Inbox size={30}/><p>{children}</p></div>; }
export function Pending({ error, retry }: { error: string; retry: () => void }) { return <div className="panel" role={error ? 'alert' : 'status'}>{error ? <><p>{error}. Try again.</p><button id="retry" onClick={retry}>Retry</button></> : 'Loading…'}</div>; }
export function ErrorText({ children }: { children?: ReactNode }) { return children ? <p className="error" role="alert">{children}</p> : null; }
export function Badge({ children, tone = '' }: { children: ReactNode; tone?: string }) { return <span className={`badge-ui ${tone}`}>{children}</span>; }
export function Pagination({ page, pages, onPage, prev = 'prev', next = 'next', total }: { page: number; pages: number; onPage: (n: number) => void; prev?: string; next?: string; total?: number }) {
  return <div className="pagination"><button id={prev} disabled={page <= 1} onClick={() => onPage(page-1)}><ChevronLeft/>Previous</button><span>Page {page} of {pages}{total != null ? ` (${total} attempts)` : ''}</span><button id={next} disabled={page >= pages} onClick={() => onPage(page+1)}>Next<ChevronRight/></button></div>;
}
export function Dialog({ title, children, close, slide = false }: { title: string; children: ReactNode; close: () => void; slide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const el = ref.current!, focus = document.activeElement as HTMLElement; el.showModal(); return () => { el.close(); focus?.focus(); }; }, []);
  return <dialog ref={ref} className={slide ? 'slide-over' : ''} aria-label={title} onCancel={e => { e.preventDefault(); close(); }}><header><h2>{title}</h2><button className="icon-button" aria-label="Close" onClick={close}><X/></button></header>{children}</dialog>;
}
export function HTML({ html, id, className }: { html: string; id?: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { if (ref.current) { ref.current.innerHTML = html; mathify(ref.current); } }, [html]);
  return <div id={id} className={className} ref={ref}/>;
}
export function Preview({ q, picked }: { q: BankQuestion; picked?: string }) {
  return <><HTML className="question-preview" html={previewHTML(q, document, picked)}/><p>{picked !== undefined && <>Student answer: {picked || 'Unavailable'} · </>}Correct answer: {q.answer || 'Unavailable'}</p></>;
}
