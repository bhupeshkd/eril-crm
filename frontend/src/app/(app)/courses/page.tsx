'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { EmptyState, LiveBadge, PageHeader, PageLoader, errorText, useToast } from '@/components/ui';
import { Icon } from '@/components/icons';

interface CourseRow {
  id: string;
  title: string;
  description: string;
  coverImage: string;
  isPublished: boolean;
  lessonCount: number;
  enrolled: number;
  completed: number;
}

const COVERS = ['from-brand-500 to-brand-700', 'from-sky-500 to-indigo-600', 'from-emerald-500 to-teal-600', 'from-amber-500 to-rose-500'];

export default function CoursesPage() {
  const router = useRouter();
  const toast = useToast();
  const { can } = useAuth();
  const [courses, setCourses] = useState<CourseRow[] | null>(null);

  useEffect(() => {
    api<CourseRow[]>('/courses').then(setCourses).catch((e) => toast(errorText(e), 'error'));
  }, [toast]);

  async function create() {
    try {
      const c = await api<CourseRow>('/courses', { method: 'POST', body: { title: 'Untitled course' } });
      router.push(`/courses/${c.id}`);
    } catch (e) {
      toast(errorText(e), 'error');
    }
  }

  return (
    <>
      <PageHeader
        title="Courses"
        subtitle="Membership courses with video and text lessons, progress tracking and private member access"
        actions={can('courses:write') && <button className="btn-primary" onClick={create}><Icon name="plus" /> New course</button>}
      />
      {!courses ? <PageLoader /> : courses.length === 0 ? (
        <EmptyState title="No courses yet">Create a course, publish it, then enroll contacts manually or from a workflow (e.g. after an invoice is paid).</EmptyState>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {courses.map((c, i) => {
            const pct = c.enrolled ? Math.round((c.completed / c.enrolled) * 100) : 0;
            return (
              <Link key={c.id} href={`/courses/${c.id}`} className="card card-hover group flex flex-col overflow-hidden">
                <div className="relative h-36 overflow-hidden">
                  {c.coverImage ? (
                    <img src={c.coverImage} alt="" className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]" />
                  ) : (
                    <div className={`relative grid h-full place-items-center bg-gradient-to-br ${COVERS[i % COVERS.length]} text-white`} aria-hidden>
                      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.25),transparent_55%)]" />
                      <Icon name="courses" className="relative h-10 w-10 opacity-90" strokeWidth={1.5} />
                    </div>
                  )}
                  <div className="absolute right-3 top-3"><span className="rounded-md bg-white/95 shadow-sm"><LiveBadge on={c.isPublished} onLabel="Published" /></span></div>
                </div>
                <div className="flex flex-1 flex-col p-4">
                  <h2 className="font-semibold text-slate-900 group-hover:text-brand-700">{c.title}</h2>
                  {c.description && <p className="mt-1 line-clamp-2 text-[13px] text-slate-500">{c.description}</p>}
                  <div className="mt-auto pt-4">
                    <div className="flex items-center justify-between text-[12px] text-slate-500">
                      <span className="flex items-center gap-3">
                        <span className="flex items-center gap-1"><Icon name="play" className="h-3.5 w-3.5" />{c.lessonCount} lesson{c.lessonCount === 1 ? '' : 's'}</span>
                        <span className="flex items-center gap-1"><Icon name="users" className="h-3.5 w-3.5" />{c.enrolled} member{c.enrolled === 1 ? '' : 's'}</span>
                      </span>
                      <span className="tabular-nums">{pct}% completed</span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} /></div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
