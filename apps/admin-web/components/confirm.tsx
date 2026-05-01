'use client';

// Project-wide confirm primitives. Two flavors:
//   <ConfirmDialog>      — yes/no for routine destructive ops (delete, stop, etc.)
//   <PhraseConfirmDialog> — typed-phrase gate for irreversible €€€ ops
//                          (place real Hetzner order, terminate node)
//
// Both compose shadcn AlertDialog. The hook `useConfirm()` lets imperative
// call sites do `if (!(await confirm({...}))) return;` instead of nesting
// state — replaces native window.confirm()/prompt() everywhere.

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type SimpleOpts = {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

type PhraseOpts = SimpleOpts & {
  phrase: string;
  phraseLabel?: string;
};

type State =
  | { kind: 'idle' }
  | { kind: 'simple'; opts: SimpleOpts; resolve: (ok: boolean) => void }
  | { kind: 'phrase'; opts: PhraseOpts; resolve: (ok: boolean) => void };

type Ctx = {
  confirm: (opts: SimpleOpts) => Promise<boolean>;
  confirmPhrase: (opts: PhraseOpts) => Promise<boolean>;
};

const ConfirmContext = createContext<Ctx | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [typed, setTyped] = useState('');

  const confirm = useCallback(
    (opts: SimpleOpts) => new Promise<boolean>((resolve) => {
      setState({ kind: 'simple', opts, resolve });
    }),
    [],
  );
  const confirmPhrase = useCallback(
    (opts: PhraseOpts) => new Promise<boolean>((resolve) => {
      setTyped('');
      setState({ kind: 'phrase', opts, resolve });
    }),
    [],
  );

  const finish = (ok: boolean) => {
    if (state.kind !== 'idle') state.resolve(ok);
    setState({ kind: 'idle' });
  };

  const ctxValue = useMemo(() => ({ confirm, confirmPhrase }), [confirm, confirmPhrase]);

  const open = state.kind !== 'idle';
  const opts = state.kind !== 'idle' ? state.opts : null;
  const phraseMatches = state.kind === 'phrase' && typed === state.opts.phrase;

  return (
    <ConfirmContext.Provider value={ctxValue}>
      {children}
      <AlertDialog open={open} onOpenChange={(v) => { if (!v) finish(false); }}>
        {opts ? (
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{opts.title}</AlertDialogTitle>
              {opts.description ? <AlertDialogDescription>{opts.description}</AlertDialogDescription> : null}
            </AlertDialogHeader>
            {state.kind === 'phrase' ? (
              <div className="space-y-2">
                <Label htmlFor="phrase-input" className="text-xs text-muted-foreground">
                  {state.opts.phraseLabel ?? 'Type to confirm'}: <code className="font-mono font-semibold">{state.opts.phrase}</code>
                </Label>
                <Input
                  id="phrase-input"
                  autoFocus
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  className="font-mono"
                />
              </div>
            ) : null}
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => finish(false)}>
                {opts.cancelLabel ?? 'Cancel'}
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={() => finish(true)}
                disabled={state.kind === 'phrase' && !phraseMatches}
                className={opts.destructive ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : undefined}
              >
                {opts.confirmLabel ?? (opts.destructive ? 'Delete' : 'Confirm')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        ) : null}
      </AlertDialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm() must be inside <ConfirmProvider>');
  return ctx;
}
