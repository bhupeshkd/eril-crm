import { ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { SaasAccessService } from '../saas/access';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, ILike, In, Repository } from 'typeorm';
import { Contact } from '../database/entities/contact.entity';
import { Company } from '../database/entities/company.entity';
import { SmartList } from '../database/entities/crm-extras.entity';
import { applyContactFilters, cleanFilters } from './contact-filters';
import { EventsService } from '../events/events.service';
import { ActivityService } from '../events/activity.service';
import { BulkContactsDto, ContactQueryDto, CreateContactDto, ImportContactsDto, UpdateContactDto } from './dto';

/** All queries are scoped by workspaceId (tenant isolation, NFR-03). */
@Injectable()
export class ContactsService {
  constructor(
    @InjectRepository(Contact) private readonly contacts: Repository<Contact>,
    @InjectRepository(Company) private readonly companies: Repository<Company>,
    @InjectRepository(SmartList) private readonly smartLists: Repository<SmartList>,
    private readonly events: EventsService,
    private readonly activity: ActivityService,
    /** SaaS plan limits (absent in contexts that don't load the SaaS module). */
    @Optional() private readonly saas?: SaasAccessService,
  ) {}

  async list(workspaceId: string, q: ContactQueryDto) {
    const page = q.page ?? 1;
    const limit = q.limit ?? 20;
    const qb = this.contacts
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.company', 'co')
      .where('c.workspace_id = :workspaceId', { workspaceId });

    // A saved list's filters apply first; ad-hoc filters from the query narrow it further.
    if (q.listId) {
      const list = await this.smartLists.findOne({ where: { id: q.listId, workspaceId } });
      if (!list) throw new NotFoundException('List not found');
      applyContactFilters(qb, cleanFilters(list.filters));
    }
    applyContactFilters(qb, cleanFilters({
      search: q.search,
      statuses: q.status ? [q.status] : [],
      tags: q.tag ? [q.tag] : [],
      source: q.source,
      createdWithinDays: q.createdWithinDays,
    }));
    if (q.companyId) qb.andWhere('c.company_id = :companyId', { companyId: q.companyId });

    const [items, total] = await qb
      .orderBy('c.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return { items, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) };
  }

  async get(workspaceId: string, id: string) {
    const contact = await this.contacts.findOne({
      where: { id, workspaceId },
      relations: { company: true },
    });
    if (!contact) throw new NotFoundException('Contact not found');
    return contact;
  }

  async create(workspaceId: string, dto: CreateContactDto, userId?: string) {
    await this.saas?.assertCapacity(workspaceId, 'contacts');
    await this.assertEmailFree(workspaceId, dto.email);
    const companyId = await this.resolveCompany(workspaceId, dto);
    const contact = await this.contacts.save(
      this.contacts.create({
        workspaceId,
        firstName: dto.firstName.trim(),
        lastName: dto.lastName?.trim() ?? '',
        email: dto.email?.toLowerCase() ?? null,
        phone: dto.phone ?? null,
        status: dto.status ?? 'lead',
        tags: normalizeTags(dto.tags),
        notes: dto.notes ?? null,
        companyId,
        ownerId: userId ?? null,
        customFields: dto.customFields ?? {},
        source: dto.source ?? 'manual',
        dnd: dto.dnd ?? false,
      }),
    );
    await this.activity.record(workspaceId, 'contact.created', `Contact ${fullName(contact)} created`, {
      entityType: 'contact',
      entityId: contact.id,
      userId,
    });
    this.events.emit({
      type: 'contact.created',
      workspaceId,
      userId,
      contactId: contact.id,
      payload: { contact },
    });
    return this.get(workspaceId, contact.id);
  }

  async update(workspaceId: string, id: string, dto: UpdateContactDto, userId?: string) {
    const contact = await this.get(workspaceId, id);
    const before = { ...contact, tags: [...contact.tags] };

    if (dto.email !== undefined && dto.email?.toLowerCase() !== contact.email) {
      await this.assertEmailFree(workspaceId, dto.email, id);
      contact.email = dto.email?.toLowerCase() ?? null;
    }
    if (dto.firstName !== undefined) contact.firstName = dto.firstName.trim();
    if (dto.lastName !== undefined) contact.lastName = dto.lastName.trim();
    if (dto.phone !== undefined) contact.phone = dto.phone;
    if (dto.status !== undefined) contact.status = dto.status;
    if (dto.tags !== undefined) contact.tags = normalizeTags(dto.tags);
    if (dto.notes !== undefined) contact.notes = dto.notes;
    if (dto.customFields !== undefined) contact.customFields = { ...contact.customFields, ...dto.customFields };
    if (dto.dnd !== undefined) contact.dnd = dto.dnd;
    if (dto.companyId !== undefined || dto.companyName !== undefined) {
      contact.companyId = await this.resolveCompany(workspaceId, dto);
    }
    contact.company = undefined;
    await this.contacts.save(contact);
    await this.afterUpdate(workspaceId, before, contact, userId);
    return this.get(workspaceId, id);
  }

  /** Used by the automation engine; emits the same events as a user edit. */
  async applyChanges(
    workspaceId: string,
    id: string,
    changes: Partial<Pick<Contact, 'status' | 'tags' | 'firstName' | 'lastName' | 'phone' | 'notes'>>,
    meta: Record<string, any> = {},
  ) {
    const contact = await this.get(workspaceId, id);
    const before = { ...contact, tags: [...contact.tags] };
    Object.assign(contact, changes);
    if (changes.tags) contact.tags = normalizeTags(changes.tags);
    contact.company = undefined;
    await this.contacts.save(contact);
    await this.afterUpdate(workspaceId, before, contact, null, meta);
    return contact;
  }

  /**
   * Find a contact by email (or phone) and merge in new data, or create one.
   * Used by public forms, booking pages, imports and workflow webhooks.
   */
  async upsert(
    workspaceId: string,
    data: {
      firstName?: string;
      lastName?: string;
      email?: string | null;
      phone?: string | null;
      companyName?: string;
      tags?: string[];
      customFields?: Record<string, any>;
      source?: string;
    },
    userId?: string | null,
  ): Promise<{ contact: Contact; created: boolean }> {
    const email = data.email?.trim().toLowerCase() || null;
    const phone = data.phone?.trim() || null;
    let existing: Contact | null = null;
    if (email) existing = await this.contacts.findOne({ where: { workspaceId, email: ILike(email) } });
    if (!existing && phone) existing = await this.contacts.findOne({ where: { workspaceId, phone } });

    if (!existing) {
      const contact = await this.create(
        workspaceId,
        {
          firstName: data.firstName?.trim() || email?.split('@')[0] || phone || 'Unknown',
          lastName: data.lastName,
          email,
          phone,
          companyName: data.companyName || undefined,
          tags: data.tags,
          customFields: data.customFields,
          source: data.source,
        },
        userId ?? undefined,
      );
      return { contact, created: true };
    }
    const patch: UpdateContactDto = {
      tags: [...new Set([...existing.tags, ...normalizeTags(data.tags)])],
      customFields: data.customFields,
    };
    if (data.firstName && !existing.firstName) patch.firstName = data.firstName;
    if (data.lastName && !existing.lastName) patch.lastName = data.lastName;
    if (phone && !existing.phone) patch.phone = phone;
    if (email && !existing.email) patch.email = email;
    const contact = await this.update(workspaceId, existing.id, patch, userId ?? undefined);
    return { contact, created: false };
  }

  async bulk(workspaceId: string, dto: BulkContactsDto, userId?: string) {
    const contacts = await this.contacts.find({ where: { workspaceId, id: In(dto.ids) } });
    for (const c of contacts) {
      switch (dto.action) {
        case 'add_tag':
          await this.update(workspaceId, c.id, { tags: [...c.tags, String(dto.value)] }, userId);
          break;
        case 'remove_tag':
          await this.update(
            workspaceId,
            c.id,
            { tags: c.tags.filter((t) => t !== String(dto.value).trim().toLowerCase()) },
            userId,
          );
          break;
        case 'set_status':
          await this.update(workspaceId, c.id, { status: dto.value as any }, userId);
          break;
        case 'set_dnd':
          await this.update(workspaceId, c.id, { dnd: dto.value === true || dto.value === 'true' }, userId);
          break;
        case 'delete':
          await this.remove(workspaceId, c.id, userId);
          break;
      }
    }
    return { affected: contacts.length };
  }

  /** Rows are objects keyed by CSV header; common header spellings are recognised. */
  async import(workspaceId: string, dto: ImportContactsDto, userId?: string) {
    const pick = (row: Record<string, string>, ...keys: string[]) => {
      for (const k of Object.keys(row)) {
        if (keys.includes(k.trim().toLowerCase().replace(/[\s_-]/g, ''))) return row[k]?.trim() || undefined;
      }
      return undefined;
    };
    let created = 0;
    let updated = 0;
    const errors: Array<{ row: number; error: string }> = [];
    for (const [i, row] of dto.rows.entries()) {
      try {
        const name = pick(row, 'name', 'fullname');
        const [nFirst, ...nRest] = (name ?? '').split(' ');
        const email = pick(row, 'email', 'emailaddress');
        const phone = pick(row, 'phone', 'phonenumber', 'mobile');
        const first = pick(row, 'firstname', 'first') ?? (nFirst || undefined);
        if (!email && !phone && !first) throw new Error('Row has no name, email or phone');
        const res = await this.upsert(
          workspaceId,
          {
            firstName: first,
            lastName: pick(row, 'lastname', 'last') ?? nRest.join(' '),
            email,
            phone,
            companyName: pick(row, 'company', 'companyname', 'organization'),
            tags: [...(dto.tags ?? []), ...(pick(row, 'tags')?.split(/[,;]/) ?? [])],
            source: 'import',
          },
          userId,
        );
        if (res.created) created++;
        else updated++;
      } catch (err) {
        errors.push({ row: i + 1, error: err?.message ?? String(err) });
      }
    }
    return { created, updated, errors };
  }

  async exportCsv(workspaceId: string): Promise<string> {
    const rows = await this.contacts.find({
      where: { workspaceId },
      relations: { company: true },
      order: { createdAt: 'ASC' },
    });
    const cell = (v: unknown) => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = ['first_name', 'last_name', 'email', 'phone', 'company', 'status', 'tags', 'source', 'dnd', 'created_at'];
    const lines = rows.map((c) =>
      [c.firstName, c.lastName, c.email, c.phone, c.company?.name, c.status, c.tags.join(';'), c.source, c.dnd, c.createdAt.toISOString()]
        .map(cell)
        .join(','),
    );
    return [header.join(','), ...lines].join('\n');
  }

  async remove(workspaceId: string, id: string, userId?: string) {
    const contact = await this.get(workspaceId, id);
    await this.contacts.softRemove(contact);
    await this.activity.record(workspaceId, 'contact.deleted', `Contact ${fullName(contact)} deleted`, {
      entityType: 'contact',
      entityId: id,
      userId,
    });
    return { id };
  }

  async tags(workspaceId: string): Promise<string[]> {
    const rows = await this.contacts.query(
      `SELECT DISTINCT unnest(tags) AS tag FROM contacts
       WHERE workspace_id = $1 AND deleted_at IS NULL ORDER BY tag`,
      [workspaceId],
    );
    return rows.map((r) => r.tag);
  }

  /** Lead sources in use, for the filter dropdown. */
  async sources(workspaceId: string): Promise<string[]> {
    const rows = await this.contacts.query(
      `SELECT DISTINCT source FROM contacts WHERE workspace_id = $1 AND deleted_at IS NULL AND source <> '' ORDER BY source`,
      [workspaceId],
    );
    return rows.map((r) => r.source);
  }

  private async afterUpdate(
    workspaceId: string,
    before: Contact,
    after: Contact,
    userId?: string | null,
    meta: Record<string, any> = {},
  ) {
    await this.activity.record(workspaceId, 'contact.updated', `Contact ${fullName(after)} updated`, {
      entityType: 'contact',
      entityId: after.id,
      userId,
    });
    this.events.emit({
      type: 'contact.updated',
      workspaceId,
      userId,
      contactId: after.id,
      payload: { ...meta, contact: after, previous: before },
    });
    for (const tag of after.tags.filter((t) => !before.tags.includes(t))) {
      this.events.emit({
        type: 'contact.tag_added',
        workspaceId,
        userId,
        contactId: after.id,
        payload: { ...meta, contact: after, tag },
      });
    }
  }

  private async assertEmailFree(workspaceId: string, email?: string | null, exceptId?: string) {
    if (!email) return;
    const existing = await this.contacts.findOne({
      where: { workspaceId, email: ILike(email) },
    });
    if (existing && existing.id !== exceptId) {
      throw new ConflictException('A contact with this email already exists');
    }
  }

  private async resolveCompany(
    workspaceId: string,
    dto: { companyId?: string | null; companyName?: string },
  ): Promise<string | null> {
    if (dto.companyId) {
      const c = await this.companies.findOne({ where: { id: dto.companyId, workspaceId } });
      if (!c) throw new NotFoundException('Company not found');
      return c.id;
    }
    const name = dto.companyName?.trim();
    if (!name) return null;
    const existing = await this.companies.findOne({ where: { workspaceId, name: ILike(name) } });
    if (existing) return existing.id;
    const created = await this.companies.save(this.companies.create({ workspaceId, name }));
    return created.id;
  }
}

export function fullName(c: Pick<Contact, 'firstName' | 'lastName'>) {
  return `${c.firstName} ${c.lastName ?? ''}`.trim();
}

function normalizeTags(tags?: string[]): string[] {
  if (!tags) return [];
  return [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))];
}
