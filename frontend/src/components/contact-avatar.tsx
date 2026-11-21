import type { Contact } from '@/lib/types';

const HUES = ['bg-indigo-500', 'bg-violet-500', 'bg-sky-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500', 'bg-teal-500', 'bg-fuchsia-500'];
const hue = (s: string) => HUES[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % HUES.length];

/** Initials on a colour that stays the same for a given name. */
export function ContactAvatar({ c, size = 'h-9 w-9 text-xs' }: { c: Pick<Contact, 'firstName' | 'lastName' | 'email'>; size?: string }) {
  const name = `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim() || c.email || '?';
  const ini = `${c.firstName?.[0] ?? ''}${c.lastName?.[0] ?? ''}`.toUpperCase() || name[0].toUpperCase();
  return <span aria-hidden className={`grid shrink-0 place-items-center rounded-full font-semibold text-white ${size} ${hue(name)}`}>{ini}</span>;
}
