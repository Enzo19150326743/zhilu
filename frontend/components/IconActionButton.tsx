import type { LucideIcon } from "lucide-react";

interface IconActionButtonProps {
  ariaLabel?: string;
  disabled?: boolean;
  icon: LucideIcon;
  isSpinning?: boolean;
  label: string;
  onClick: () => void;
  pressed?: boolean;
  tone?: "default" | "accent" | "danger";
  tooltipSide?: "bottom" | "top";
}

export function IconActionButton({
  ariaLabel,
  disabled = false,
  icon: Icon,
  isSpinning = false,
  label,
  onClick,
  pressed = false,
  tone = "default",
  tooltipSide = "top"
}: IconActionButtonProps) {
  const toneClass =
    tone === "danger"
      ? "bg-[var(--paper-raised)] text-[var(--accent)] hover:bg-[var(--accent-soft)]"
      : tone === "accent" || pressed
        ? "bg-[var(--accent)] text-[var(--paper-raised)] hover:bg-[var(--accent-deep)]"
        : "bg-[var(--paper-raised)] text-[var(--ink)] hover:bg-[var(--paper-deep)]";
  const tooltipPositionClass =
    tooltipSide === "bottom"
      ? "top-[calc(100%+8px)]"
      : "bottom-[calc(100%+8px)]";

  return (
    <span className="group/icon-action relative inline-flex shrink-0">
      <button
        aria-label={ariaLabel ?? label}
        aria-pressed={pressed || undefined}
        className={`inline-flex h-9 w-9 items-center justify-center rounded-[2px] border-2 border-[var(--line-ink)] shadow-[2px_2px_0_0_var(--ink)] transition-[box-shadow,transform,background-color,color] duration-150 hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0_0_var(--ink)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-x-0 disabled:hover:translate-y-0 disabled:hover:shadow-[2px_2px_0_0_var(--ink)] ${toneClass}`}
        disabled={disabled}
        type="button"
        onClick={onClick}
      >
        <Icon
          aria-hidden="true"
          className={`h-4 w-4 ${isSpinning ? "animate-spin" : ""}`}
        />
      </button>
      <span
        className={`pointer-events-none absolute right-0 z-50 w-max max-w-56 translate-y-1 border border-[var(--line-ink)] bg-[var(--ink)] px-2 py-1 text-[11px] leading-4 text-[var(--paper-raised)] opacity-0 shadow-[2px_2px_0_0_var(--accent)] transition-[opacity,transform] duration-150 group-hover/icon-action:translate-y-0 group-hover/icon-action:opacity-100 ${tooltipPositionClass}`}
        role="tooltip"
      >
        {label}
      </span>
    </span>
  );
}
