import * as React from 'react';
import { X } from 'lucide-react';
import * as DialogPrimitive from '@radix-ui/react-dialog';

import { cn } from '@/utils/cn';

/** A downward drag longer than this (px) on the grabber dismisses the phone sheet. */
const SHEET_DISMISS_DISTANCE = 90;

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      // Phones dim less and blur what is behind: depth by layers, not by a near-black wall.
      'fixed inset-0 z-50 bg-black/80 max-sm:bg-black/45 max-sm:backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

/**
 * Centered dialog from `sm` up; on phones (< 640px) the same content becomes a bottom sheet
 * (DesignSystem-LegacyParity.md §10): anchored to the bottom edge, rounded top, slides up, at most
 * 92% of the visible height (`dvh`), padded by the home-indicator inset, with a grabber you can
 * drag down to dismiss. Every dialog in the app gets this without touching its own file.
 */
const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => {
  const closeRef = React.useRef<HTMLButtonElement>(null);
  const contentRef = React.useRef<HTMLDivElement | null>(null);
  const drag = React.useRef<{ startY: number; dy: number } | null>(null);

  const setRefs = (node: HTMLDivElement | null) => {
    contentRef.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
  };

  const applyOffset = (dy: number, animate: boolean) => {
    const el = contentRef.current;
    if (!el) return;
    el.style.transition = animate ? 'transform 180ms ease-out' : 'none';
    el.style.transform = dy > 0 ? `translateY(${dy}px)` : '';
  };

  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={setRefs}
        className={cn(
          'fixed z-50 grid w-full max-w-lg gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
          // Centered dialog (sm and up).
          'sm:left-[50%] sm:top-[50%] sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-lg sm:data-[state=closed]:zoom-out-95 sm:data-[state=open]:zoom-in-95 sm:data-[state=closed]:slide-out-to-left-1/2 sm:data-[state=closed]:slide-out-to-top-[48%] sm:data-[state=open]:slide-in-from-left-1/2 sm:data-[state=open]:slide-in-from-top-[48%]',
          // Bottom sheet (phones).
          'max-sm:inset-x-0 max-sm:bottom-0 max-sm:max-h-[92dvh] max-sm:max-w-none max-sm:overflow-y-auto max-sm:overscroll-contain max-sm:rounded-t-2xl max-sm:border-x-0 max-sm:border-b-0 max-sm:px-4 max-sm:pb-[calc(1rem+env(safe-area-inset-bottom))] max-sm:pt-8 max-sm:data-[state=closed]:slide-out-to-bottom max-sm:data-[state=open]:slide-in-from-bottom',
          className,
        )}
        {...props}
      >
        {/* Grabber: phones only. Drag it down to dismiss, like a native sheet. */}
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 flex h-8 touch-none justify-center pt-2 sm:hidden"
          onTouchStart={(e) => {
            drag.current = { startY: e.touches[0].clientY, dy: 0 };
          }}
          onTouchMove={(e) => {
            if (!drag.current) return;
            drag.current.dy = Math.max(0, e.touches[0].clientY - drag.current.startY);
            applyOffset(drag.current.dy, false);
          }}
          onTouchEnd={() => {
            const dy = drag.current?.dy ?? 0;
            drag.current = null;
            if (dy > SHEET_DISMISS_DISTANCE) closeRef.current?.click();
            else applyOffset(0, true);
          }}
        >
          <span className="h-1 w-10 rounded-full bg-muted-foreground/30" />
        </div>
        {children}
        <DialogPrimitive.Close
          ref={closeRef}
          className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground max-sm:right-3 max-sm:top-3 max-sm:flex max-sm:h-11 max-sm:w-11 max-sm:items-center max-sm:justify-center max-sm:rounded-full max-sm:bg-muted/70"
        >
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPortal>
  );
});
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col space-y-1.5 text-center sm:text-left', className)} {...props} />
);
DialogHeader.displayName = 'DialogHeader';

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-0 sm:space-x-2', className)}
    {...props}
  />
);
DialogFooter.displayName = 'DialogFooter';

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('text-lg font-semibold leading-none tracking-tight', className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={cn('text-sm text-muted-foreground', className)} {...props} />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
