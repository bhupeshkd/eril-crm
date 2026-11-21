import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/** A connected Facebook Page or Instagram professional account. */
@Entity('meta_pages')
@Index(['platform', 'pageId'], { unique: true, where: '"deleted_at" IS NULL' })
@Index(['workspaceId'])
export class MetaPage extends BaseEntity {
  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId: string;

  @Column({ type: 'varchar', length: 10 })
  platform: 'facebook' | 'instagram';

  /** Page id, or Instagram account id. */
  @Column({ name: 'page_id', length: 32 })
  pageId: string;

  @Column({ length: 120 })
  name: string;

  /** Page access token used to reply. Never returned by the API. */
  @Column({ name: 'access_token', type: 'text', select: false })
  accessToken: string;
}

/** A person who messaged a page (page-scoped id), linked to a contact. */
@Entity('meta_identities')
@Index(['platform', 'pageId', 'psid'], { unique: true })
@Index(['workspaceId', 'contactId'])
export class MetaIdentity extends BaseEntity {
  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId: string;

  @Column({ type: 'varchar', length: 10 })
  platform: 'facebook' | 'instagram';

  @Column({ name: 'page_id', length: 32 })
  pageId: string;

  /** Page-scoped sender id. */
  @Column({ length: 64 })
  psid: string;

  @Column({ name: 'contact_id', type: 'uuid' })
  contactId: string;

  @Column({ name: 'last_inbound_at', type: 'timestamptz', nullable: true })
  lastInboundAt: Date | null;
}
