import type { StepType, WorkflowStep } from './types';

export type Branch = 'root' | 'then' | 'else';
export interface Slot {
  parentId: string | null;
  branch: Branch;
  index: number;
}

export const newId = () => Math.random().toString(36).slice(2, 10);

export const ACTION_META: Record<StepType, { label: string; icon: string; color: string; defaults: Record<string, any> }> = {
  send_email: { label: 'Send email', icon: '✉', color: 'border-sky-300 bg-sky-50', defaults: { subject: 'Hello {{contact.firstName}}', body: 'Hi {{contact.firstName}},\n\n' } },
  send_sms: { label: 'Send SMS', icon: '💬', color: 'border-sky-300 bg-sky-50', defaults: { body: 'Hi {{contact.firstName}}!' } },
  add_tag: { label: 'Add tag', icon: '🏷', color: 'border-violet-300 bg-violet-50', defaults: { tag: '' } },
  remove_tag: { label: 'Remove tag', icon: '🏷', color: 'border-violet-300 bg-violet-50', defaults: { tag: '' } },
  update_contact: { label: 'Update contact', icon: '✎', color: 'border-violet-300 bg-violet-50', defaults: { field: 'status', value: 'customer' } },
  create_opportunity: { label: 'Create deal', icon: '▤', color: 'border-emerald-300 bg-emerald-50', defaults: { title: 'Deal for {{contact.firstName}} {{contact.lastName}}', value: 0 } },
  create_task: { label: 'Create task', icon: '☑', color: 'border-emerald-300 bg-emerald-50', defaults: { title: 'Follow up with {{contact.firstName}}', dueInDays: 1 } },
  add_note: { label: 'Add note', icon: '🗒', color: 'border-violet-300 bg-violet-50', defaults: { body: '' } },
  webhook: { label: 'Webhook', icon: '↗', color: 'border-slate-400 bg-white', defaults: { url: 'https://' } },
  send_review_request: { label: 'Request review', icon: '★', color: 'border-amber-300 bg-amber-50', defaults: { channel: 'email' } },
  ai_generate: { label: 'AI: generate text', icon: '✨', color: 'border-violet-300 bg-violet-50', defaults: { prompt: 'Write a two-sentence friendly follow-up for {{contact.firstName}}.' } },
  enroll_in_course: { label: 'Enroll in course', icon: '🎓', color: 'border-emerald-300 bg-emerald-50', defaults: { courseId: '', notify: true } },
  wait: { label: 'Wait', icon: '⏳', color: 'border-orange-300 bg-orange-50', defaults: { amount: 1, unit: 'days' } },
  log: { label: 'Log', icon: '📝', color: 'border-slate-300 bg-slate-50', defaults: { message: '' } },
  condition: { label: 'If / Else', icon: '⑂', color: 'border-amber-300 bg-amber-50', defaults: { field: 'contact.status', operator: 'equals', value: 'lead' } },
};

export const TRIGGER_META: Record<string, string> = {
  manual: 'Manually triggered',
  'contact.created': 'Contact is created',
  'contact.updated': 'Contact is updated',
  'contact.tag_added': 'Tag is added to contact',
  'opportunity.created': 'Deal is created',
  'opportunity.stage_changed': 'Deal changes stage',
  'message.received': 'Message is received',
  'form.submitted': 'Form is submitted',
  'appointment.booked': 'Appointment is booked',
  'appointment.status_changed': 'Appointment status changes',
  'invoice.paid': 'Invoice is paid',
  'task.completed': 'Task is completed',
  'review.received': 'Review is received',
  'course.enrolled': 'Contact enrolls in a course',
  'course.completed': 'Contact completes a course',
  'subscription.created': 'Subscription starts',
  'subscription.canceled': 'Subscription is canceled',
  'invoice.overdue': 'Invoice becomes overdue',
  'email.opened': 'Email is opened',
  'email.clicked': 'Link in an email is clicked',
  'order.submitted': 'Order form is submitted',
  'order.paid': 'Order is paid',
  'community.member_joined': 'Contact joins a community',
  'community.post_created': 'Member posts in a community',
  'call.missed': 'Call is missed',
};

export const OPERATOR_LABEL: Record<string, string> = {
  equals: 'equals',
  not_equals: 'does not equal',
  contains: 'contains',
  not_contains: 'does not contain',
  gt: 'is greater than',
  lt: 'is less than',
  exists: 'is set',
  not_exists: 'is empty',
};

export const CONDITION_FIELDS = [
  'contact.status',
  'contact.tags',
  'contact.email',
  'contact.phone',
  'contact.firstName',
  'contact.lastName',
  'opportunity.value',
  'opportunity.title',
  'toStage.name',
  'message.body',
  'tag',
  'submission.<field_key>',
  'appointment.status',
  'invoice.total',
  'contact.customFields.<key>',
  'review.rating',
  'ai.text',
];

export function makeStep(type: StepType): WorkflowStep {
  const step: WorkflowStep = { id: newId(), type, config: { ...ACTION_META[type].defaults } };
  if (type === 'condition') {
    step.then = [];
    step.else = [];
  }
  return step;
}

export function findStep(steps: WorkflowStep[], id: string): WorkflowStep | null {
  for (const s of steps) {
    if (s.id === id) return s;
    const found = findStep(s.then ?? [], id) ?? findStep(s.else ?? [], id);
    if (found) return found;
  }
  return null;
}

export function updateStep(steps: WorkflowStep[], id: string, patch: (s: WorkflowStep) => WorkflowStep): WorkflowStep[] {
  return steps.map((s) => {
    if (s.id === id) return patch(s);
    if (s.type !== 'condition') return s;
    return { ...s, then: updateStep(s.then ?? [], id, patch), else: updateStep(s.else ?? [], id, patch) };
  });
}

export function removeStep(steps: WorkflowStep[], id: string): WorkflowStep[] {
  return steps
    .filter((s) => s.id !== id)
    .map((s) => (s.type === 'condition' ? { ...s, then: removeStep(s.then ?? [], id), else: removeStep(s.else ?? [], id) } : s));
}

export function insertStep(steps: WorkflowStep[], slot: Slot, step: WorkflowStep): WorkflowStep[] {
  if (slot.parentId === null) {
    return [...steps.slice(0, slot.index), step, ...steps.slice(slot.index)];
  }
  return updateStep(steps, slot.parentId, (p) => {
    const key = slot.branch as 'then' | 'else';
    const list = p[key] ?? [];
    return { ...p, [key]: [...list.slice(0, slot.index), step, ...list.slice(slot.index)] };
  });
}

/** Move a step up/down within its own list. */
export function shiftStep(steps: WorkflowStep[], id: string, dir: -1 | 1): WorkflowStep[] {
  const i = steps.findIndex((s) => s.id === id);
  if (i >= 0) {
    const j = i + dir;
    if (j < 0 || j >= steps.length) return steps;
    const next = [...steps];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  }
  return steps.map((s) =>
    s.type === 'condition' ? { ...s, then: shiftStep(s.then ?? [], id, dir), else: shiftStep(s.else ?? [], id, dir) } : s,
  );
}

export function describeStep(s: WorkflowStep): string {
  const c = s.config ?? {};
  switch (s.type) {
    case 'send_email':
      return c.subject ? `“${c.subject}”` : 'No subject';
    case 'send_sms':
      return c.body ? `“${String(c.body).slice(0, 40)}”` : 'Empty message';
    case 'add_tag':
    case 'remove_tag':
      return c.tag ? `#${c.tag}` : 'No tag chosen';
    case 'update_contact':
      return `${c.field} → ${c.value}`;
    case 'create_opportunity':
      return `${c.title || 'Untitled'}${c.value ? ` · $${c.value}` : ''}`;
    case 'create_task':
      return `${c.title || 'Untitled'} · due in ${c.dueInDays ?? 0}d`;
    case 'add_note':
      return c.body ? `“${String(c.body).slice(0, 40)}”` : 'Empty note';
    case 'webhook':
      return c.url || 'No URL';
    case 'wait':
      return `${c.amount ?? 0} ${c.unit ?? 'minutes'}`;
    case 'send_review_request':
      return `via ${c.channel ?? 'email'}`;
    case 'enroll_in_course':
      return c.courseId ? 'Course selected' : 'No course chosen';
    case 'ai_generate':
      return c.prompt ? `“${String(c.prompt).slice(0, 40)}…”` : 'No prompt';
    case 'log':
      return c.message || 'Empty note';
    case 'condition':
      return `${c.field} ${OPERATOR_LABEL[c.operator] ?? c.operator}${['exists', 'not_exists'].includes(c.operator) ? '' : ` “${c.value ?? ''}”`}`;
  }
}
