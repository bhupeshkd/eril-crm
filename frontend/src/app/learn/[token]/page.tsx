'use client';

import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { errorText } from '@/components/ui';
import { Icon } from '@/components/icons';
import { PoweredBy, PublicLoading } from '@/components/public-shell';
import { usePublicBranding } from '@/lib/branding';

interface Lesson { id: string; title: string; type: 'video' | 'text'; videoUrl?: string; body?: string; durationMinutes?: number }
interface Portal {
  member: string;
  course: { title: string; description: string; coverImage: string; modules: Array<{ id: string; title: string; lessons: Lesson[] }> };
  completedLessonIds: string[];
  progress: { done: number; total: number; percent: number };
  completedAt: string | null;
}

function embedUrl(url?: string) {
  if (!url) return null;
  const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{6,})/);
  if (yt) return `https://www.youtube-nocookie.com/embed/${yt[1]}`;
  const vm = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vm) return `https://player.vimeo.com/video/${vm[1]}`;
  return null;
}

export default function MemberPortal() {
  const { token } = useParams<{ token: string }>();
  const brand = usePublicBranding('learn', token);
  const [data, setData] = useState<Portal | null>(null);
  const [error, setError] = useState('');
  const [current, setCurrent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    api<Portal>(`/public/learn/${token}`, { auth: false })
      .then((d) => {
        setData(d);
        const all = d.course.modules.flatMap((m) => m.lessons);
        setCurrent((all.find((l) => !d.completedLessonIds.includes(l.id)) ?? all[0])?.id ?? null);
      })
      .catch((e) => setError(errorText(e)));
  }, [token]);

  const lessons = useMemo(() => data?.course.modules.flatMap((m) => m.lessons) ?? [], [data]);
  if (!data) return <PublicLoading error={error} brand={{ kind: 'learn', key: token }} />;

  const idx = lessons.findIndex((l) => l.id === current);
  const lesson = lessons[idx];
  const done = lesson ? data.completedLessonIds.includes(lesson.id) : false;
  const video = lesson?.type === 'video' ? embedUrl(lesson.videoUrl) : null;

  async function toggle(complete: boolean, goNext: boolean) {
    if (!lesson) return;
    setBusy(true);
    try {
      const r = await api(`/public/learn/${token}/lessons/${lesson.id}`, { method: 'PUT', auth: false, body: { done: complete } });
      setData({ ...data!, ...r });
      if (goNext && idx < lessons.length - 1) {
        setCurrent(lessons[idx + 1].id);
        window.scrollTo({ top: 0 });
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#f6f7f9]">
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-slate-200/80 bg-white/90 px-4 py-3 backdrop-blur">
        <button className="btn-ghost h-9 w-9 px-0 lg:hidden" onClick={() => setMenu(!menu)} aria-expanded={menu} aria-label="Course outline"><Icon name={menu ? 'close' : 'menu'} className="h-5 w-5" /></button>
        <span className="hidden h-8 w-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 text-white sm:grid"><Icon name="courses" className="h-4 w-4" /></span>
        <h1 className="min-w-0 flex-1 truncate font-semibold tracking-tight">{data.course.title}</h1>
        <div className="hidden items-center gap-3 text-sm text-slate-600 sm:flex">
          <span className="text-xs text-slate-500">{data.progress.done} of {data.progress.total} lessons</span>
          <div className="h-2 w-32 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={data.progress.percent} aria-valuemin={0} aria-valuemax={100} aria-label="Course progress">
            <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-600 transition-all" style={{ width: `${data.progress.percent}%` }} />
          </div>
          <span className="w-9 text-right font-semibold tabular-nums text-slate-800">{data.progress.percent}%</span>
        </div>
      </header>
      <div className="flex flex-1">
        <nav className={`${menu ? 'block' : 'hidden'} w-full shrink-0 border-r border-slate-200/80 bg-white p-3 lg:sticky lg:top-[57px] lg:block lg:h-[calc(100vh-57px)] lg:w-80 lg:overflow-y-auto`} aria-label="Lessons">
          <div className="mb-4 rounded-xl bg-gradient-to-br from-brand-50 to-brand-100 px-3 py-3 ring-1 ring-inset ring-brand-100">
            <p className="text-sm font-medium text-slate-800">Welcome, {data.member}!</p>
            <p className="text-xs text-slate-500">{data.progress.percent === 100 ? 'You finished every lesson.' : 'Pick up where you left off.'}</p>
          </div>
          {data.course.modules.map((m, mi) => (
            <div key={m.id} className="mb-4">
              <h2 className="flex items-center gap-2 px-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                <span className="tabular-nums">{String(mi + 1).padStart(2, '0')}</span>{m.title}
              </h2>
              <ul className="mt-1.5 space-y-0.5">
                {m.lessons.map((l) => {
                  const ok = data.completedLessonIds.includes(l.id);
                  const on = l.id === current;
                  return (
                    <li key={l.id}>
                      <button onClick={() => { setCurrent(l.id); setMenu(false); }} aria-current={on} className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-[13px] transition ${on ? 'bg-brand-50 font-medium text-brand-700 ring-1 ring-inset ring-brand-200/70' : 'text-slate-700 hover:bg-slate-50'}`}>
                        <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full ${ok ? 'bg-emerald-500 text-white' : on ? 'border-2 border-brand-500' : 'border-[1.5px] border-slate-300'}`} aria-label={ok ? 'Completed' : 'Not completed'}>
                          {ok && <Icon name="check" className="h-3 w-3" strokeWidth={3} />}
                        </span>
                        <span className="flex-1">{l.title}</span>
                        <span className="flex items-center gap-1 text-[11px] text-slate-400">
                          {l.type === 'video' && <Icon name="play" className="h-3 w-3" />}
                          {l.durationMinutes ? `${l.durationMinutes}m` : null}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
        <main className={`${menu ? 'hidden' : 'block'} min-w-0 flex-1 p-4 sm:p-8 lg:block`}>
          {data.completedAt && (
            <p className="mx-auto mb-5 flex max-w-3xl items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-center text-sm font-medium text-emerald-800" role="status">
              <Icon name="courses" className="h-4 w-4" /> You've completed this course — congratulations!
            </p>
          )}
          {!lesson ? <p className="text-slate-500">This course has no lessons yet.</p> : (
            <article className="mx-auto max-w-3xl">
              <p className="text-xs font-medium uppercase tracking-wide text-brand-600">Lesson {idx + 1} of {lessons.length}</p>
              <h2 className="mt-1 text-[28px] font-semibold leading-tight tracking-tight">{lesson.title}</h2>
              {lesson.type === 'video' && (video ? (
                <div className="mt-5 aspect-video overflow-hidden rounded-2xl bg-black shadow-pop"><iframe src={video} title={lesson.title} className="h-full w-full" allow="fullscreen; picture-in-picture" allowFullScreen /></div>
              ) : (
                <div className="mt-5 grid aspect-video place-items-center rounded-2xl bg-slate-100 text-sm text-slate-500"><span className="flex items-center gap-2"><Icon name="play" className="h-5 w-5" /> Video coming soon</span></div>
              ))}
              {lesson.body && <div className="card mt-6 whitespace-pre-wrap p-6 text-[15px] leading-relaxed text-slate-700 sm:p-8">{lesson.body}</div>}
              <div className="mt-8 flex flex-wrap items-center gap-2 border-t border-slate-200 pt-5">
                {idx > 0 && <button className="btn-secondary" onClick={() => setCurrent(lessons[idx - 1].id)}><Icon name="arrowLeft" className="h-4 w-4" /> Previous</button>}
                <div className="ml-auto flex gap-2">
                  {done ? (
                    <button className="btn-secondary" disabled={busy} onClick={() => toggle(false, false)}>Mark as not done</button>
                  ) : (
                    <button className="btn-primary h-10 px-5" disabled={busy} onClick={() => toggle(true, true)}>
                      <Icon name="check" className="h-4 w-4" strokeWidth={2.5} />
                      {idx < lessons.length - 1 ? 'Complete & continue' : 'Complete course'}
                    </button>
                  )}
                  {done && idx < lessons.length - 1 && <button className="btn-primary" onClick={() => setCurrent(lessons[idx + 1].id)}>Next lesson <Icon name="chevronRight" className="h-4 w-4" /></button>}
                </div>
              </div>
              {error && <p role="alert" className="mt-3 text-sm text-rose-600">{error}</p>}
              <PoweredBy b={brand} />
            </article>
          )}
        </main>
      </div>
    </div>
  );
}
