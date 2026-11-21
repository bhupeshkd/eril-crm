import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Contact } from './contact.entity';

/** A members-only discussion space (GHL "Communities"). Members are contacts with a magic-link token. */
@Entity('communities')
@Index(['slug'], { unique: true })
@Index(['workspaceId'])
export class Community extends BaseEntity {
  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId: string;

  @Column({ length: 255 })
  name: string;

  /** Public join page: /join/<slug> (only when joinMode is open). */
  @Column({ length: 120 })
  slug: string;

  @Column({ type: 'text', default: '' })
  description: string;

  /** invite: staff add members. open: anyone can request access from the join page (link is emailed). */
  @Column({ name: 'join_mode', type: 'varchar', length: 10, default: 'invite' })
  joinMode: 'invite' | 'open';

  /** Contacts enrolling in these courses are added automatically. */
  @Column({ name: 'auto_join_course_ids', type: 'uuid', array: true, default: () => "'{}'" })
  autoJoinCourseIds: string[];

  /** Added to a contact when they join. */
  @Column({ type: 'text', array: true, default: () => "'{}'" })
  tags: string[];

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  /** Email digest of new posts: off | daily | weekly. Members can override. */
  @Column({ name: 'digest_frequency', type: 'varchar', length: 10, default: 'weekly' })
  digestFrequency: 'off' | 'daily' | 'weekly';

  /** Local hour (0–23, in `timezone`) to send digests. */
  @Column({ name: 'digest_hour', type: 'int', default: 9 })
  digestHour: number;

  /** Weekly digests: 0 = Sunday … 6 = Saturday. */
  @Column({ name: 'digest_weekday', type: 'int', default: 1 })
  digestWeekday: number;

  @Column({ length: 64, default: 'UTC' })
  timezone: string;
}

@Entity('community_channels')
@Index(['communityId', 'position'])
export class CommunityChannel extends BaseEntity {
  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId: string;

  @Column({ name: 'community_id', type: 'uuid' })
  communityId: string;

  @Column({ length: 80 })
  name: string;

  @Column({ type: 'varchar', length: 255, default: '' })
  description: string;

  @Column({ type: 'int', default: 0 })
  position: number;

  /** Only staff and moderators can start posts here (e.g. Announcements); everyone can comment. */
  @Column({ name: 'staff_only', default: false })
  staffOnly: boolean;
}

@Entity('community_members')
@Index(['communityId', 'contactId'], { unique: true })
@Index(['accessToken'], { unique: true })
export class CommunityMember extends BaseEntity {
  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId: string;

  @Column({ name: 'community_id', type: 'uuid' })
  communityId: string;

  @ManyToOne(() => Contact, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'contact_id' })
  contact: Contact;

  @Column({ name: 'contact_id', type: 'uuid' })
  contactId: string;

  /** Magic-link token for /community/<token>. Never shown to other members. */
  @Column({ name: 'access_token', length: 64, select: false })
  accessToken: string;

  /** Name other members see (defaults to the contact's first name + last initial). */
  @Column({ name: 'display_name', length: 80 })
  displayName: string;

  @Column({ type: 'varchar', length: 12, default: 'member' })
  role: 'member' | 'moderator';

  /** active | banned (link stops working) */
  @Column({ type: 'varchar', length: 10, default: 'active' })
  status: 'active' | 'banned';

  /** How they joined: staff | join_page | course */
  @Column({ type: 'varchar', length: 12, default: 'staff' })
  source: string;

  @Column({ name: 'last_seen_at', type: 'timestamptz', nullable: true })
  lastSeenAt: Date | null;

  /** community (use the community setting) | off | daily | weekly */
  @Column({ type: 'varchar', length: 10, default: 'community' })
  digest: 'community' | 'off' | 'daily' | 'weekly';

  @Column({ name: 'last_digest_at', type: 'timestamptz', nullable: true })
  lastDigestAt: Date | null;
  /** Email me when someone @mentions me. */
  @Column({ name: 'mention_emails', default: true })
  mentionEmails: boolean;
}

@Entity('community_posts')
@Index(['communityId', 'channelId', 'createdAt'])
export class CommunityPost extends BaseEntity {
  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId: string;

  @Column({ name: 'community_id', type: 'uuid' })
  communityId: string;

  @Column({ name: 'channel_id', type: 'uuid' })
  channelId: string;

  /** Author: a member, or a staff user posting as the business. */
  @Column({ name: 'member_id', type: 'uuid', nullable: true })
  memberId: string | null;

  @Column({ name: 'author_user_id', type: 'uuid', nullable: true })
  authorUserId: string | null;

  @Column({ type: 'text' })
  body: string;

  /** Members @mentioned in the body (name as written at the time). */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  mentions: Array<{ memberId: string; name: string }>;

  @Column({ default: false })
  pinned: boolean;

  /** Hidden by staff/moderators: invisible to members, kept for staff. */
  @Column({ default: false })
  hidden: boolean;

  @Column({ name: 'like_count', type: 'int', default: 0 })
  likeCount: number;

  @Column({ name: 'comment_count', type: 'int', default: 0 })
  commentCount: number;
}

@Entity('community_comments')
@Index(['postId', 'createdAt'])
export class CommunityComment extends BaseEntity {
  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId: string;

  @Column({ name: 'post_id', type: 'uuid' })
  postId: string;

  @Column({ name: 'member_id', type: 'uuid', nullable: true })
  memberId: string | null;

  @Column({ name: 'author_user_id', type: 'uuid', nullable: true })
  authorUserId: string | null;

  @Column({ type: 'text' })
  body: string;

  /** Members @mentioned in the body (name as written at the time). */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  mentions: Array<{ memberId: string; name: string }>;

  @Column({ default: false })
  hidden: boolean;
}

@Entity('community_likes')
@Index(['postId', 'memberId'], { unique: true, where: '"member_id" IS NOT NULL' })
@Index(['postId', 'userId'], { unique: true, where: '"user_id" IS NOT NULL' })
export class CommunityLike extends BaseEntity {
  @Column({ name: 'post_id', type: 'uuid' })
  postId: string;

  @Column({ name: 'member_id', type: 'uuid', nullable: true })
  memberId: string | null;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;
}

/** One row per @mention of a member: drives their Mentions inbox and mention emails. */
@Entity('community_mentions')
@Index(['memberId', 'createdAt'])
@Index(['byMemberId', 'createdAt'])
export class CommunityMention extends BaseEntity {
  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId: string;

  @Column({ name: 'community_id', type: 'uuid' })
  communityId: string;

  /** Who was mentioned. */
  @Column({ name: 'member_id', type: 'uuid' })
  memberId: string;

  @Column({ name: 'by_member_id', type: 'uuid', nullable: true })
  byMemberId: string | null;

  @Column({ name: 'by_user_id', type: 'uuid', nullable: true })
  byUserId: string | null;

  @Column({ name: 'post_id', type: 'uuid' })
  postId: string;

  @Column({ name: 'comment_id', type: 'uuid', nullable: true })
  commentId: string | null;

  @Column({ name: 'read_at', type: 'timestamptz', nullable: true })
  readAt: Date | null;

  @Column({ name: 'emailed_at', type: 'timestamptz', nullable: true })
  emailedAt: Date | null;
}

/** An image or file attached to a community post. Stored in the database (metadata stripped); served via signed links. */
@Entity('community_images')
@Index(['postId', 'position'])
@Index(['communityId', 'createdAt'])
export class CommunityImage extends BaseEntity {
  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId: string;

  @Column({ name: 'community_id', type: 'uuid' })
  communityId: string;

  /** Null until the upload is attached to a post (unattached uploads are cleaned up). */
  @Column({ name: 'post_id', type: 'uuid', nullable: true })
  postId: string | null;

  @Column({ name: 'uploader_member_id', type: 'uuid', nullable: true })
  uploaderMemberId: string | null;

  @Column({ name: 'uploader_user_id', type: 'uuid', nullable: true })
  uploaderUserId: string | null;

  @Column({ type: 'varchar', length: 100 })
  mime: string;

  @Column({ type: 'int' })
  size: number;

  /** image (shown in the post) | file (attachment, always downloaded). */
  @Column({ type: 'varchar', length: 5, default: 'image' })
  kind: 'image' | 'file';

  /** Download name for files (cleaned; ends in the real type's extension). */
  @Column({ type: 'varchar', length: 120, nullable: true })
  filename: string | null;

  @Column({ type: 'int', default: 0 })
  position: number;

  /** Where the bytes live: db (the `data` column) or s3 (`storageKey` in the bucket). */
  @Column({ type: 'varchar', length: 10, default: 'db' })
  storage: 'db' | 's3';

  @Column({ name: 'storage_key', type: 'varchar', length: 255, nullable: true })
  storageKey: string | null;

  /** Image bytes when stored in the database (null once moved to S3). */
  @Column({ type: 'bytea', nullable: true, select: false })
  data: Buffer | null;
}
