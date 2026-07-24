import type { ReactNode } from "react";
import { Fragment } from "react";
import {
  Dialog,
  DialogPanel,
  DialogTitle,
  Transition,
  TransitionChild,
} from "@headlessui/react";
import clsx from "clsx";
import { HiXMark } from "react-icons/hi2";

export interface MobileSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  /** full = full-screen card sheet; auto = content-height bottom sheet */
  height?: "full" | "auto";
}

/**
 * Mobile-first bottom sheet: slides up, safe-area padded, drag-handle
 * affordance, Escape/backdrop closes (focus is trapped by Dialog).
 */
export function MobileSheet({
  open,
  onClose,
  title,
  children,
  height = "auto",
}: MobileSheetProps) {
  return (
    <Transition show={open} as={Fragment}>
      <Dialog onClose={onClose} className="relative z-50">
        <TransitionChild
          as={Fragment}
          enter="ease-out duration-150"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-100"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/45" aria-hidden />
        </TransitionChild>
        <div className="fixed inset-0 flex items-end justify-center">
          <TransitionChild
            as={Fragment}
            enter="duration-200 ease-[cubic-bezier(0.32,0.72,0,1)]"
            enterFrom="translate-y-full"
            enterTo="translate-y-0"
            leave="duration-150 ease-in"
            leaveFrom="translate-y-0"
            leaveTo="translate-y-full"
          >
            <DialogPanel
              className={clsx(
                "flex w-full flex-col rounded-t-kr8-lg border-t border-kr8-border bg-kr8-bg-elevated pb-safe shadow-kr8-md",
                height === "full" ? "h-[94dvh]" : "max-h-[85dvh]",
              )}
            >
              <div className="flex items-center justify-between px-4 pb-2 pt-2.5">
                <div className="absolute left-1/2 top-2 h-1 w-9 -translate-x-1/2 rounded-full bg-kr8-border" />
                {title ? (
                  <DialogTitle className="mt-2 text-[16px] font-semibold">
                    {title}
                  </DialogTitle>
                ) : (
                  <span />
                )}
                <button
                  onClick={onClose}
                  aria-label="Close"
                  className="mt-2 flex h-11 w-11 items-center justify-center rounded-kr8-sm text-kr8-fg-muted hover:bg-kr8-bg-muted"
                >
                  <HiXMark className="h-5 w-5" />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
                {children}
              </div>
            </DialogPanel>
          </TransitionChild>
        </div>
      </Dialog>
    </Transition>
  );
}
