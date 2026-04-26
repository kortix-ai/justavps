import './globals.css';
import type { Metadata, Viewport } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import { ToastStack } from '@/components/shell/toast-stack';
import { CommandPaletteProvider } from '@/components/shell/command-palette';
import { StoreProvider } from '@/lib/store';

export const metadata: Metadata = {
  title: 'JustAVPS V2',
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
            {children}
            <ToastStack />
          </CommandPaletteProvider>
        </StoreProvider>
      </body>
    </html>
  );
}
