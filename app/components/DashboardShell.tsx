'use client';

import { useState } from 'react';
import Header from './Header';
import Sidebar from './Sidebar';
import ScrollToTop from './ScrollToTop';

export default function DashboardShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <div className="dashboard-luxury flex min-h-full w-full max-w-[100vw] flex-col justify-start items-stretch overflow-x-hidden">
      <ScrollToTop />
      <Header
        sidebarOpen={sidebarOpen}
        onSidebarToggle={() => setSidebarOpen((o) => !o)}
        showMenuButton
      />
      <div className="relative flex min-h-0 flex-col items-stretch justify-start overflow-x-hidden lg:flex-row">
        <Sidebar
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />
        <main
          className="dashboard-main ml-0 w-full min-w-0 max-w-full overflow-x-hidden p-4 pb-[max(6rem,env(safe-area-inset-bottom))] pt-2 md:p-6 md:pt-6 lg:flex-1 lg:pb-6"
          style={{
            paddingLeft: 'max(1rem, env(safe-area-inset-left, 0px))',
            paddingRight: 'max(1rem, env(safe-area-inset-right, 0px))',
          }}
        >
          <div className="mx-auto w-full min-w-0 max-w-[100%] md:max-w-none lg:max-w-[1600px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
