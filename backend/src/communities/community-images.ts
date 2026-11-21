import { BadGatewayException, BadRequestException, Controller, Get, Injectable, Logger, NotFoundException, OnModuleInit, Param, ParseUUIDPipe, Query, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { randomUUID } from 'crypto';
import { In, IsNull, LessThan, MoreThan, Repository } from 'typeorm';
import { CommunityImage, CommunityPost } from '../database/entities/community.entity';
import { Public } from '../common/decorators/public.decorator';
import { SkipTenant } from '../common/decorators/skip-tenant.decorator';
import { IMAGES_PER_POST, IMAGE_MAX_BYTES, detectImageType, linkExpiry, signImage, stripMetadata, verifyImage } from './images';
import { FILES_PER_POST, FILE_EXT, FILE_MAX_BYTES, attachmentDisposition, detectFileType, safeFilename } from './files';
import { deleteObject, getObject, presignGet, putObject, s3FromEnv, type S3Config } from '../storage/s3';

/** What multer hands us (memory storage). */
export interface UploadedImage {
  buffer: Buffer;
  size: number;
  /** Name from the uploader's computer (files only use it for the display name). */
  originalname?: string;
}

export type Uploader = { memberId: string; userId?: undefined } | { userId: string; memberId?: undefined };

/** Per uploader per day, to keep storage from being used as a free photo host. */
const DAILY_UPLOADS = 50;
const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' };

/** Object key for an image: <prefix><workspace>/<community>/<image id>.<ext> */
export function imageKey(prefix: string, workspaceId: string, communityId: string, id: string, mime: string) {
  return `${prefix}${workspaceId}/${communityId}/${id}.${EXT[mime] ?? FILE_EXT[mime as keyof typeof FILE_EXT] ?? 'bin'}`;
}

@Injectable()
export class CommunityImagesService implements OnModuleInit {
  private readonly logger = new Logger(CommunityImagesService.name);
  private s3: S3Config | null = null;

  constructor(
    @InjectRepository(CommunityImage) private readonly images: Repository<CommunityImage>,
    @InjectRepository(CommunityPost) private readonly posts: Repository<CommunityPost>,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    this.s3 = s3FromEnv((k) => this.config.get<string>(k));
    const mode = this.config.get<string>('IMAGE_STORAGE') || 'database';
    // Misconfiguration should stop the server, not silently fill the database with photos.
    if (mode === 's3' && !this.s3) throw new Error('IMAGE_STORAGE=s3 needs S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY');
    if (!['database', 's3'].includes(mode)) throw new Error(`IMAGE_STORAGE must be "database" or "s3" (got "${mode}")`);
    if (mode === 's3') this.logger.log(`Community images: S3 bucket "${this.s3!.bucket}"${this.s3!.endpoint ? ` at ${this.s3!.endpoint}` : ''}`);
  }

  /** New uploads go here; existing images are read from wherever they were saved. */
  private get writeTo(): 'db' | 's3' {
    return (this.config.get<string>('IMAGE_STORAGE') || 'database') === 's3' ? 's3' : 'db';
  }

  private get prefix() {
    return this.config.get<string>('S3_PREFIX') ?? 'community-images/';
  }

  private get secret() {
    return this.config.get<string>('JWT_ACCESS_SECRET') || 'eril-dev-secret';
  }

  private get apiBase() {
    const base = this.config.get<string>('API_PUBLIC_URL') || `http://localhost:${this.config.get('API_PORT') || 3001}`;
    const prefix = this.config.get<string>('API_GLOBAL_PREFIX') || 'api/v1';
    return `${base.replace(/\/$/, '')}/${prefix.replace(/^\/|\/$/g, '')}`;
  }

  /** A link valid for 1–2 hours; only handed to people who can see the post. */
  url(id: string) {
    const e = linkExpiry();
    return `${this.apiBase}/public/community-images/${id}?e=${e}&s=${signImage(this.secret, id, e)}`;
  }

  private by(u: Uploader) {
    return u.memberId ? { uploaderMemberId: u.memberId } : { uploaderUserId: u.userId };
  }

  private requireS3() {
    if (!this.s3) throw new BadGatewayException('Image storage (S3) is not configured');
    return this.s3;
  }

  async upload(workspaceId: string, communityId: string, u: Uploader, file?: UploadedImage) {
    if (!file?.buffer?.length) throw new BadRequestException('Choose an image to upload');
    if (file.size > IMAGE_MAX_BYTES) throw new BadRequestException('Images can be up to 5 MB');
    const mime = detectImageType(file.buffer);
    if (!mime) throw new BadRequestException('Only JPEG, PNG, GIF or WebP images can be uploaded');
    let data: Buffer;
    try {
      data = stripMetadata(file.buffer, mime);
    } catch {
      throw new BadRequestException('That image file looks damaged. Try saving it again.');
    }
    return this.store(workspaceId, communityId, u, data, mime, 'image', null);
  }

  /** PDFs, Office documents, zips and plain text, always served as downloads. */
  async uploadFile(workspaceId: string, communityId: string, u: Uploader, file?: UploadedImage) {
    if (!file?.buffer?.length) throw new BadRequestException('Choose a file to upload');
    if (file.size > FILE_MAX_BYTES) throw new BadRequestException('Files can be up to 10 MB');
    const name = Buffer.from(file.originalname ?? '', 'latin1').toString('utf8'); // multer gives latin1-decoded names
    const mime = detectFileType(file.buffer, name);
    if (!mime) throw new BadRequestException('Only PDF, Word, Excel, PowerPoint, ZIP, text, CSV or Markdown files can be attached');
    const filename = safeFilename(name, mime);
    const r = await this.store(workspaceId, communityId, u, file.buffer, mime, 'file', filename);
    return { ...r, name: filename, size: file.buffer.length, mime };
  }

  private async store(workspaceId: string, communityId: string, u: Uploader, data: Buffer, mime: string, kind: 'image' | 'file', filename: string | null) {
    const today = await this.images.count({ where: { ...this.by(u), createdAt: MoreThan(new Date(Date.now() - 86_400_000)) } });
    if (today >= DAILY_UPLOADS) throw new BadRequestException(`You can upload up to ${DAILY_UPLOADS} images and files a day`);
    await this.cleanupStale(communityId);

    const id = randomUUID();
    if (this.writeTo === 's3') {
      const s3 = this.requireS3();
      const key = imageKey(this.prefix, workspaceId, communityId, id, mime);
      try {
        await putObject(s3, key, data, mime);
      } catch (e) {
        this.logger.error(`S3 upload failed: ${(e as Error).message}`);
        throw new BadGatewayException('Could not store the image right now. Please try again.');
      }
      try {
        await this.images.insert({ id, workspaceId, communityId, ...this.by(u), mime, size: data.length, kind, filename, storage: 's3', storageKey: key, data: null, postId: null });
      } catch (e) {
        await deleteObject(s3, key).catch(() => undefined); // don't leave an orphan object behind
        throw e;
      }
    } else {
      await this.images.insert({ id, workspaceId, communityId, ...this.by(u), mime, size: data.length, kind, filename, storage: 'db', data, postId: null });
    }
    return { id, url: this.url(id) };
  }

  /** Uploads never attached to a post are removed (with their S3 objects) after a day. */
  private async cleanupStale(communityId: string) {
    const stale = await this.images.find({
      where: { communityId, postId: IsNull(), createdAt: LessThan(new Date(Date.now() - 86_400_000)) },
      select: { id: true, storage: true, storageKey: true },
      take: 100,
    });
    if (!stale.length) return;
    for (const s of stale) {
      if (s.storage === 's3' && s.storageKey && this.s3) await deleteObject(this.s3, s.storageKey).catch((e) => this.logger.warn(`S3 cleanup failed: ${e.message}`));
    }
    await this.images.delete({ id: In(stale.map((s) => s.id)) });
  }

  /** Which of `ids` this uploader may attach (their own, unattached, same community). */
  async attachable(communityId: string, u: Uploader, ids: string[], kind: 'image' | 'file' = 'image') {
    if (!ids.length) return [];
    const max = kind === 'image' ? IMAGES_PER_POST : FILES_PER_POST;
    const rows = await this.images.find({ where: { id: In(ids.slice(0, max)), communityId, postId: IsNull(), kind, ...this.by(u) }, select: { id: true } });
    return ids.filter((id) => rows.some((r) => r.id === id)).slice(0, max);
  }

  async attach(postId: string, ids: string[]) {
    for (const [position, id] of ids.entries()) {
      // postId IS NULL in the WHERE makes each image attach to one post only, even under races.
      await this.images.createQueryBuilder().update(CommunityImage).set({ postId, position }).where('id = :id AND post_id IS NULL', { id }).execute();
    }
  }

  /** Signed links for each post's images, in order. */
  async forPosts(postIds: string[]) {
    const map = new Map<string, Array<{ id: string; url: string }>>();
    if (!postIds.length) return map;
    const rows = await this.images.find({ where: { postId: In(postIds), kind: 'image' }, select: { id: true, postId: true, position: true }, order: { position: 'ASC' } });
    for (const r of rows) map.set(r.postId!, [...(map.get(r.postId!) ?? []), { id: r.id, url: this.url(r.id) }]);
    return map;
  }

  /** Signed download links for each post's files, in order. */
  async filesForPosts(postIds: string[]) {
    const map = new Map<string, Array<{ id: string; name: string; size: number; mime: string; url: string }>>();
    if (!postIds.length) return map;
    const rows = await this.images.find({ where: { postId: In(postIds), kind: 'file' }, select: { id: true, postId: true, position: true, filename: true, size: true, mime: true }, order: { position: 'ASC' } });
    for (const r of rows) map.set(r.postId!, [...(map.get(r.postId!) ?? []), { id: r.id, name: r.filename ?? 'file', size: r.size, mime: r.mime, url: this.url(r.id) }]);
    return map;
  }

  /**
   * Checks our signed link, then returns either the bytes (database / proxy mode) or a short-lived
   * S3 link to redirect to. The S3 link is signed on a 15-minute grid so browsers can cache it.
   */
  async serve(id: string, e: string, s: string) {
    if (!verifyImage(this.secret, id, Number(e), s)) throw new NotFoundException('Image not found');
    const img = await this.images.createQueryBuilder('i').addSelect('i.data').where('i.id = :id', { id }).getOne();
    if (!img) throw new NotFoundException('Image not found');
    // Deleted posts take their images with them.
    if (img.postId && !(await this.posts.exist({ where: { id: img.postId } }))) throw new NotFoundException('Image not found');
    const maxAge = Math.max(0, Math.floor((Number(e) - Date.now()) / 1000));
    if (img.storage !== 's3') {
      if (!img.data) throw new NotFoundException('Image not found');
      return { kind: 'bytes' as const, mime: img.mime, data: img.data, maxAge, download: img.kind === 'file' ? img.filename ?? 'file' : null };
    }
    const s3 = this.requireS3();
    if ((this.config.get<string>('S3_SERVE') || 'redirect') === 'proxy') {
      const data = await getObject(s3, img.storageKey!).catch((err) => {
        this.logger.error(`S3 read failed: ${err.message}`);
        throw new BadGatewayException('Image temporarily unavailable');
      });
      if (!data) throw new NotFoundException('Image not found');
      return { kind: 'bytes' as const, mime: img.mime, data, maxAge, download: img.kind === 'file' ? img.filename ?? 'file' : null };
    }
    const QUARTER = 15 * 60_000;
    const signedAt = new Date(Math.floor(Date.now() / QUARTER) * QUARTER);
    const expires = Math.max(60, Math.floor((Number(e) - signedAt.getTime()) / 1000));
    const url = presignGet(s3, img.storageKey!, expires, {
      'response-content-type': img.mime,
      'response-content-disposition': img.kind === 'file' ? attachmentDisposition(img.filename ?? 'file') : 'inline',
      'response-cache-control': `private, max-age=${maxAge}`,
    }, signedAt);
    return { kind: 'redirect' as const, url, maxAge };
  }

  /** One-off move of database-stored images into S3 (used by the move-images-to-s3 script). */
  async moveToS3(batch = 50, workspaceId?: string) {
    const s3 = this.requireS3();
    const qb = this.images.createQueryBuilder('i').addSelect('i.data').where("i.storage = 'db' AND i.data IS NOT NULL");
    if (workspaceId) qb.andWhere('i.workspace_id = :ws', { ws: workspaceId });
    const rows = await qb.orderBy('i.created_at', 'ASC').take(batch).getMany();
    let moved = 0;
    for (const r of rows) {
      const key = imageKey(this.prefix, r.workspaceId, r.communityId, r.id, r.mime);
      await putObject(s3, key, r.data!, r.mime);
      // Only switch over if nobody changed the row meanwhile.
      const res = await this.images.createQueryBuilder().update(CommunityImage).set({ storage: 's3', storageKey: key, data: null }).where("id = :id AND storage = 'db'", { id: r.id }).execute();
      if (res.affected) moved++;
    }
    return { moved, remaining: await this.images.count({ where: { storage: 'db', ...(workspaceId ? { workspaceId } : {}) } }) };
  }
}

@Controller('public/community-images')
@Public()
@SkipTenant()
@SkipThrottle()
export class CommunityImagePublicController {
  constructor(private readonly svc: CommunityImagesService) {}

  @Get(':id')
  async get(@Param('id', ParseUUIDPipe) id: string, @Query('e') e: string, @Query('s') s: string, @Res() res: Response) {
    const r = await this.svc.serve(id, e, s);
    if (r.kind === 'redirect') {
      res.set({ 'Cache-Control': `private, max-age=${Math.min(r.maxAge, 900)}`, 'Referrer-Policy': 'no-referrer' });
      return res.redirect(302, r.url);
    }
    res.set({
      'Content-Type': r.mime,
      'Content-Length': String(r.data.length),
      // Only ever rendered as an image; never sniffed or run as a document.
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      // Files are always downloaded, never opened in the browser.
      'Content-Disposition': r.download ? attachmentDisposition(r.download) : 'inline',
      'Cache-Control': `private, max-age=${r.maxAge}`,
      'Cross-Origin-Resource-Policy': 'cross-origin',
    });
    res.end(r.data);
  }
}
