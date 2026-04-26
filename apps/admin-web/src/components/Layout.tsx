import type { ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { ToastStack } from './ToastStack';
import { CommandPalette } from './CommandPalette';

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <Sidebar />
      <main>
        <Topbar />
        {children}
        <div className="footer-meta">
          Standalone admin served by <code className="mono">apps/v2-api</code> · UI in <code className="mono">apps/admin-web</code>
        </div>
      </main>
      <ToastStack />
      <CommandPalette />
    </div>
  );
}
