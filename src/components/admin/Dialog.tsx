"use client";

import { type ReactNode, useEffect, useId, useRef } from "react";

/**
 * A native modal dialog: the browser traps focus, makes the page behind it inert and closes it on
 * Escape. The parent owns `open`.
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
}: Readonly<{
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}>) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-lg border border-border-strong bg-bg p-0 text-fg shadow-2xl backdrop:bg-[rgb(0_0_0/0.6)]"
    >
      {open && (
        <div className="flex flex-col gap-4 p-5">
          <h2 id={titleId} className="font-medium text-lg">
            {title}
          </h2>
          {children}
        </div>
      )}
    </dialog>
  );
}
