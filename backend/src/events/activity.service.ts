import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Activity } from '../database/entities/activity.entity';

@Injectable()
export class ActivityService {
  constructor(
    @InjectRepository(Activity) private readonly repo: Repository<Activity>,
  ) {}

  async record(
    workspaceId: string,
    type: string,
    description: string,
    opts: { entityType?: string; entityId?: string; userId?: string | null } = {},
  ): Promise<void> {
    await this.repo.save(
      this.repo.create({
        workspaceId,
        type,
        description,
        entityType: opts.entityType ?? null,
        entityId: opts.entityId ?? null,
        userId: opts.userId ?? null,
      }),
    );
  }

  recent(workspaceId: string, limit = 15) {
    return this.repo.find({
      where: { workspaceId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }
}
