const POINTS = ['CRM, pipeline and unified inbox', 'Campaigns, funnels and order forms', 'Courses, communities and automations'];

export function AuthShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="grid min-h-screen bg-white lg:grid-cols-[1fr_1.1fr]">
      <section className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5">
            <div className="grid h-9 w-9 place-items-center rounded-[11px] bg-gradient-to-br from-brand-500 to-brand-700 text-base font-bold text-white shadow-sm shadow-brand-600/30">E</div>
            <span className="text-lg font-semibold tracking-tight">ERIL</span>
          </div>
          <h1 className="text-[26px] font-semibold tracking-tight">{title}</h1>
          <p className="mb-7 mt-1.5 text-sm text-slate-500">Your whole business, in one place.</p>
          {children}
        </div>
      </section>
      <aside aria-hidden className="relative hidden overflow-hidden bg-brand-950 lg:block">
        <div className="absolute -left-24 -top-24 h-96 w-96 rounded-full bg-brand-500/40 blur-3xl" />
        <div className="absolute -bottom-32 right-0 h-[28rem] w-[28rem] rounded-full bg-violet-500/30 blur-3xl" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[size:44px_44px] [mask-image:radial-gradient(ellipse_at_center,black_40%,transparent_75%)]" />
        <div className="relative flex h-full flex-col justify-end p-12 text-white">
          <p className="max-w-md text-[28px] font-semibold leading-tight tracking-tight">Run marketing, sales and service from one modern workspace.</p>
          <ul className="mt-6 space-y-2.5 text-sm text-brand-100">
            {POINTS.map((p) => (
              <li key={p} className="flex items-center gap-2.5">
                <span className="grid h-5 w-5 place-items-center rounded-full bg-white/10 ring-1 ring-white/20">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3"><path d="M20 6 9 17l-5-5" /></svg>
                </span>
                {p}
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </main>
  );
}
