import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

const dialogStack: { token: symbol; surface: HTMLElement; restoreTarget: HTMLElement | null }[] = [];
let bodyLockCount = 0;
let previousBodyOverflow = "";

const focusableSelector = [
  "button:not([disabled])",
  "a[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function isVisible(element: HTMLElement): boolean {
  if (!element.isConnected || element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    const style = window.getComputedStyle(current);
    if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return false;
  }
  return true;
}

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(focusableSelector))
    .filter((element) => element.tabIndex >= 0 && !element.matches(':disabled, input[type="hidden"]') && isVisible(element));
}

function focusInitial(surface: HTMLElement) {
  const preferred = surface.querySelector<HTMLElement>("[data-dialog-initial-focus]");
  const target = preferred && isVisible(preferred) && !preferred.matches(":disabled")
    ? preferred : focusableElements(surface)[0] || surface;
  target.focus();
}

export function useDialogSurface<T extends HTMLElement = HTMLElement>(
  onClose: () => void,
  { enabled = true }: { enabled?: boolean } = {},
): RefObject<T | null> {
  const surfaceRef = useRef<T | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!enabled || !surfaceRef.current) return;
    const surface = surfaceRef.current;
    const token = Symbol("dialog");
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const entry = { token, surface, restoreTarget: previouslyFocused };
    // A parent can mount after its inline child; the child must remain on top.
    const childIndex = dialogStack.findIndex((item) => surface.contains(item.surface));
    if (childIndex < 0) dialogStack.push(entry);
    else dialogStack.splice(childIndex, 0, entry);
    if (bodyLockCount === 0) {
      previousBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    bodyLockCount += 1;

    const focusTimer = window.setTimeout(() => {
      if (dialogStack.at(-1)?.token === token && !surface.contains(document.activeElement)) focusInitial(surface);
    });

    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || dialogStack.at(-1)?.token !== token) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = focusableElements(surface);
      if (!focusable.length) {
        event.preventDefault();
        surface.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1)!;
      const outside = !focusable.includes(document.activeElement as HTMLElement);
      if (event.shiftKey && (outside || document.activeElement === first)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (outside || document.activeElement === last)) {
        event.preventDefault();
        first.focus();
      }
    }

    function containFocus(event: FocusEvent) {
      if (dialogStack.at(-1)?.token !== token || surface.contains(event.target as Node)) return;
      focusInitial(surface);
    }

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("focusin", containFocus);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("focusin", containFocus);
      const wasTop = dialogStack.at(-1)?.token === token;
      const stackIndex = dialogStack.findIndex((item) => item.token === token);
      if (stackIndex >= 0) dialogStack.splice(stackIndex, 1);
      // Keep the original opener when a lower dialog unmounts before its child.
      for (const item of dialogStack) {
        if (item.restoreTarget && surface.contains(item.restoreTarget)) item.restoreTarget = entry.restoreTarget;
      }
      bodyLockCount = Math.max(0, bodyLockCount - 1);
      if (bodyLockCount === 0) document.body.style.overflow = previousBodyOverflow;
      if (wasTop) {
        const parent = dialogStack.at(-1)?.surface;
        if (entry.restoreTarget && isVisible(entry.restoreTarget) && !entry.restoreTarget.matches(":disabled") && (!parent || parent.contains(entry.restoreTarget))) {
          entry.restoreTarget.focus();
        } else if (parent && isVisible(parent)) {
          focusInitial(parent);
        }
      }
    };
  }, [enabled]);

  return surfaceRef;
}

export function DialogPortal({ children }: { children: ReactNode }) {
  return createPortal(children, document.body);
}
