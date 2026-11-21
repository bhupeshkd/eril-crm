import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { CourseModule } from '../database/entities/course.entity';

const id = () => randomUUID().slice(0, 8);
const VIDEO_RE = /^https:\/\/(www\.)?(youtube\.com|youtu\.be|vimeo\.com|player\.vimeo\.com)\//i;

/** Validates the module/lesson tree; keeps ids stable so member progress survives edits. */
export function sanitizeModules(modules: any[]): CourseModule[] {
  if (!Array.isArray(modules)) throw new BadRequestException('modules must be an array');
  if (modules.length > 50) throw new BadRequestException('At most 50 modules');
  const seen = new Set<string>();
  const uniq = (raw: any) => {
    let v = typeof raw === 'string' && /^[\w-]{1,40}$/.test(raw) ? raw : id();
    while (seen.has(v)) v = id();
    seen.add(v);
    return v;
  };
  let lessons = 0;
  return modules.map((m, i) => {
    if (!m || typeof m !== 'object') throw new BadRequestException(`Module ${i + 1} is invalid`);
    const list = Array.isArray(m.lessons) ? m.lessons : [];
    return {
      id: uniq(m.id),
      title: String(m.title || `Module ${i + 1}`).slice(0, 200),
      lessons: list.map((l: any, j: number) => {
        if (++lessons > 500) throw new BadRequestException('At most 500 lessons');
        const type = l?.type === 'video' ? 'video' : 'text';
        const videoUrl = l?.videoUrl ? String(l.videoUrl).trim() : '';
        if (type === 'video' && videoUrl && !VIDEO_RE.test(videoUrl)) {
          throw new BadRequestException(`Module ${i + 1}, lesson ${j + 1}: video must be a YouTube or Vimeo https link`);
        }
        return {
          id: uniq(l?.id),
          title: String(l?.title || `Lesson ${j + 1}`).slice(0, 200),
          type,
          videoUrl: type === 'video' ? videoUrl : undefined,
          body: l?.body ? String(l.body).slice(0, 50_000) : '',
          durationMinutes: Number.isFinite(Number(l?.durationMinutes)) ? Math.max(0, Math.min(600, Math.round(Number(l.durationMinutes)))) : undefined,
        };
      }),
    };
  });
}
