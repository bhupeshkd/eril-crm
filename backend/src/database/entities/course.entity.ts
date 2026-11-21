import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Contact } from './contact.entity';

export interface Lesson {
  id: string;
  title: string;
  /** video = embedded YouTube/Vimeo + notes; text = written lesson */
  type: 'video' | 'text';
  videoUrl?: string;
  body?: string;
  durationMinutes?: number;
}

export interface CourseModule {
  id: string;
  title: string;
  lessons: Lesson[];
}

@Entity('courses')
@Index(['workspaceId'])
export class Course extends BaseEntity {
  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId: string;

  @Column({ length: 255 })
  title: string;

  @Column({ type: 'text', default: '' })
  description: string;

  @Column({ name: 'cover_image', type: 'varchar', length: 1000, default: '' })
  coverImage: string;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  modules: CourseModule[];

  @Column({ name: 'is_published', default: false })
  isPublished: boolean;
}

@Entity('enrollments')
@Index(['courseId', 'contactId'], { unique: true, where: '"deleted_at" IS NULL' })
@Index(['accessToken'], { unique: true })
export class Enrollment extends BaseEntity {
  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId: string;

  @ManyToOne(() => Course, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'course_id' })
  course: Course;

  @Column({ name: 'course_id', type: 'uuid' })
  courseId: string;

  @ManyToOne(() => Contact, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'contact_id' })
  contact: Contact;

  @Column({ name: 'contact_id', type: 'uuid' })
  contactId: string;

  /** Magic-link token for the member portal (/learn/<token>). */
  @Column({ name: 'access_token', length: 64 })
  accessToken: string;

  @Column({ name: 'completed_lesson_ids', type: 'text', array: true, default: () => "'{}'" })
  completedLessonIds: string[];

  @Column({ name: 'last_accessed_at', type: 'timestamptz', nullable: true })
  lastAccessedAt: Date | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt: Date | null;
}

/** Reusable bundle of a workspace's assets (agency "snapshot"). */
@Entity('snapshots')
@Index(['organizationId'])
export class Snapshot extends BaseEntity {
  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @Column({ length: 255 })
  name: string;

  @Column({ name: 'source_workspace_id', type: 'uuid', nullable: true })
  sourceWorkspaceId: string | null;

  @Column({ type: 'jsonb' })
  content: Record<string, any>;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  summary: Record<string, number>;
}
