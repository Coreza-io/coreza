import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

// Common focus/click popup for node fields; content still uses each field's evaluator.
export function useFieldPreview(enabled: boolean, content: ReactNode) {
  const [isOpen, setIsOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const activeElementRef = useRef<HTMLElement | null>(null);

  const open = (target: HTMLElement) => {
    if (!enabled) return;
    activeElementRef.current = target;
    setAnchorRect(target.getBoundingClientRect());
    setIsOpen(true);
  };

  useEffect(() => {
    if (!enabled) setIsOpen(false);
  }, [enabled]);

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (cardRef.current?.contains(target) || wrapperRef.current?.contains(target)) return;
      setIsOpen(false);
    };
    const updatePosition = () => {
      if (activeElementRef.current) setAnchorRect(activeElementRef.current.getBoundingClientRect());
    };
    updatePosition();
    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [isOpen]);

  let popup: ReactNode = null;
  if (enabled && isOpen && anchorRect) {
    const availableWidth = window.innerWidth - 16;
    const width = Math.min(Math.max(anchorRect.width, 260), availableWidth);
    const left = Math.min(Math.max(8, anchorRect.left), availableWidth - width + 8);
    popup = createPortal(
      <div
        ref={cardRef}
        style={{ position: "fixed", top: anchorRect.top, left, width, transform: "translateY(calc(-100% - 8px))", zIndex: 50 }}
        className="pointer-events-auto"
      >
        <div className="rounded-lg border bg-card text-card-foreground shadow-lg overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/60">
            <span className="text-xs font-medium text-muted-foreground">Result</span>
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary">Preview</span>
          </div>
          <div className="px-3 py-2 text-sm break-words whitespace-pre-wrap max-h-40 overflow-auto font-mono bg-background">
            {content}
          </div>
          <div className="px-3 py-2 bg-muted/50 text-[11px] text-muted-foreground flex items-center gap-1">
            <span className="font-semibold text-foreground">Tip:</span>
            <span>Anything inside {"{{ }}"} is JavaScript.</span>
          </div>
        </div>
      </div>,
      document.body,
    );
  }
  return { isOpen: enabled && isOpen, open, wrapperRef, popup };
}
