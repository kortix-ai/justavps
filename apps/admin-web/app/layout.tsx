import './globals.css';
import type { Metadata, Viewport } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import { Toaster } from '@/components/ui/sonner';
import { StoreProvider } from '@/lib/store';
import { UiPrefsProvider } from '@/lib/ui-prefs';
import { ConfirmProvider } from '@/components/confirm';
import { cn } from '@/lib/utils';

export const metadata: Metadata = {
  title: 'JustAVPS V2',
  description: 'Operator console for the V2 Incus control plane.',
};

export const viewport: Viewport = {
  themeColor: '#000000',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn(GeistSans.variable, GeistMono.variable)} suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <StoreProvider>
          <UiPrefsProvider>
            <ConfirmProvider>
              {children}
              <Toaster richColors position="bottom-right" />
            </ConfirmProvider>
          </UiPrefsProvider>
        </StoreProvider>
      </body>
    </html>
  );
}
