import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

type PopoverProps = {
  isOpen: boolean;
  position: { x: number; y: number };
  children: ReactNode;
  className?: string;
};

export const Popover = ({
  isOpen,
  position,
  children,
  className = "",
}: PopoverProps) => {
  const [shouldRender, setShouldRender] = useState(false);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
    } else if (shouldRender) {
      setIsVisible(false);
      const timer = setTimeout(() => {
        setShouldRender(false);
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [isOpen, shouldRender]);

  // Trigger enter animation after mount
  useLayoutEffect(() => {
    if (shouldRender && isOpen) {
      requestAnimationFrame(() => {
        setIsVisible(true);
      });
    }
  }, [shouldRender, isOpen]);

  if (!shouldRender || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      className={`fixed z-50 origin-top-left overflow-hidden rounded-[var(--radius-lg)] border border-[var(--panel-border)] bg-[var(--panel-bg)]/95 text-sm shadow-[var(--shadow-lg)] backdrop-blur-xl transition-all duration-150 ease-out ${
        isVisible ? "scale-100 opacity-100" : "scale-95 opacity-0"
      } ${className}`}
      onClick={(event) => event.stopPropagation()}
      style={{ left: position.x, top: position.y }}
    >
      {children}
    </div>,
    document.body
  );
};

type PopoverItemProps = {
  children: ReactNode;
  onClick?: () => void;
  variant?: "default" | "danger";
};

export const PopoverItem = ({
  children,
  onClick,
  variant = "default",
}: PopoverItemProps) => {
  const baseClass =
    "flex w-full items-center gap-3 px-3 py-2 text-left transition-colors duration-100";
  const variantClass =
    variant === "danger"
      ? "text-red-500 hover:bg-red-500/10"
      : "text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)]";

  return (
    <button className={`${baseClass} ${variantClass}`} onClick={onClick}>
      {children}
    </button>
  );
};

export const PopoverDivider = () => (
  <div className="mx-2 my-1 h-px bg-[var(--panel-border)]" />
);

export const PopoverHeader = ({ children }: { children: ReactNode }) => (
  <div className="mx-2 mb-1 rounded-[var(--radius-md)] bg-[var(--accent-soft)] px-2 py-1 text-xs font-medium text-[var(--accent)]">
    {children}
  </div>
);
