'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect, useRef } from 'react';

interface SidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
}

interface ModelItem {
  id: string;
  name: string;
  status?: string;
}

function normalizeModelsResponse(data: unknown): ModelItem[] {
  const list = Array.isArray(data) ? data : (data as { models?: unknown[] })?.models ?? [];
  return list.map((m) => ({
    id: (m as ModelItem).id ?? '',
    name: (m as ModelItem).name ?? (m as ModelItem).id ?? '',
    status: (m as ModelItem).status,
  }));
}

const isDev = typeof process !== 'undefined' && process.env.NODE_ENV === 'development';

/* Inline SVG icons – 18px, neutral */
const iconClass = "h-[18px] w-[18px] shrink-0";
const Icons = {
  home: (
    <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
    </svg>
  ),
  models: (
    <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
    </svg>
  ),
  agency: (
    <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 3.75h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008z" />
    </svg>
  ),
  members: (
    <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
    </svg>
  ),
  payments: (
    <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75m15.75 0h.75a.75.75 0 01.75.75v.75m0 0H8.25m0 0h-.375c-.621 0-1.125.504-1.125 1.125v9.75c0 .621.504 1.125 1.125 1.125h.375m1.5-1.5H21" />
    </svg>
  ),
  chatting: (
    <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
    </svg>
  ),
  marketing: (
    <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5M9 11.25v1.5M12 9v3.75m3-6v6" />
    </svg>
  ),
  chevron: (
    <svg className="h-4 w-4 shrink-0 transition-transform duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
    </svg>
  ),
  search: (
    <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
    </svg>
  ),
};

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  active: boolean;
}

export default function Sidebar({ isOpen = false, onClose }: SidebarProps = {}) {
  const pathname = usePathname();
  const prevPathname = useRef(pathname);

  useEffect(() => {
    if (prevPathname.current !== pathname) {
      prevPathname.current = pathname;
      onClose?.();
    }
  }, [pathname, onClose]);
  const [models, setModels] = useState<ModelItem[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [sectionsOpen, setSectionsOpen] = useState({ core: true, operations: true, departments: true, models: true });

  const [isDesktop, setIsDesktop] = useState(true);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(min-width: 1024px)');
    setIsDesktop(mq.matches);
    const handler = () => setIsDesktop(mq.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    fetch('/api/models', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (isDev) console.log('[models] raw response', data);
        const list = normalizeModelsResponse(data ?? []);
        setModels(list);
      })
      .catch(() => setModels([]))
      .finally(() => setLoading(false));
  }, []);

  const filtered = models.filter((m) =>
    (m.name ?? '').toLowerCase().includes(search.trim().toLowerCase())
  );

  const homeActive = pathname === '/home' || pathname === '/';
  const modelsActive = pathname === '/models' && !pathname.match(/\/models\/[^/]+/);
  const agencyActive = pathname === '/agency';
  const teamActive = pathname === '/team';
  const paymentsActive = pathname === '/payments';
  const affiliateDealsActive = pathname === '/affiliate-deals';
  const chattingActive = pathname === '/chatting';
  const marketingActive = pathname === '/marketing';
  const isModelDetail = pathname.startsWith('/models/') && pathname !== '/models';

  const toggleSection = (key: keyof typeof sectionsOpen) => {
    setSectionsOpen((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const coreItems: NavItem[] = [
    { href: '/home', label: 'Home', icon: Icons.home, active: homeActive },
    { href: '/models', label: 'Models', icon: Icons.models, active: modelsActive },
    { href: '/agency', label: 'Agency', icon: Icons.agency, active: agencyActive },
  ];
  const operationsItems: NavItem[] = [
    { href: '/team', label: 'Members', icon: Icons.members, active: teamActive },
    { href: '/affiliate-deals', label: 'Affiliate deals', icon: Icons.marketing, active: affiliateDealsActive },
    { href: '/payments', label: 'Payments', icon: Icons.payments, active: paymentsActive },
  ];
  const departmentsItems: NavItem[] = [
    { href: '/chatting', label: 'Chatting', icon: Icons.chatting, active: chattingActive },
    { href: '/marketing', label: 'Marketing', icon: Icons.marketing, active: marketingActive },
  ];

  const handleNavClick = () => {
    if (onClose) onClose();
  };

  const NavLink = ({ item }: { item: NavItem }) => (
    <Link
      href={item.href}
      onClick={handleNavClick}
      className={`sidebar-nav-item group relative flex h-[42px] items-center gap-[10px] rounded-xl pl-[14px] text-sm font-semibold tracking-tight transition-all duration-200 ${
        item.active ? 'active' : ''
      } ${
        item.active
          ? 'bg-white/[0.03]'
          : 'text-zinc-100 hover:bg-white/[0.04]'
      }`}
    >
      <span className={item.active ? 'text-zinc-200' : 'text-zinc-400 group-hover:text-zinc-300'}>
        {item.icon}
      </span>
      <span className="sidebar-nav-label">{item.label}</span>
    </Link>
  );

  const Section = ({
    title,
    items,
    openKey,
  }: {
    title: string;
    items: NavItem[];
    openKey: keyof typeof sectionsOpen;
  }) => (
    <div className="space-y-1">
      <button
        type="button"
        onClick={() => toggleSection(openKey)}
        className="sidebar-section-header flex w-full items-center justify-between rounded-lg px-2 py-1.5 transition-colors"
      >
        <span>{title}</span>
        <span className={`transition-transform duration-200 ${sectionsOpen[openKey] ? 'rotate-180' : ''}`}>
          {Icons.chevron}
        </span>
      </button>
      <div
        className={`overflow-hidden transition-all duration-200 ease-out ${
          sectionsOpen[openKey] ? 'max-h-[200px] opacity-100' : 'max-h-0 opacity-60'
        }`}
      >
        <div className="space-y-0.5">
          {items.map((item) => (
            <NavLink key={item.href} item={item} />
          ))}
        </div>
      </div>
    </div>
  );

  // Shared inner content (mobile header + nav)
  const sidebarInner = (
    <>
      {onClose ? (
        <div className="relative z-[60] flex shrink-0 items-center justify-between border-b border-white/10 px-4 py-4 lg:hidden">
          <span className="text-sm font-semibold text-white/90">Menu</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-white/70 transition-colors hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--purple-500)]/30 active:scale-[0.98]"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      ) : null}
      <nav className="flex flex-1 flex-col gap-4 overflow-y-auto px-3 py-5 pt-0 lg:pt-5">
        <Section title="Core" items={coreItems} openKey="core" />
        <Section title="Operations" items={operationsItems} openKey="operations" />
        <Section title="Departments" items={departmentsItems} openKey="departments" />

        {(modelsActive || isModelDetail) && (
          <div className="space-y-1 pt-2 border-t border-white/10">
            <button
              type="button"
              onClick={() => toggleSection('models')}
              className="sidebar-section-header flex w-full items-center justify-between rounded-lg px-2 py-1.5 transition-colors"
            >
              <span>Models</span>
              <span className={`transition-transform duration-200 ${sectionsOpen.models ? 'rotate-180' : ''}`}>
                {Icons.chevron}
              </span>
            </button>
            <div
              className={`overflow-hidden transition-all duration-200 ease-out ${
                sectionsOpen.models ? 'max-h-[320px] opacity-100' : 'max-h-0 opacity-60'
              }`}
            >
              <>
                <div className="relative mt-2">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40">{Icons.search}</span>
                  <input
                    type="search"
                    placeholder="Search models..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] py-2 pl-9 pr-3 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-white/20 focus:outline-none focus:ring-1 focus:ring-white/10 transition-all"
                  />
                </div>
                <ul className="mt-2 space-y-0.5">
                  {loading ? (
                    <li className="px-3 py-2 text-xs text-zinc-500">Loading…</li>
                  ) : filtered.length === 0 ? (
                    <li className="px-3 py-2 text-xs text-zinc-500">
                      {isDev && models.length === 0 ? 'No models returned.' : 'No models match.'}
                    </li>
                  ) : (
                    filtered.map((m) => (
                      <li key={m.id}>
                        <Link
                          href={`/models/${m.id}`}
                          onClick={handleNavClick}
                          className={`sidebar-nav-item sidebar-nav-label flex items-center gap-2 rounded-lg px-3 py-2 text-xs transition-all duration-200 ${
                            pathname === `/models/${m.id}` ? 'active' : ''
                          } ${
                            pathname === `/models/${m.id}`
                              ? 'bg-white/10 text-white font-semibold'
                              : 'text-white/70 hover:bg-white/5 hover:text-white/90 font-medium'
                          }`}
                        >
                          {pathname === `/models/${m.id}` && (
                            <span
                              className="absolute left-0 top-1/2 -translate-y-1/2 h-6 w-0.5 rounded-r bg-[var(--purple-500)]"
                              aria-hidden
                            />
                          )}
                          {m.name || m.id}
                        </Link>
                      </li>
                    ))
                  )}
                </ul>
              </>
            </div>
          </div>
        )}

        {isModelDetail && (
          <Link
            href="/models"
            onClick={handleNavClick}
            className="mt-2 flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-300 transition-colors"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
            </svg>
            Back to models
          </Link>
        )}
      </nav>
    </>
  );

  // Mobile (below lg): when closed, unmount completely so no layout space or blank area
  if (!isDesktop && !isOpen) return null;

  // Desktop (lg+): always in flow, width toggles open/closed
  if (isDesktop) {
    return (
      <aside
        className={`sidebar-luxury flex flex-col border-r transition-[width] duration-[250ms] ease-out static inset-auto z-auto ${
          isOpen ? 'w-[280px] min-w-[280px]' : 'w-0 min-w-0 overflow-hidden border-r-0 p-0'
        }`}
      >
        {sidebarInner}
      </aside>
    );
  }

  // Mobile overlay: backdrop + fixed aside (only when isOpen; closed case returned null above)
  return (
    <>
      {onClose && (
        <div
          role="button"
          tabIndex={-1}
          onClick={onClose}
          onKeyDown={(e) => e.key === 'Escape' && onClose()}
          aria-label="Close menu"
          className="fixed inset-0 z-[45] bg-black/60 backdrop-blur-sm transition-opacity duration-300 ease-out cursor-default"
          style={{ pointerEvents: 'auto' }}
        />
      )}
      <aside className="sidebar-luxury flex flex-col border-r border-white/10 fixed inset-y-0 left-0 z-50 w-[280px] min-w-[280px]">
        {sidebarInner}
      </aside>
    </>
  );
}
