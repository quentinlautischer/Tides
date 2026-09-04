import { useEffect, useId } from 'react';
import type { ReactNode } from 'react';

interface Props {
  title: string;
  /** Small line under the title, for context the dialog's own body shouldn't have to carry. */
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}

/**
 * The dialog shell both pickers sit in: backdrop, panel, title row and the ways out
 * (the close button, a click on the backdrop, Escape).
 *
 * Callers mount this only while their dialog is open, so whatever they render inside starts
 * fresh each time rather than carrying state over from the last time it was opened.
 */
export default function Modal({ title, subtitle, onClose, children }: Props) {
  const titleId = useId();

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[2000] flex items-start sm:items-center justify-center overflow-y-auto p-4">
      <div className="fixed inset-0 bg-black/70" onClick={onClose} aria-hidden="true"></div>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative my-4 w-full max-w-2xl space-y-4 rounded-xl border border-gray-700 bg-gray-900 p-4 shadow-2xl sm:p-6"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id={titleId} className="text-lg font-semibold text-gray-100">{title}</h2>
            {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={`Close ${title.toLowerCase()}`}
            className="shrink-0 rounded-md px-2 py-1 text-lg leading-none text-gray-400 transition-colors hover:bg-gray-800 hover:text-gray-200"
          >
            &times;
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
