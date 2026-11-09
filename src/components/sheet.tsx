import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * A bottom sheet on a phone (it rises from the bottom edge and a thumb reaches everything) and a centered modal on a
 * desktop. Escape or a tap on the dimmed page behind it calls `onEscape`, the page behind does not scroll while it is
 * open, and it sits in a portal on the body so the page's spacing and transforms cannot move it.
 */
export function Sheet({
  label,
  onEscape,
  children,
  className,
}: {
  label: string;
  /** Escape and a tap outside. A sheet with a view inside it can go back a level instead of closing. */
  onEscape: () => void;
  children: ReactNode;
  className?: string;
}) {
  const escape = useRef(onEscape);
  escape.current = onEscape;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && escape.current();
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, []);

  return createPortal(
    <div
      className="sheet-backdrop fixed inset-0 z-50 grid place-items-end bg-black/60 backdrop-blur-sm sm:place-items-center"
      role="presentation"
      // A tap on the dimmed page, not on the sheet itself.
      onMouseDown={(e) => e.target === e.currentTarget && escape.current()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        data-sheet
        className={
          "sheet glass glass-strong flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-[1.75rem] pb-[env(safe-area-inset-bottom)] sm:max-w-2xl sm:rounded-panel sm:pb-0 " +
          (className ?? "")
        }>
        {/* The grab handle of a bottom sheet. It only shows on a phone. */}
        <div aria-hidden="true" className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-white/20 sm:hidden" />
        {children}
      </div>
    </div>,
    document.body,
  );
}
