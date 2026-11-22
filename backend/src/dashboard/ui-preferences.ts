import { BadRequestException, Body, Controller, Delete, Get, Injectable, Put } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsArray, IsObject } from 'class-validator';
import { Repository } from 'typeorm';
import { DEFAULT_APPEARANCE, DEFAULT_LAYOUT, cleanAppearance, cleanLayout, type Appearance, type Widget } from '@eril/shared';
import { UiPreference } from '../database/entities/ui-preference.entity';
import { Workspace } from '../database/entities/workspace.entity';
import { Permissions } from '../common/decorators/permissions.decorator';
import { Tenant } from '../common/decorators/tenant.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

class LayoutDto {
  /** Checked in detail by cleanLayout. */
  @IsArray() widgets: unknown[];
}
class AppearanceDto {
  /** Checked in detail by cleanAppearance. */
  @IsObject() appearance: Record<string, unknown>;
}

export interface UiPreferences {
  widgets: Widget[];
  layoutIsDefault: boolean;
  appearance: Appearance;
  /** Where the appearance comes from: the person's own, the team default, or built-in. */
  appearanceSource: 'own' | 'team' | 'default';
  teamAppearance: Appearance | null;
}

/** Each person's own look of the app per workspace, with an optional team default set by admins. */
@Injectable()
export class UiPreferencesService {
  constructor(
    @InjectRepository(UiPreference) private readonly prefs: Repository<UiPreference>,
    @InjectRepository(Workspace) private readonly workspaces: Repository<Workspace>,
  ) {}

  async get(workspaceId: string, userId: string): Promise<UiPreferences> {
    const [row, ws] = await Promise.all([this.prefs.findOne({ where: { workspaceId, userId } }), this.workspaces.findOne({ where: { id: workspaceId } })]);
    // Re-clean on read, so prefs saved before a catalogue change still render.
    const layout = row?.widgets ? cleanLayout(row.widgets.filter((w) => w && typeof w === 'object')) : null;
    const team = ws?.settings?.uiDefault ? cleanAppearance(ws.settings.uiDefault) : null;
    const own = row?.appearance ? cleanAppearance(row.appearance) : null;
    return {
      widgets: Array.isArray(layout) ? layout : DEFAULT_LAYOUT,
      layoutIsDefault: !Array.isArray(layout),
      appearance: own ?? team ?? DEFAULT_APPEARANCE,
      appearanceSource: own ? 'own' : team ? 'team' : 'default',
      teamAppearance: team,
    };
  }

  private async put(workspaceId: string, userId: string, patch: Partial<Pick<UiPreference, 'widgets' | 'appearance'>>) {
    const row = await this.prefs.findOne({ where: { workspaceId, userId } });
    if (row) await this.prefs.update({ id: row.id }, patch);
    else await this.prefs.insert({ workspaceId, userId, widgets: null, appearance: null, ...patch });
    return this.get(workspaceId, userId);
  }

  saveLayout(workspaceId: string, userId: string, input: unknown) {
    const widgets = cleanLayout(input);
    if (typeof widgets === 'string') throw new BadRequestException(widgets);
    return this.put(workspaceId, userId, { widgets });
  }
  resetLayout(workspaceId: string, userId: string) {
    return this.put(workspaceId, userId, { widgets: null });
  }
  saveAppearance(workspaceId: string, userId: string, input: unknown) {
    return this.put(workspaceId, userId, { appearance: cleanAppearance(input) });
  }
  /** Back to the team default (or built-in look). */
  resetAppearance(workspaceId: string, userId: string) {
    return this.put(workspaceId, userId, { appearance: null });
  }

  async setTeamDefault(workspaceId: string, input: unknown | null) {
    const ws = await this.workspaces.findOneOrFail({ where: { id: workspaceId } });
    const settings = { ...(ws.settings ?? {}) };
    if (input === null) delete settings.uiDefault;
    else settings.uiDefault = cleanAppearance(input);
    await this.workspaces.update({ id: workspaceId }, { settings });
    return { teamAppearance: (settings.uiDefault as Appearance | undefined) ?? null };
  }
}

@Controller('ui')
export class UiPreferencesController {
  constructor(private readonly svc: UiPreferencesService) {}

  @Get('preferences')
  get(@Tenant('workspaceId') ws: string, @CurrentUser('id') me: string) {
    return this.svc.get(ws, me);
  }

  @Put('layout')
  saveLayout(@Tenant('workspaceId') ws: string, @CurrentUser('id') me: string, @Body() dto: LayoutDto) {
    return this.svc.saveLayout(ws, me, dto.widgets);
  }

  @Delete('layout')
  resetLayout(@Tenant('workspaceId') ws: string, @CurrentUser('id') me: string) {
    return this.svc.resetLayout(ws, me);
  }

  @Put('appearance')
  saveAppearance(@Tenant('workspaceId') ws: string, @CurrentUser('id') me: string, @Body() dto: AppearanceDto) {
    return this.svc.saveAppearance(ws, me, dto.appearance);
  }

  @Delete('appearance')
  resetAppearance(@Tenant('workspaceId') ws: string, @CurrentUser('id') me: string) {
    return this.svc.resetAppearance(ws, me);
  }

  /** Admins: the look new and un-customized team members get. */
  @Put('team-appearance')
  @Permissions('workspaces:write')
  setTeam(@Tenant('workspaceId') ws: string, @Body() dto: AppearanceDto) {
    return this.svc.setTeamDefault(ws, dto.appearance);
  }

  @Delete('team-appearance')
  @Permissions('workspaces:write')
  clearTeam(@Tenant('workspaceId') ws: string) {
    return this.svc.setTeamDefault(ws, null);
  }
}
