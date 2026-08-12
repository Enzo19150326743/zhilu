"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

type ModalDialogSize = "confirmation" | "compact" | "wide";
type ModalDialogHeaderMode = "hidden" | "close-only" | "standard";

interface ModalDialogProps {
  children: ReactNode;
  description?: string;
  footer?: ReactNode;
  headerMode?: ModalDialogHeaderMode;
  isBusy?: boolean;
  isOpen: boolean;
  size?: ModalDialogSize;
  title: string;
  onClose: () => void;
}

const SIZE_CLASS_NAMES: Record<ModalDialogSize, string> = {
  confirmation: "max-w-sm",
  compact: "max-w-lg",
  wide: "max-w-4xl"
};

const SHADOW_CLASS_NAMES: Record<ModalDialogSize, string> = {
  confirmation: "shadow-[4px_4px_0_0_var(--ink)]",
  compact: "shadow-[8px_8px_0_0_var(--ink)]",
  wide: "shadow-[8px_8px_0_0_var(--ink)]"
};

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  ).filter((element) => !element.hasAttribute("hidden"));
}

export function ModalDialog({
  children,
  description,
  footer,
  headerMode = "standard",
  isBusy = false,
  isOpen,
  size = "compact",
  title,
  onClose
}: ModalDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const isBusyRef = useRef(isBusy);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    isBusyRef.current = isBusy;
  }, [isBusy]);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const previousActiveElement =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousBodyOverflow = document.body.style.overflow;
    const focusTimer = window.setTimeout(() => {
      const dialog = dialogRef.current;
      if (!dialog) {
        return;
      }

      const initialFocusTarget = dialog.querySelector<HTMLElement>(
        "[data-dialog-initial-focus]:not([disabled])"
      );
      const fallbackFocusTarget = getFocusableElements(dialog)[0] ?? dialog;
      (initialFocusTarget ?? fallbackFocusTarget).focus();
    }, 0);

    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      const dialog = dialogRef.current;
      if (!dialog) {
        return;
      }

      if (event.key === "Escape" && !isBusyRef.current) {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const focusableElements = getFocusableElements(dialog);
      if (focusableElements.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      const activeElement = document.activeElement;

      if (event.shiftKey && (activeElement === firstElement || !dialog.contains(activeElement))) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousBodyOverflow;
      if (previousActiveElement?.isConnected) {
        previousActiveElement.focus();
      } else {
        document
          .querySelector<HTMLElement>("[data-dialog-return-focus-fallback]")
          ?.focus();
      }
    };
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

  const hasHiddenHeader = headerMode === "hidden";

  const closeButton = (
    <button
      aria-label={`关闭${title}`}
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[2px] border-2 border-[var(--line-ink)] text-[var(--muted)] transition-colors hover:bg-[var(--paper-deep)] hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-60"
      data-dialog-initial-focus
      disabled={isBusy}
      type="button"
      onClick={onClose}
    >
      <X className="h-4 w-4" aria-hidden="true" />
    </button>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--ink)]/45 px-4 py-6 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isBusy) {
          onClose();
        }
      }}
    >
      <section
        aria-describedby={
          headerMode === "standard" && description ? descriptionId : undefined
        }
        aria-labelledby={titleId}
        aria-modal="true"
        className={`flex max-h-[88dvh] w-full ${SIZE_CLASS_NAMES[size]} ${SHADOW_CLASS_NAMES[size]} flex-col overflow-hidden rounded-[2px] border-2 border-[var(--line-ink)] bg-[var(--paper-raised)]`}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        {hasHiddenHeader ? (
          <h2 className="sr-only" id={titleId}>
            {title}
          </h2>
        ) : headerMode === "close-only" ? (
          <div className="flex shrink-0 justify-end px-4 pt-4">
            <h2 className="sr-only" id={titleId}>
              {title}
            </h2>
            {closeButton}
          </div>
        ) : (
          <div className="flex shrink-0 items-start justify-between gap-4 border-b-2 border-[var(--line-ink)] px-5 py-4">
            <div className="min-w-0">
              <h2 className="font-editorial text-lg font-semibold text-[var(--ink)]" id={titleId}>
                {title}
              </h2>
              {description ? (
                <p
                  className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--muted)]"
                  id={descriptionId}
                >
                  {description}
                </p>
              ) : null}
            </div>
            {closeButton}
          </div>
        )}

        <div
          className={`min-h-0 flex-1 overflow-y-auto px-5 ${
            hasHiddenHeader
              ? "pb-2 pt-5"
              : headerMode === "close-only"
                ? "pb-4 pt-2"
                : "pb-4 pt-4"
          }`}
        >
          {children}
        </div>

        {footer ? (
          <div
            className={`flex shrink-0 justify-end gap-2 px-5 ${
              hasHiddenHeader
                ? "bg-[var(--paper-raised)] pb-5 pt-2"
                : "border-t-2 border-[var(--line-ink)] bg-[var(--paper)] py-4"
            }`}
          >
            {footer}
          </div>
        ) : null}
      </section>
    </div>
  );
}

interface ConfirmDialogProps {
  confirmLabel: string;
  description: string;
  errorMessage?: string | null;
  isBusy?: boolean;
  isOpen: boolean;
  title: string;
  onClose: () => void;
  onConfirm: () => void;
}

export function ConfirmDialog({
  confirmLabel,
  description,
  errorMessage = null,
  isBusy = false,
  isOpen,
  title,
  onClose,
  onConfirm
}: ConfirmDialogProps) {
  return (
    <ModalDialog
      footer={
        <>
          <button
            className="inline-flex h-10 items-center justify-center rounded-[2px] border-2 border-[var(--line-ink)] bg-[var(--paper-raised)] px-4 text-sm font-medium text-[var(--ink)] transition-colors hover:bg-[var(--paper-deep)] disabled:cursor-not-allowed disabled:opacity-60"
            data-dialog-initial-focus
            disabled={isBusy}
            type="button"
            onClick={onClose}
          >
            取消
          </button>
          <button
            className="inline-flex h-10 items-center justify-center rounded-[2px] border-2 border-[var(--line-ink)] bg-[var(--accent)] px-4 text-sm font-semibold text-[var(--paper-raised)] shadow-[2px_2px_0_0_var(--ink)] transition-[box-shadow,transform] hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isBusy}
            type="button"
            onClick={onConfirm}
          >
            {isBusy ? "处理中…" : confirmLabel}
          </button>
        </>
      }
      isBusy={isBusy}
      isOpen={isOpen}
      headerMode="hidden"
      size="confirmation"
      title={title}
      onClose={onClose}
    >
      <p className="text-base font-medium leading-7 text-[var(--ink)]">{description}</p>
      {errorMessage ? (
        <p className="mt-4 rounded-[2px] border-2 border-[var(--line-ink)] bg-[#f7ead9] px-3 py-2 text-sm text-[#7a4a1f]">
          {errorMessage}
        </p>
      ) : null}
    </ModalDialog>
  );
}
