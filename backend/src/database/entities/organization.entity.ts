import { Column, Entity, OneToMany } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Workspace } from './workspace.entity';

export type PlanTier = 'free' | 'professional' | 'agency' | 'enterprise';

export interface Branding {
  /** Replaces "ERIL" in the app and in "Powered by …" footers. */
  appName: string;
  /** https URL of a square logo; empty = initial on a coloured tile. */
  logoUrl: string;
  /** Main brand colour (#rrggbb); the UI derives lighter and darker shades from it. */
  primaryColor: string;
  /** Hide the "Powered by …" footer on customer-facing pages. */
  hidePoweredBy: boolean;
}

export const DEFAULT_BRANDING: Branding = { appName: 'ERIL', logoUrl: '', primaryColor: '#5847d7', hidePoweredBy: false };

@Entity('organizations')
export class Organization extends BaseEntity {
  @Column()
  name: string;

  @Column({ default: 'free' })
  plan: PlanTier;

  /** White-label branding shown in the app and on customer-facing pages. */
  @Column({ type: 'jsonb', default: () => "'{}'" })
  branding: Partial<Branding>;

  @OneToMany(() => Workspace, (w) => w.organization)
  workspaces: Workspace[];
}
