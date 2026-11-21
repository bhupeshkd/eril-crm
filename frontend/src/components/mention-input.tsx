'use client';

import { Fragment, useEffect, useRef, useState } from 'react';

export interface MentionPick {
  id: string;
  displayName: string;
}

/**
 * Text field with @-autocomplete. Typing "@" + part of a name lists matching members;
 * picking one inserts "@Display Name " and remembers who was picked.
 */
export function MentionInput({
  multiline,
  id,
  value,
  onChange,
  picked,
  onPicked,
  search,
  placeholder,
  rows = 3,
  maxLength,
  className = 'input',
}: {
  multiline?: boolean;
  id: string;
  value: string;
  onChange: (v: string) => void;
  picked: MentionPick[];
  onPicked: (p: MentionPick[]) => void;
  search: (q: string) => Promise<MentionPick[]>;
  placeholder?: string;
  rows?: number;
  maxLength?: number;
  className?: string;
}) {
  const ref = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  const [query, setQuery] = useState<{ text: string; start: number } | null>(null);
  const [results, setResults] = useState<MentionPick[]>([]);
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (!query) return setResults([]);
    let alive = true;
    const t = setTimeout(() => search(query.text).then((r) => alive && (setResults(r), setActive(0))).catch(() => alive && setResults([])), 150);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [query, search]);

  function detect(v: string, caret: number) {
    const before = v.slice(0, caret);
    const m = before.match(/(?:^|\s)@([^@\n]{0,30})$/);
    setQuery(m ? { text: m[1], start: caret - m[1].length - 1 } : null);
  }

  function choose(p: MentionPick) {
    if (!query) return;
    const caret = ref.current?.selectionStart ?? value.length;
    const insert = `@${p.displayName} `;
    const next = value.slice(0, query.start) + insert + value.slice(caret);
    onChange(next);
    if (!picked.some((x) => x.id === p.id)) onPicked([...picked, p]);
    setQuery(null);
    requestAnimationFrame(() => {
      const pos = query.start + insert.length;
      ref.current?.focus();
      ref.current?.setSelectionRange(pos, pos);
    });
  }

  const open = !!query && results.length > 0;
  const props = {
    ref,
    id,
    className,
    value,
    placeholder,
    maxLength,
    role: 'combobox',
    'aria-expanded': open,
    'aria-controls': `${id}-mentions`,
    'aria-autocomplete': 'list' as const,
    onChange: (e: React.ChangeEvent<HTMLTextAreaElement & HTMLInputElement>) => {
      onChange(e.target.value);
      detect(e.target.value, e.target.selectionStart ?? e.target.value.length);
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (!open) return;
      if (e.key === 'ArrowDown') setActive((a) => (a + 1) % results.length);
      else if (e.key === 'ArrowUp') setActive((a) => (a - 1 + results.length) % results.length);
      else if (e.key === 'Enter' || e.key === 'Tab') choose(results[active]);
      else if (e.key === 'Escape') setQuery(null);
      else return;
      e.preventDefault();
    },
    onBlur: () => setTimeout(() => setQuery(null), 150),
  };
  return (
    <div className="relative">
      {multiline ? <textarea rows={rows} {...props} /> : <input {...props} />}
      {open && (
        <ul id={`${id}-mentions`} role="listbox" className="absolute left-0 z-20 mt-1 max-h-56 w-64 overflow-y-auto rounded-md border border-slate-200 bg-white py-1 text-sm shadow-lg">
          {results.map((r, i) => (
            <li
              key={r.id}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(r);
              }}
              className={`cursor-pointer px-3 py-1.5 ${i === active ? 'bg-brand-50 text-brand-700' : 'hover:bg-slate-50'}`}
            >
              @{r.displayName}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Ids of picked members whose @name is still in the text (removed mentions aren't notified). */
export function mentionIds(text: string, picked: MentionPick[]) {
  const lower = text.toLowerCase();
  return picked.filter((p) => lower.includes(`@${p.displayName.toLowerCase()}`)).map((p) => p.id);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Renders text with @mentions highlighted (your own name stands out). React escapes everything. */
export function MentionText({ text, mentions }: { text: string; mentions?: Array<{ name: string; isMe?: boolean }> }) {
  if (!mentions?.length) return <>{text}</>;
  const names = [...mentions].sort((a, b) => b.name.length - a.name.length);
  const re = new RegExp(`(@(?:${names.map((m) => escapeRe(m.name)).join('|')}))(?![\\w])`, 'gi');
  return (
    <>
      {text.split(re).map((part, i) => {
        const m = i % 2 === 1 ? names.find((n) => `@${n.name}`.toLowerCase() === part.toLowerCase()) : null;
        if (!m) return <Fragment key={i}>{part}</Fragment>;
        return (
          <span key={i} className={`rounded px-0.5 font-medium ${m.isMe ? 'bg-amber-100 text-amber-900' : 'text-brand-700'}`}>
            {part}
          </span>
        );
      })}
    </>
  );
}
