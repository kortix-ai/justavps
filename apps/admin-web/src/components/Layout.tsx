import type { ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { ToastStack } from './ToastStack';

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="app">
      <Sidebar />
      <main className="main">
        <Topbar />
        {children}
        <div className="footer-meta">
          Standalone admin served by <code>apps/v2-api</code> at <code>/admin-ui</code>. UI built with Vite + React.{' '}
          <span className="kbd">cmd</span>
          <span className="kbd">k</span> to focus search.
        </div>
      </main>
      <ToastStack />
    </div>
  );
}
