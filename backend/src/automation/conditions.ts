/** Pure helpers for the workflow engine (unit-tested in conditions.spec.ts). */

export const CONDITION_OPERATORS = [
  'equals',
  'not_equals',
  'contains',
  'not_contains',
  'gt',
  'lt',
  'exists',
  'not_exists',
] as const;
export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

export function getPath(obj: any, path: string): any {
  if (!path) return undefined;
  return path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

/** Replaces {{ path.to.value }} placeholders using the run context. */
export function interpolate(template: unknown, ctx: Record<string, any>): string {
  if (template == null) return '';
  return String(template).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path) => {
    const v = getPath(ctx, path);
    return v == null ? '' : Array.isArray(v) ? v.join(', ') : String(v);
  });
}

export function evaluateCondition(
  ctx: Record<string, any>,
  cond: { field: string; operator: ConditionOperator; value?: any },
): boolean {
  const actual = getPath(ctx, cond.field);
  const expected = cond.value;
  const norm = (v: any) => (typeof v === 'string' ? v.trim().toLowerCase() : v);

  switch (cond.operator) {
    case 'exists':
      return actual !== undefined && actual !== null && actual !== '' &&
        !(Array.isArray(actual) && actual.length === 0);
    case 'not_exists':
      return !evaluateCondition(ctx, { ...cond, operator: 'exists' });
    case 'equals':
      if (typeof actual === 'number') return actual === Number(expected);
      return norm(actual) === norm(expected);
    case 'not_equals':
      return !evaluateCondition(ctx, { ...cond, operator: 'equals' });
    case 'contains':
      if (Array.isArray(actual)) return actual.map(norm).includes(norm(expected));
      return actual != null && String(norm(actual)).includes(String(norm(expected)));
    case 'not_contains':
      return !evaluateCondition(ctx, { ...cond, operator: 'contains' });
    case 'gt':
      return Number(actual) > Number(expected);
    case 'lt':
      return Number(actual) < Number(expected);
    default:
      return false;
  }
}

/** Does an event satisfy the workflow's optional trigger filter? */
export function matchesTrigger(
  triggerConfig: Record<string, any> | null | undefined,
  payload: Record<string, any>,
): boolean {
  const cfg = triggerConfig ?? {};
  if (cfg.tag && String(payload.tag ?? '').toLowerCase() !== String(cfg.tag).toLowerCase()) return false;
  if (cfg.stageId && payload.toStage?.id !== cfg.stageId && payload.stage?.id !== cfg.stageId) return false;
  if (cfg.pipelineId && payload.opportunity?.pipelineId !== cfg.pipelineId) return false;
  if (cfg.channel && payload.message?.channel !== cfg.channel) return false;
  if (cfg.formId && payload.form?.id !== cfg.formId) return false;
  if (cfg.calendarId && payload.calendar?.id !== cfg.calendarId) return false;
  if (cfg.communityId && payload.community?.id !== cfg.communityId) return false;
  if (cfg.status && payload.status !== cfg.status) return false;
  if (cfg.courseId && payload.course?.id !== cfg.courseId) return false;
  if (cfg.campaignId && payload.campaign?.id !== cfg.campaignId) return false;
  if (cfg.urlContains && !String(payload.url ?? '').toLowerCase().includes(String(cfg.urlContains).toLowerCase())) return false;
  return true;
}
