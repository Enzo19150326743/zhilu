"use client";

import { useEffect, useRef, useState } from "react";
import { Ellipsis, type LucideIcon } from "lucide-react";

export interface ActionMenuItem {
  destructive?: boolean;
  disabled?: boolean;
  icon?: LucideIcon;
  label: string;
  onSelect: () => void;
}

interface ActionMenuProps {
  disabled?: boolean;
  items: ActionMenuItem[];
  label: string;
}

export function ActionMenu({
  disabled = false,
  items,
  label
}: ActionMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !menuRef.current?.contains(event.target)
      ) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  useEffect(() => {
    if (disabled) {
      setIsOpen(false);
    }
  }, [disabled]);

  return (
    <div className="relative" ref={menuRef}>
      <button
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label={label}
        className="inline-flex h-9 w-9 items-center justify-center rounded-[2px] border-2 border-[var(--line-ink)] bg-[var(--paper-raised)] text-[var(--ink)] transition-colors hover:bg-[var(--paper-deep)] disabled:cursor-not-allowed disabled:opacity-50"
        disabled={disabled}
        ref={triggerRef}
        title={label}
        type="button"
        onClick={() => setIsOpen((currentValue) => !currentValue)}
      >
        <Ellipsis className="h-4 w-4" aria-hidden="true" />
      </button>

      {isOpen ? (
        <div
          aria-label={label}
          className="absolute right-0 top-[calc(100%+6px)] z-30 min-w-44 border-2 border-[var(--line-ink)] bg-[var(--paper-raised)] p-1 shadow-[4px_4px_0_0_var(--ink)]"
          role="menu"
        >
          {items.map((item) => {
            const ItemIcon = item.icon;

            return (
              <button
                className={`flex min-h-9 w-full items-center gap-2 px-2.5 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  item.destructive
                    ? "text-[var(--accent)] hover:bg-[var(--accent-soft)]"
                    : "text-[var(--ink)] hover:bg-[var(--paper-deep)]"
                }`}
                disabled={item.disabled}
                key={item.label}
                role="menuitem"
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  triggerRef.current?.focus();
                  item.onSelect();
                }}
              >
                {ItemIcon ? (
                  <ItemIcon className="h-4 w-4" aria-hidden="true" />
                ) : null}
                {item.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
