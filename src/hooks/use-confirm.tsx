"use client";
/* eslint-disable react-hooks/preserve-manual-memoization, react-hooks/exhaustive-deps */

import { useState, useCallback, type ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface ConfirmOptions {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "destructive" | "default";
  icon?: ReactNode;
}

export function useConfirm(): [
  (options: ConfirmOptions) => Promise<boolean>,
  () => ReactNode,
] {
  const [state, setState] = useState<{
    open: boolean;
    options: ConfirmOptions;
    resolve: ((value: boolean) => void) | null;
  }>({
    open: false,
    options: { title: "", description: "" },
    resolve: null,
  });

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      setState({ open: true, options, resolve });
    });
  }, []);

  const handleClose = useCallback((value: boolean) => {
    state.resolve?.(value);
    setState((prev) => ({ ...prev, open: false, resolve: null }));
  }, [state.resolve]);

  const ConfirmDialog = useCallback(() => {
    const { open, options } = state;
    return (
      <Dialog
        open={open}
        onOpenChange={(isOpen) => { if (!isOpen) handleClose(false); }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {options.icon}
              {options.title}
            </DialogTitle>
            <DialogDescription>{options.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => handleClose(false)}>
              {options.cancelLabel || "Cancel"}
            </Button>
            <Button
              variant={options.variant || "default"}
              onClick={() => handleClose(true)}
            >
              {options.confirmLabel || "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }, [state, handleClose]);

  return [confirm, ConfirmDialog];
}
