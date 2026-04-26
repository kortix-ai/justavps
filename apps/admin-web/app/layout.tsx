import './globals.css';
import type { Metadata, Viewport } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import { Sidebar } from '@/components/shell/sidebar';
import { Topbar } from '@/components/shell/topbar';
import { ToastStack } from '@/components/shell/toast-stack';
import { CommandPaletteProvider } from '@/components/shell/command-palette';
import { StoreProvider } from '@/lib/store';

export const metadata: Metadata = {
  title: 'JustAVPS V2 Admin',
  description: 'Operator console for the V2 Incus control plane.',
};

export const viewport: Viewport = {
  themeColor: '#000000',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <body className="min-h-screen bg-bg text-fg">
        <StoreProvider>
          <CommandPaletteProvider>
            <div className="grid min-h-screen grid-cols-[240px_minmax(0,1fr)] bg-bg max-[880px]:grid-cols-[1fr]">
              <Sidebar />
              <main className="flex min-w-0 flex-col">
                <Topbar />
                {children}
                <div className="px-6 py-7 text-center text-[12px] text-fg-subtle">
                  Standalone admin served by <code className="font-mono">apps/v2-api</code> · UI in <code className="font-mono">apps/admin-web</code>
                </div>
              </main>
            </div>
            <ToastStack />
          </CommandPaletteProvider>
        </StoreProvider>
      </body>
    </html>
  );
}
