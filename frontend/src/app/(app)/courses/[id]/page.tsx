'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { api, fmtDate } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Contact, Paged } from '@/lib/types';
import { EditorBar, EmptyState, LiveBadge, Modal, PageLoader, PanelTitle, Spinner, Tabs, TitleInput, errorText, useToast } from '@/components/ui';
import { Icon } from '@/components/icons';
import { ContactAvatar } from '@/components/contact-avatar';

interface Lesson { id?: string; title: string; type: 'video' | 'text'; videoUrl?: string; body?: string; durationMinutes?: number }
interface Mod { id?: string; title: string; lessons: Lesson[] }
interface Course { id: string; title: string; description: string; coverImage: string; isPublished: boolean; modules: Mod[] }
interface EnrollmentRow { id: string; contact: Contact; createdAt: string; lastAccessedAt: string | null; completedAt: string | null; progress: { done: number; total: number; percent: number } }

export default function CourseBuilderPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const { can } = useAuth();
  const [course, setCourse] = useState<Course | null>(null);
  const [tab, setTab] = useState<'content' | 'settings' | 'members'>('content');
  const [sel, setSel] = useState<[number, number] | null>([0, 0]);
  const [dirty, setDirty] = useState(false);
  const [members, setMembers] = useState<EnrollmentRow[] | null>(null);
  const [enrolling, setEnrolling] = useState(false);
  const editable = can('courses:write');

  const loadMembers = useCallback(() => api<EnrollmentRow[]>(`/courses/${id}/enrollments`).then(setMembers).catch(() => setMembers([])), [id]);
  useEffect(() => {
    api<Course>(`/courses/${id}`).then(setCourse).catch((e) => toast(errorText(e), 'error'));
  }, [id, toast]);
  useEffect(() => {
    if (tab === 'members') loadMembers();
  }, [tab, loadMembers]);

  if (!course) return <PageLoader />;
  const patch = (p: Partial<Course>) => {
    setCourse({ ...course, ...p });
    setDirty(true);
  };
  const setModules = (modules: Mod[]) => patch({ modules });
  const lesson = sel ? course.modules[sel[0]]?.lessons[sel[1]] : null;
  const setLesson = (p: Partial<Lesson>) =>
    sel && setModules(course.modules.map((m, i) => (i !== sel[0] ? m : { ...m, lessons: m.lessons.map((l, j) => (j === sel[1] ? { ...l, ...p } : l)) })));

  async function save(extra: Partial<Course> = {}) {
    try {
      const saved = await api<Course>(`/courses/${id}`, {
        method: 'PUT',
        body: { title: course!.title, description: course!.description, coverImage: course!.coverImage, modules: course!.modules, ...extra },
      });
      setCourse(saved);
      setDirty(false);
      toast('isPublished' in extra ? (extra.isPublished ? 'Course published' : 'Course unpublished') : 'Course saved');
    } catch (e) {
      toast(errorText(e), 'error');
    }
  }

  return (
    <>
      <EditorBar
        back={{ href: '/courses', label: 'Course' }}
        title={<TitleInput label="Course title" value={course.title} disabled={!editable} onChange={(title) => patch({ title })} />}
        status={<LiveBadge on={course.isPublished} onLabel="Published" />}
        dirty={dirty}
        actions={editable && (
          <>
            <button className="btn-secondary" onClick={() => save({ isPublished: !course.isPublished })}>{course.isPublished ? 'Unpublish' : 'Publish'}</button>
            <button className="btn-primary" disabled={!dirty} onClick={() => save()}>Save</button>
          </>
        )}
      />
      <Tabs
        value={tab}
        onChange={setTab}
        options={[['content', 'Content', course.modules.reduce((a, m) => a + m.lessons.length, 0)], ['settings', 'Settings'], ['members', 'Members', members?.length]]}
      />

      {tab === 'content' && (
        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          <section className="card self-start p-3" aria-label="Course outline">
            <PanelTitle>Outline</PanelTitle>
            <ol className="space-y-3">
              {course.modules.map((m, i) => (
                <li key={m.id ?? `m${i}`} className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-2">
                  <div className="group flex items-center gap-1">
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-white text-[11px] font-semibold text-slate-500 ring-1 ring-inset ring-slate-200">{i + 1}</span>
                    <input aria-label={`Module ${i + 1} title`} className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1.5 py-1 text-[13px] font-semibold text-slate-800 hover:border-slate-200 hover:bg-white focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-brand-500/15" value={m.title} disabled={!editable} onChange={(e) => setModules(course.modules.map((x, k) => (k === i ? { ...x, title: e.target.value } : x)))} />
                    {editable && (
                      <span className="flex opacity-0 transition group-focus-within:opacity-100 group-hover:opacity-100">
                        <button className="btn-ghost h-7 w-7 px-0" aria-label="Move module up" title="Move up" disabled={i === 0} onClick={() => { const n = [...course.modules]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; setModules(n); setSel(null); }}><Icon name="chevronDown" className="h-4 w-4 rotate-180" /></button>
                        <button className="btn-ghost h-7 w-7 px-0 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label="Delete module" title="Delete module" onClick={() => { if (confirm(`Delete module "${m.title}" and its lessons?`)) { setModules(course.modules.filter((_, k) => k !== i)); setSel(null); } }}><Icon name="trash" className="h-3.5 w-3.5" /></button>
                      </span>
                    )}
                  </div>
                  <ul className="mt-1.5 space-y-0.5">
                    {m.lessons.map((l, j) => {
                      const on = sel?.[0] === i && sel?.[1] === j;
                      return (
                        <li key={l.id ?? `l${j}`}>
                          <button onClick={() => setSel([i, j])} aria-pressed={on} className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] transition ${on ? 'bg-white font-medium text-brand-700 shadow-sm ring-1 ring-brand-200' : 'text-slate-700 hover:bg-white'}`}>
                            <Icon name={l.type === 'video' ? 'play' : 'file'} className={`h-4 w-4 shrink-0 ${on ? 'text-brand-600' : 'text-slate-400'}`} />
                            <span className="flex-1 truncate">{l.title}</span>
                            {l.durationMinutes ? <span className="text-[11px] tabular-nums text-slate-400">{l.durationMinutes}m</span> : null}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  {editable && (
                    <button className="btn-ghost mt-0.5 h-7 w-full justify-start px-2 text-xs text-brand-600 hover:bg-brand-50 hover:text-brand-700" onClick={() => { setModules(course.modules.map((x, k) => (k === i ? { ...x, lessons: [...x.lessons, { title: 'New lesson', type: 'text', body: '' }] } : x))); setSel([i, m.lessons.length]); }}><Icon name="plus" className="h-3.5 w-3.5" /> Add lesson</button>
                  )}
                </li>
              ))}
            </ol>
            {editable && <button className="btn-secondary mt-3 h-8 w-full text-[13px]" onClick={() => setModules([...course.modules, { title: `Module ${course.modules.length + 1}`, lessons: [] }])}><Icon name="plus" /> Add module</button>}
          </section>

          <section className="card p-5" aria-label="Lesson editor">
            {!lesson ? (
              <div className="flex flex-col items-center gap-2 py-16 text-center">
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-slate-100 text-slate-400"><Icon name="courses" className="h-5 w-5" /></span>
                <p className="text-sm text-slate-500">Select a lesson from the outline to edit it.</p>
              </div>
            ) : (
              <fieldset disabled={!editable} className="space-y-4">
                <div className="-mx-5 -mt-5 mb-1 flex items-center gap-3 border-b border-slate-100 px-5 py-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600"><Icon name={lesson.type === 'video' ? 'play' : 'file'} className="h-[18px] w-[18px]" /></span>
                  <div className="min-w-0">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{course.modules[sel![0]]?.title}</p>
                    <h2 className="truncate text-sm font-semibold">{lesson.title}</h2>
                  </div>
                </div>
                <div>
                  <label className="label" htmlFor="ls-title">Lesson title</label>
                  <input id="ls-title" className="input" value={lesson.title} onChange={(e) => setLesson({ title: e.target.value })} />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="label" htmlFor="ls-type">Type</label>
                    <select id="ls-type" className="input" value={lesson.type} onChange={(e) => setLesson({ type: e.target.value as Lesson['type'] })}>
                      <option value="text">Text lesson</option>
                      <option value="video">Video lesson</option>
                    </select>
                  </div>
                  <div>
                    <label className="label" htmlFor="ls-dur">Duration (minutes)</label>
                    <input id="ls-dur" type="number" min={0} max={600} className="input" value={lesson.durationMinutes ?? ''} onChange={(e) => setLesson({ durationMinutes: e.target.value === '' ? undefined : Number(e.target.value) })} />
                  </div>
                </div>
                {lesson.type === 'video' && (
                  <div>
                    <label className="label" htmlFor="ls-video">Video URL</label>
                    <input id="ls-video" className="input" placeholder="https://www.youtube.com/watch?v=… or https://vimeo.com/…" value={lesson.videoUrl ?? ''} onChange={(e) => setLesson({ videoUrl: e.target.value })} />
                  </div>
                )}
                <div>
                  <label className="label" htmlFor="ls-body">{lesson.type === 'video' ? 'Notes under the video' : 'Lesson content'}</label>
                  <textarea id="ls-body" rows={12} className="input" value={lesson.body ?? ''} onChange={(e) => setLesson({ body: e.target.value })} />
                </div>
                <button type="button" className="btn-danger" onClick={() => { setModules(course.modules.map((m, i) => (i === sel![0] ? { ...m, lessons: m.lessons.filter((_, j) => j !== sel![1]) } : m))); setSel(null); }}><Icon name="trash" /> Delete lesson</button>
              </fieldset>
            )}
          </section>
        </div>
      )}

      {tab === 'settings' && (
        <fieldset disabled={!editable} className="card max-w-2xl space-y-4 p-6">
          <div>
            <label className="label" htmlFor="cs-desc">Description</label>
            <textarea id="cs-desc" rows={4} className="input" value={course.description} onChange={(e) => patch({ description: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="cs-cover">Cover image URL</label>
            <input id="cs-cover" className="input" placeholder="https://…" value={course.coverImage} onChange={(e) => patch({ coverImage: e.target.value })} />
          </div>
          {course.coverImage && <img src={course.coverImage} alt="" className="h-36 w-full rounded-xl border border-slate-200 object-cover" />}
          {editable && <div className="border-t border-slate-100 pt-4"><button type="button" className="btn-danger" onClick={async () => { if (confirm('Delete this course? Members lose access.')) { await api(`/courses/${id}`, { method: 'DELETE' }); router.push('/courses'); } }}><Icon name="trash" /> Delete course</button></div>}
        </fieldset>
      )}

      {tab === 'members' && (
        <>
          {editable && (
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <button className="btn-primary" onClick={() => setEnrolling(true)} disabled={!course.isPublished}><Icon name="plus" /> Enroll contact</button>
              {!course.isPublished && <span className="flex items-center gap-1.5 text-sm text-amber-700"><Icon name="alert" className="h-4 w-4" />Publish the course to enroll members.</span>}
            </div>
          )}
          {!members ? <PageLoader /> : members.length === 0 ? <EmptyState title="No members yet">Enroll contacts here, or from a workflow step such as after an invoice is paid.</EmptyState> : (
            <div className="card overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200">
                  <tr><th className="px-4 py-2.5">Member</th><th className="px-4 py-2.5">Progress</th><th className="px-4 py-2.5">Enrolled</th><th className="px-4 py-2.5">Last active</th><th className="px-4 py-2.5"><span className="sr-only">Actions</span></th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {members.map((m) => (
                    <tr key={m.id} className="group hover:bg-slate-50/70">
                      <td className="px-4 py-3"><Link href={`/contacts/${m.contact.id}`} className="flex items-center gap-2.5 font-medium hover:text-brand-600"><ContactAvatar c={m.contact} size="h-7 w-7 text-[10px]" />{m.contact.firstName} {m.contact.lastName}</Link></td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-28 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={m.progress.percent} aria-valuemin={0} aria-valuemax={100} aria-label="Progress">
                            <div className={`h-full rounded-full ${m.completedAt ? 'bg-emerald-500' : 'bg-brand-500'}`} style={{ width: `${m.progress.percent}%` }} />
                          </div>
                          <span className="text-[13px] tabular-nums text-slate-600">{m.progress.done}/{m.progress.total}</span>
                          {m.completedAt && <span className="badge bg-emerald-50 text-emerald-700 ring-emerald-600/15"><Icon name="check" className="h-3 w-3" strokeWidth={2.5} />Completed</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-500">{fmtDate(m.createdAt)}</td>
                      <td className="px-4 py-3 text-slate-500">{m.lastAccessedAt ? fmtDate(m.lastAccessedAt) : <span className="text-slate-400">Not yet</span>}</td>
                      <td className="px-4 py-3 text-right">{editable && <button className="btn-ghost h-8 px-2.5 text-[13px] text-slate-500 opacity-0 hover:bg-rose-50 hover:text-rose-600 focus-visible:opacity-100 group-hover:opacity-100" onClick={async () => { if (confirm('Remove access for this member?')) { await api(`/courses/enrollments/${m.id}`, { method: 'DELETE' }); loadMembers(); } }}>Remove</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Modal open={enrolling} title="Enroll a contact" onClose={() => setEnrolling(false)}>
            {enrolling && <EnrollForm courseId={id} onDone={() => { setEnrolling(false); toast('Enrolled — access link sent'); loadMembers(); }} />}
          </Modal>
        </>
      )}
    </>
  );
}

function EnrollForm({ courseId, onDone }: { courseId: string; onDone: () => void }) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactId, setContactId] = useState('');
  const [notify, setNotify] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    api<Paged<Contact>>('/crm/contacts?limit=100').then((r) => setContacts(r.items)).catch(() => {});
  }, []);
  return (
    <form className="space-y-3" onSubmit={async (e) => {
      e.preventDefault();
      try {
        await api(`/courses/${courseId}/enrollments`, { method: 'POST', body: { contactId, notify } });
        onDone();
      } catch (err) { setError(errorText(err)); }
    }}>
      <div>
        <label className="label" htmlFor="en-c">Contact</label>
        <select id="en-c" required className="input" value={contactId} onChange={(e) => setContactId(e.target.value)}>
          <option value="">Choose…</option>
          {contacts.map((c) => <option key={c.id} value={c.id}>{c.firstName} {c.lastName}{c.email ? ` · ${c.email}` : ''}</option>)}
        </select>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Send them their private access link</label>
      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
      <div className="flex justify-end"><button className="btn-primary">Enroll</button></div>
    </form>
  );
}
