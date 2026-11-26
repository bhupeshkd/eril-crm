/** The app's main menu (sidebar), grouped. Shared by the shell and the Appearance studio's menu editor. */
export type NavItem = { href: string; label: string; icon: string; perm: string };

export const NAV_GROUPS: Array<{ label: string; items: NavItem[] }> = [
  {
    label: 'Menu',
    items: [
      { href: '/dashboard', label: 'Overview', icon: 'dashboard', perm: 'contacts:read' },
      { href: '/inbox', label: 'Conversations', icon: 'inbox', perm: 'conversations:read' },
      { href: '/pipeline', label: 'Pipeline', icon: 'pipeline', perm: 'pipelines:read' },
      { href: '/contacts', label: 'Contacts', icon: 'contacts', perm: 'contacts:read' },
      { href: '/tasks', label: 'Activities', icon: 'tasks', perm: 'contacts:read' },
      { href: '/calendars', label: 'Calendars', icon: 'calendar', perm: 'calendars:read' },
      { href: '/calls', label: 'Calls', icon: 'phone', perm: 'conversations:read' },
    ],
  },
  {
    label: 'Grow',
    items: [
      { href: '/campaigns', label: 'Marketing', icon: 'marketing', perm: 'campaigns:read' },
      { href: '/social', label: 'Social planner', icon: 'send', perm: 'campaigns:read' },
      { href: '/qr-codes', label: 'QR codes', icon: 'qr', perm: 'campaigns:read' },
      { href: '/sites', label: 'Sites & Funnels', icon: 'sites', perm: 'websites:read' },
      { href: '/forms', label: 'Forms & Surveys', icon: 'forms', perm: 'forms:read' },
      { href: '/reputation', label: 'Reputation', icon: 'reputation', perm: 'contacts:read' },
    ],
  },
  {
    label: 'Revenue & members',
    items: [
      { href: '/payments', label: 'Payments', icon: 'payments', perm: 'payments:read' },
      { href: '/courses', label: 'Courses', icon: 'courses', perm: 'courses:read' },
      { href: '/communities', label: 'Communities', icon: 'communities', perm: 'courses:read' },
    ],
  },
  {
    label: 'Operate',
    items: [
      { href: '/workflows', label: 'Automation', icon: 'automation', perm: 'workflows:read' },
      { href: '/reporting', label: 'Reports', icon: 'reporting', perm: 'analytics:read' },
    ],
  },
];
