import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerGuard } from '@nestjs/throttler';
import { IsArray, IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { IsNull, Repository } from 'typeorm';
import { Course, CourseModule, Enrollment } from '../database/entities/course.entity';
import { Contact } from '../database/entities/contact.entity';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Tenant } from '../common/decorators/tenant.decorator';
import { Public } from '../common/decorators/public.decorator';
import { SkipTenant } from '../common/decorators/skip-tenant.decorator';
import { publicToken } from '../common/slug';
import { EventsService } from '../events/events.service';
import { ActivityService } from '../events/activity.service';
import { CommunicationModule } from '../communication/communication.module';
import { InboxService } from '../communication/inbox.service';
import { sanitizeModules } from './sanitize';

class CourseFieldsDto {
  @IsOptional() @IsString() @MaxLength(5000) description?: string;
  @IsOptional() @IsString() @MaxLength(1000) coverImage?: string;
  @IsOptional() @IsArray() modules?: CourseModule[];
  @IsOptional() @IsBoolean() isPublished?: boolean;
}
export class CreateCourseDto extends CourseFieldsDto {
  @IsString() @IsNotEmpty() @MaxLength(255) title: string;
}
export class UpdateCourseDto extends CourseFieldsDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(255) title?: string;
}
export class EnrollDto {
  @IsUUID() contactId: string;
  @IsOptional() @IsBoolean() notify?: boolean;
  @IsOptional() @IsIn(['email', 'sms']) channel?: 'email' | 'sms';
}

const lessonIds = (c: Course) => c.modules.flatMap((m) => m.lessons.map((l) => l.id));

export function progressOf(course: Course, completed: string[]) {
  const all = lessonIds(course);
  const done = completed.filter((id) => all.includes(id)).length;
  return { done, total: all.length, percent: all.length ? Math.round((done / all.length) * 100) : 0 };
}

@Injectable()
export class CoursesService {
  constructor(
    @InjectRepository(Course) private readonly courses: Repository<Course>,
    @InjectRepository(Enrollment) private readonly enrollments: Repository<Enrollment>,
    @InjectRepository(Contact) private readonly contacts: Repository<Contact>,
    private readonly inbox: InboxService,
    private readonly events: EventsService,
    private readonly activity: ActivityService,
    private readonly config: ConfigService,
  ) {}

  portalUrl(token: string) {
    return `${this.config.get('APP_URL') || 'http://localhost:3000'}/learn/${token}`;
  }

  async list(workspaceId: string) {
    const list = await this.courses.find({ where: { workspaceId }, order: { updatedAt: 'DESC' } });
    const counts = await this.enrollments
      .createQueryBuilder('e')
      .select('e.course_id', 'courseId')
      .addSelect('COUNT(*)', 'enrolled')
      .addSelect('COUNT(e.completed_at)', 'completed')
      .where('e.workspace_id = :workspaceId AND e.revoked_at IS NULL', { workspaceId })
      .groupBy('e.course_id')
      .getRawMany();
    return list.map((c) => {
      const row = counts.find((r) => r.courseId === c.id);
      return {
        ...c,
        lessonCount: lessonIds(c).length,
        enrolled: Number(row?.enrolled ?? 0),
        completed: Number(row?.completed ?? 0),
      };
    });
  }

  async get(workspaceId: string, id: string) {
    const c = await this.courses.findOne({ where: { id, workspaceId } });
    if (!c) throw new NotFoundException('Course not found');
    return c;
  }

  create(workspaceId: string, dto: CreateCourseDto) {
    return this.courses.save(
      this.courses.create({
        workspaceId,
        title: dto.title,
        description: dto.description ?? '',
        coverImage: dto.coverImage ?? '',
        modules: sanitizeModules(
          dto.modules ?? [{ title: 'Getting started', lessons: [{ title: 'Welcome', type: 'text', body: 'Welcome to the course!' }] } as any],
        ),
        isPublished: dto.isPublished ?? false,
      }),
    );
  }

  async update(workspaceId: string, id: string, dto: UpdateCourseDto) {
    const c = await this.get(workspaceId, id);
    if (dto.title !== undefined) c.title = dto.title;
    if (dto.description !== undefined) c.description = dto.description;
    if (dto.coverImage !== undefined) {
      if (dto.coverImage && !/^https?:\/\//.test(dto.coverImage)) throw new BadRequestException('Cover image must be an http(s) URL');
      c.coverImage = dto.coverImage;
    }
    if (dto.modules !== undefined) c.modules = sanitizeModules(dto.modules);
    if (dto.isPublished !== undefined) c.isPublished = dto.isPublished;
    return this.courses.save(c);
  }

  async remove(workspaceId: string, id: string) {
    const c = await this.get(workspaceId, id);
    await this.courses.softRemove(c);
    return { id };
  }

  async listEnrollments(workspaceId: string, courseId: string) {
    const course = await this.get(workspaceId, courseId);
    const rows = await this.enrollments.find({
      where: { workspaceId, courseId, revokedAt: IsNull() },
      relations: { contact: true },
      order: { createdAt: 'DESC' },
    });
    return rows.map((e) => ({ ...e, accessToken: undefined, progress: progressOf(course, e.completedLessonIds) }));
  }

  /** Enroll (idempotent). Optionally emails/texts the portal link. */
  async enroll(workspaceId: string, courseId: string, dto: EnrollDto, userId?: string | null) {
    const course = await this.get(workspaceId, courseId);
    if (!course.isPublished) throw new BadRequestException('Publish the course before enrolling members');
    const contact = await this.contacts.findOne({ where: { id: dto.contactId, workspaceId } });
    if (!contact) throw new NotFoundException('Contact not found');

    let enrollment = await this.enrollments.findOne({ where: { courseId, contactId: contact.id } });
    const created = !enrollment;
    if (!enrollment) {
      enrollment = await this.enrollments.save(
        this.enrollments.create({ workspaceId, courseId, contactId: contact.id, accessToken: publicToken() }),
      );
    } else if (enrollment.revokedAt) {
      enrollment.revokedAt = null;
      await this.enrollments.save(enrollment);
    }
    const link = this.portalUrl(enrollment.accessToken);

    if (dto.notify !== false && !contact.dnd) {
      const channel = dto.channel ?? (contact.email ? 'email' : 'sms');
      if ((channel === 'email' && contact.email) || (channel === 'sms' && contact.phone)) {
        await this.inbox.send(
          workspaceId,
          channel === 'email'
            ? { contactId: contact.id, channel, subject: `Your access to "${course.title}"`, body: `Hi ${contact.firstName},\n\nYou're enrolled in "${course.title}". Start learning here (keep this link private — it's your personal access):\n\n${link}` }
            : { contactId: contact.id, channel, body: `Hi ${contact.firstName}, you're enrolled in "${course.title}". Start here: ${link}` },
          userId,
        );
      }
    }
    if (created) {
      await this.activity.record(workspaceId, 'course.enrolled', `${contact.firstName} ${contact.lastName} enrolled in "${course.title}"`.trim(), {
        entityType: 'contact',
        entityId: contact.id,
        userId,
      });
      this.events.emit({ type: 'course.enrolled', workspaceId, userId, contactId: contact.id, payload: { course: { id: course.id, title: course.title }, contact: { firstName: contact.firstName, lastName: contact.lastName } } });
    }
    return { id: enrollment.id, link, created };
  }

  async revoke(workspaceId: string, enrollmentId: string) {
    const res = await this.enrollments.update({ id: enrollmentId, workspaceId }, { revokedAt: new Date() });
    if (!res.affected) throw new NotFoundException('Enrollment not found');
    return { id: enrollmentId };
  }

  // ---- Member portal (magic link) ----
  private async byToken(token: string) {
    const e = await this.enrollments.findOne({ where: { accessToken: token, revokedAt: IsNull() }, relations: { course: true, contact: true } });
    if (!e || !e.course || e.course.deletedAt || !e.course.isPublished) throw new NotFoundException('This course link is not valid or access was removed');
    return e;
  }

  async portal(token: string) {
    const e = await this.byToken(token);
    if (!e.lastAccessedAt || Date.now() - e.lastAccessedAt.getTime() > 60_000) {
      await this.enrollments.update({ id: e.id }, { lastAccessedAt: new Date() });
    }
    const c = e.course;
    return {
      member: e.contact.firstName,
      course: { title: c.title, description: c.description, coverImage: c.coverImage, modules: c.modules },
      completedLessonIds: e.completedLessonIds,
      progress: progressOf(c, e.completedLessonIds),
      completedAt: e.completedAt,
    };
  }

  async setLesson(token: string, lessonId: string, done: boolean) {
    const e = await this.byToken(token);
    if (!lessonIds(e.course).includes(lessonId)) throw new NotFoundException('Lesson not found');
    const set = new Set(e.completedLessonIds);
    if (done) set.add(lessonId);
    else set.delete(lessonId);
    e.completedLessonIds = [...set];
    const progress = progressOf(e.course, e.completedLessonIds);
    const justCompleted = progress.percent === 100 && !e.completedAt;
    if (justCompleted) e.completedAt = new Date();
    if (progress.percent < 100) e.completedAt = null;
    const { course, contact, ...row } = e;
    await this.enrollments.save(row);
    if (justCompleted) {
      await this.activity.record(e.workspaceId, 'course.completed', `${contact.firstName} completed "${course.title}"`, { entityType: 'contact', entityId: contact.id });
      this.events.emit({ type: 'course.completed', workspaceId: e.workspaceId, contactId: contact.id, payload: { course: { id: course.id, title: course.title }, contact: { firstName: contact.firstName, lastName: contact.lastName } } });
    }
    return { completedLessonIds: e.completedLessonIds, progress, completedAt: e.completedAt };
  }
}

@Controller('courses')
export class CoursesController {
  constructor(private readonly svc: CoursesService) {}

  @Get()
  @Permissions('courses:read')
  list(@Tenant('workspaceId') ws: string) {
    return this.svc.list(ws);
  }

  @Post()
  @Permissions('courses:write')
  create(@Tenant('workspaceId') ws: string, @Body() dto: CreateCourseDto) {
    return this.svc.create(ws, dto);
  }

  @Get(':id')
  @Permissions('courses:read')
  get(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(ws, id);
  }

  @Put(':id')
  @Permissions('courses:write')
  update(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCourseDto) {
    return this.svc.update(ws, id, dto);
  }

  @Delete(':id')
  @Permissions('courses:write')
  remove(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.remove(ws, id);
  }

  @Get(':id/enrollments')
  @Permissions('courses:read')
  enrollments(@Tenant('workspaceId') ws: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.listEnrollments(ws, id);
  }

  @Post(':id/enrollments')
  @Permissions('courses:write')
  enroll(@Tenant('workspaceId') ws: string, @CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: EnrollDto) {
    return this.svc.enroll(ws, id, dto, userId);
  }

  @Delete('enrollments/:enrollmentId')
  @Permissions('courses:write')
  revoke(@Tenant('workspaceId') ws: string, @Param('enrollmentId', ParseUUIDPipe) id: string) {
    return this.svc.revoke(ws, id);
  }
}

@Controller('public/learn')
@Public()
@SkipTenant()
@UseGuards(ThrottlerGuard)
export class PortalController {
  constructor(private readonly svc: CoursesService) {}

  @Get(':token')
  portal(@Param('token') token: string) {
    return this.svc.portal(token);
  }

  @Put(':token/lessons/:lessonId')
  setLesson(@Param('token') token: string, @Param('lessonId') lessonId: string, @Body('done') done: boolean) {
    return this.svc.setLesson(token, String(lessonId).slice(0, 40), done !== false);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([Course, Enrollment, Contact]), CommunicationModule],
  controllers: [CoursesController, PortalController],
  providers: [CoursesService],
  exports: [CoursesService],
})
export class CoursesModule {}
