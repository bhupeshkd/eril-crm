import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/** A blog post on a site (/s/<site>/blog/<slug>). Body is Markdown. */
@Entity('blog_posts')
@Index(['siteId', 'slug'], { unique: true })
@Index(['siteId', 'status', 'publishedAt'])
export class BlogPost extends BaseEntity {
  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId: string;

  @Column({ name: 'site_id', type: 'uuid' })
  siteId: string;

  @Column({ length: 200 })
  title: string;

  @Column({ length: 100 })
  slug: string;

  /** Optional summary; generated from the body when empty. */
  @Column({ type: 'varchar', length: 300, default: '' })
  excerpt: string;

  @Column({ type: 'text', default: '' })
  body: string;

  @Column({ name: 'cover_image_url', type: 'varchar', length: 1000, default: '' })
  coverImageUrl: string;

  @Column({ name: 'author_name', type: 'varchar', length: 120, default: '' })
  authorName: string;

  @Column({ type: 'text', array: true, default: () => "'{}'" })
  tags: string[];

  /** draft | published (a future publishedAt means scheduled) */
  @Column({ type: 'varchar', length: 12, default: 'draft' })
  status: 'draft' | 'published';

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt: Date | null;

  @Column({ name: 'seo_title', type: 'varchar', length: 200, default: '' })
  seoTitle: string;

  @Column({ name: 'seo_description', type: 'varchar', length: 300, default: '' })
  seoDescription: string;

  @Column({ type: 'int', default: 0 })
  views: number;
}

/** A dynamic QR code: the printed code points at /public/qr/<code>, which redirects to `destination`. */
@Entity('qr_codes')
@Index(['code'], { unique: true })
@Index(['workspaceId', 'createdAt'])
export class QrCode extends BaseEntity {
  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId: string;

  @Column({ length: 120 })
  name: string;

  @Column({ length: 16 })
  code: string;

  @Column({ type: 'varchar', length: 2000 })
  destination: string;

  /** Append utm_source=qr etc. when redirecting. */
  @Column({ default: true })
  utm: boolean;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @Column({ type: 'varchar', length: 7, default: '#000000' })
  color: string;

  @Column({ name: 'ec_level', type: 'varchar', length: 1, default: 'M' })
  ecLevel: 'L' | 'M' | 'Q' | 'H';

  @Column({ type: 'int', default: 0 })
  scans: number;

  @Column({ name: 'last_scanned_at', type: 'timestamptz', nullable: true })
  lastScannedAt: Date | null;
}

@Entity('qr_scans')
@Index(['qrCodeId', 'createdAt'])
export class QrScan extends BaseEntity {
  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId: string;

  @Column({ name: 'qr_code_id', type: 'uuid' })
  qrCodeId: string;

  /** ios | android | desktop | other */
  @Column({ type: 'varchar', length: 10 })
  device: string;
}
