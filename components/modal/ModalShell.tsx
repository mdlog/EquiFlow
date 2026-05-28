"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  eyebrow?: ReactNode;
  title: ReactNode;
  /// Scrollable body content.
  children: ReactNode;
  /// Sticky footer (CTA buttons, tx status, footnote).
  footer: ReactNode;
  /// Panel width in px. Defaults to 520 (matches existing modals).
  width?: number;
  /// "drawer" = right-side full-height (default, used by tx modals).
  /// "centered" = floating dialog (used by AutoDefender session-key modal).
  variant?: "drawer" | "centered";
  /// Disable closing via backdrop click. Use when modal contains in-progress
  /// state the user would lose by accident (mining tx, multi-step sign).
  closeOnBackdrop?: boolean;
}

/// Modal shell used by every transaction & auth modal in the app.
/// Owns: overlay, panel chrome, header, scroll container, footer slot, ESC,
/// focus trap, focus restoration, dialog semantics (WCAG SC 4.1.2 / 2.4.3).
/// Does NOT own: tx state, form fields, validation — modals keep those.
export function ModalShell({
  open,
  onClose,
  eyebrow,
  title,
  children,
  footer,
  width = 520,
  variant = "drawer",
  closeOnBackdrop = true,
}: Props) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Move initial focus inside the panel so keyboard users don't get stuck
    // behind the dialog. Prefer the close button (least destructive), but fall
    // back to the panel itself if it's not yet rendered.
    const moveInitialFocus = () => {
      const panel = panelRef.current;
      if (!panel) return;
      const closeBtn = panel.querySelector<HTMLElement>(
        '[data-modal-close="true"]',
      );
      (closeBtn ?? panel).focus();
    };
    const id = window.requestAnimationFrame(moveInitialFocus);

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      // Focus trap: cycle focus within the panel only (WCAG SC 2.4.3).
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (!first || !last) return;
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.cancelAnimationFrame(id);
      document.body.style.overflow = previousOverflow;
      // Restore focus to the element that opened the dialog (WCAG SC 2.4.11).
      previouslyFocused.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  const overlayClass =
    variant === "centered"
      ? "fixed inset-0 z-50 flex items-center justify-center"
      : "fixed inset-0 z-50";
  const overlayStyle: React.CSSProperties =
    variant === "centered"
      ? { background: "rgba(20, 18, 14, 0.5)" }
      : {
          background: "rgba(20, 18, 14, 0.5)",
          animation: "ef-fade-in 0.25s ease-out",
        };
  const panelClass =
    variant === "centered"
      ? "bg-paper border border-ink rounded-[2px] flex flex-col"
      : "bg-paper absolute top-0 right-0 flex flex-col";
  const panelStyle: React.CSSProperties =
    variant === "centered"
      ? {
          width,
          maxWidth: "calc(100vw - 32px)",
          maxHeight: "calc(100vh - 32px)",
          boxShadow: "0 24px 48px rgba(20, 18, 14, 0.15)",
        }
      : {
          height: "100vh",
          width: "100%",
          maxWidth: width,
          borderLeft: "1px solid var(--ink)",
          boxShadow: "-16px 0 40px rgba(20, 18, 14, 0.18)",
          animation: "ef-slide-right 0.32s cubic-bezier(0.2, 0.8, 0.2, 1)",
        };

  return (
    <div
      className={overlayClass}
      style={overlayStyle}
      onClick={closeOnBackdrop ? onClose : undefined}
    >
      <div
        ref={panelRef}
        className={panelClass}
        style={panelStyle}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div
          className="flex items-baseline justify-between border-b border-hairline shrink-0"
          style={{ padding: "18px 24px 14px" }}
        >
          <div>
            {eyebrow && <div className="eyebrow mb-1">{eyebrow}</div>}
            <h2
              id={titleId}
              className="font-serif font-medium m-0"
              style={{ fontSize: 22, letterSpacing: "-0.025em" }}
            >
              {title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-ink-mute hover:text-ink"
            style={{ fontSize: 20, lineHeight: 1, padding: 4 }}
            aria-label="Close dialog"
            data-modal-close="true"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">{children}</div>

        <div
          className="border-t border-hairline bg-paper-alt flex flex-col gap-2 shrink-0"
          style={{ padding: "14px 24px 18px" }}
          role="status"
          aria-live="polite"
          aria-atomic="false"
        >
          {footer}
        </div>
      </div>
    </div>
  );
}
