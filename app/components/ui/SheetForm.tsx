'use client';

import * as Dialog from '@radix-ui/react-dialog';

export default function SheetForm({
  open,
  onOpenChange,
  title,
  subtitle,
  children,
  footer,
  className = '',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm aria-hidden" aria-hidden />
        <Dialog.Content
          className={`fixed z-50 pointer-events-auto flex flex-col max-h-[calc(100vh-2rem)] focus:outline-none
            bottom-0 left-0 right-0 rounded-t-2xl border-t border-white/10 bg-zinc-950/85
            md:bottom-auto md:left-auto md:right-0 md:top-[1rem] md:max-h-[calc(100vh-2rem)] md:w-[420px] md:max-w-[100vw] md:rounded-l-2xl md:rounded-tr-none md:border-t-0 md:border-l md:border-white/10
            text-white shadow-xl backdrop-blur-xl ${className}`}
          aria-describedby={undefined}
        >
          <div className="flex min-h-0 flex-1 flex-col overflow-visible">
            <div className="shrink-0 border-b border-white/10 px-6 py-4">
              <Dialog.Title className="text-lg font-semibold text-white">
                {title}
              </Dialog.Title>
              {subtitle && (
                <p className="mt-1 text-sm text-white/70">{subtitle}</p>
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-4">{children}</div>
            {footer && (
              <div className="shrink-0 border-t border-white/10 px-6 py-4">
                {footer}
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
