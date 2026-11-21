import type { Contact } from './types';

export interface CustomField {
  id: string;
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'number' | 'date' | 'select' | 'checkbox';
  options: string[];
}

export interface Note {
  id: string;
  body: string;
  createdAt: string;
}

export interface Task {
  id: string;
  title: string;
  description: string | null;
  contactId: string | null;
  contact: Contact | null;
  dueAt: string | null;
  completed: boolean;
}

export type Availability = Record<string, Array<{ start: string; end: string }>>;

export interface CalendarT {
  id: string;
  name: string;
  slug: string;
  description: string;
  durationMinutes: number;
  slotIntervalMinutes: number;
  bufferMinutes: number;
  minNoticeHours: number;
  bookingWindowDays: number;
  timezone: string;
  availability: Availability;
  sendConfirmation: boolean;
  isActive: boolean;
  location: string;
  bookingUrl?: string;
  type: 'personal' | 'team';
  teamMemberIds: string[];
  distribution: 'round_robin' | 'balanced';
  assignContactOwner: boolean;
  reminders?: Array<{ minutesBefore: number; channel: 'email' | 'sms' }>;
}

export interface Member {
  userId: string;
  name: string;
  email: string;
  role: string;
}

export interface Appointment {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  status: 'booked' | 'confirmed' | 'cancelled' | 'showed' | 'noshow';
  notes: string | null;
  source: string;
  contactId: string;
  contact: Contact;
  calendarId: string;
  calendar: CalendarT;
  assignedUserId: string | null;
  host: { id: string; name: string; email: string } | null;
}

export interface FormField {
  key: string;
  label: string;
  type: 'text' | 'email' | 'phone' | 'textarea' | 'number' | 'date' | 'select' | 'radio' | 'checkbox';
  required?: boolean;
  placeholder?: string;
  options?: string[];
  mapTo?: string;
}

export interface FormT {
  id: string;
  name: string;
  slug: string;
  kind: 'form' | 'survey';
  description: string;
  fields: FormField[];
  settings: { submitText?: string; successMessage?: string; redirectUrl?: string; tags?: string[]; color?: string };
  isActive: boolean;
  submissionCount: number;
  publicUrl?: string;
  updatedAt: string;
}

export interface Submission {
  id: string;
  data: Record<string, any>;
  contact: Contact | null;
  createdAt: string;
}

export interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  interval: 'one_time' | 'month' | 'year';
  isActive: boolean;
}

export interface InvoiceItem {
  productId?: string | null;
  name: string;
  quantity: number;
  unitPrice: number;
}

export interface Invoice {
  id: string;
  number: string;
  contactId: string;
  contact: Contact;
  items: InvoiceItem[];
  currency: string;
  subtotal: number;
  taxRate: number;
  tax: number;
  discount: number;
  total: number;
  status: 'draft' | 'sent' | 'paid' | 'void';
  dueDate: string | null;
  notes: string;
  publicToken: string;
  paidAt: string | null;
  paymentMethod: string | null;
  couponCode: string | null;
  subscriptionId: string | null;
  createdAt: string;
}

export interface AbTest {
  subjectB: string;
  testPercent: number;
  metric: 'opens' | 'clicks';
  waitMinutes: number;
}

export interface Campaign {
  id: string;
  name: string;
  channel: 'email' | 'sms';
  subject: string;
  body: string;
  audience: { listId?: string; statuses?: string[]; tags?: string[] };
  status: 'draft' | 'scheduled' | 'sending' | 'testing' | 'sent' | 'failed';
  templateId?: string | null;
  abTest?: AbTest | null;
  abDecideAt?: string | null;
  abWinner?: 'A' | 'B' | null;
  openRate?: number | null;
  clickRate?: number | null;
  scheduledAt: string | null;
  sentAt: string | null;
  stats: { recipients: number; sent: number; failed: number; skipped: number };
  createdAt: string;
}
