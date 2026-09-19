import { MoreHorizontal } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";

type MenuAction = { label: string; icon: ReactNode; disabled?: boolean; reason?: string; danger?: boolean; onSelect: () => void };
export function OrderActionsMenu({ label, actions, disabled, floating = false }: { label: string; actions: MenuAction[]; disabled?: boolean; floating?: boolean }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const id = useId();
  const [position, setPosition] = useState({ left: 0, top: 0 });
  useLayoutEffect(() => {
    if (!open || !floating) return;
    const place = () => {
      if (!trigger.current || !menu.current) return;
      const anchor = trigger.current.getBoundingClientRect();
      const popup = menu.current.getBoundingClientRect();
      setPosition({
        left: Math.max(12, Math.min(anchor.right - popup.width, window.innerWidth - popup.width - 12)),
        top: anchor.bottom + popup.height + 12 <= window.innerHeight ? anchor.bottom + 6 : Math.max(12, anchor.top - popup.height - 6),
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open, floating]);
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus();
    const outside = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) { setOpen(false); trigger.current?.focus(); }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape, true);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape, true); };
  }, [open]);
  return <div className="order-actions-wrap" ref={wrapper}>
    <button type="button" className="button button-secondary order-menu-trigger" aria-label={label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} disabled={disabled} ref={trigger} onClick={() => setOpen(!open)}><MoreHorizontal /></button>
    {open && <div id={id} className="order-actions-menu" style={floating ? { position: "fixed", right: "auto", ...position } : undefined} role="menu" aria-label={label} ref={menu} onKeyDown={(event) => {
      if (event.key === "Tab") { setOpen(false); return; }
      const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'));
      const current = items.indexOf(document.activeElement as HTMLButtonElement);
      const index = event.key === "ArrowDown" ? (current + 1) % items.length : event.key === "ArrowUp" ? (current - 1 + items.length) % items.length : event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : null;
      if (index !== null) { event.preventDefault(); items[index]?.focus(); }
    }}><span className="order-menu-label">Acciones</span>{actions.map((action) => <button key={action.label} type="button" role="menuitem" disabled={action.disabled} title={action.reason} className={action.danger ? "danger" : undefined} onClick={() => { setOpen(false); trigger.current?.focus(); action.onSelect(); }}>{action.icon}<span>{action.label}</span></button>)}</div>}
  </div>;
}
