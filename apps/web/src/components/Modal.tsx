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

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  size?: "sm" | "md" | "lg";
}

const sizes = { sm: "max-w-sm", md: "max-w-md", lg: "max-w-2xl" };

/** Centered dialog for desktop flows; pairs with MobileSheet on touch. */
export function Modal({ open, onClose, title, children, size = "md" }: ModalProps) {
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
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <TransitionChild
            as={Fragment}
            enter="ease-out duration-150"
            enterFrom="opacity-0 translate-y-2"
            enterTo="opacity-100 translate-y-0"
            leave="ease-in duration-100"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <DialogPanel
              className={clsx(
                // Never taller than the viewport: header stays pinned, the
                // content area scrolls. dvh (not vh) so mobile browser
                // chrome doesn't push the footer/actions off-screen.
                "flex max-h-[calc(100dvh-2rem)] w-full flex-col rounded-kr8-lg border border-kr8-border bg-kr8-bg-elevated p-5 shadow-kr8-md",
                sizes[size],
              )}
            >
              <div className="mb-3 flex shrink-0 items-center justify-between">
                {title && (
                  <DialogTitle className="text-[17px] font-semibold">
                    {title}
                  </DialogTitle>
                )}
                <button
                  onClick={onClose}
                  aria-label="Close"
                  className="rounded-kr8-sm p-1.5 text-kr8-fg-muted hover:bg-kr8-bg-muted hover:text-kr8-fg"
                >
                  <HiXMark className="h-5 w-5" />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                {children}
              </div>
            </DialogPanel>
          </TransitionChild>
        </div>
      </Dialog>
    </Transition>
  );
}
