import { useContext, useEffect, useRef, useState, type ReactNode } from "react";
import * as Popover from "@radix-ui/react-popover";
import { NodePortalContainerContext } from "@/contexts/NodePortalContainerContext";

// Common focus/click popup for node fields; content still uses each field's evaluator.
export function useFieldPreview(enabled: boolean, content: ReactNode | (() => ReactNode)) {
  const container = useContext(NodePortalContainerContext);
  const [isOpen, setIsOpen] = useState(false);
  const [anchorElement, setAnchorElement] = useState<HTMLElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  const open = (target: HTMLElement) => {
    if (!enabled) return;
    setAnchorElement(target);
    setIsOpen(true);
  };

  useEffect(() => {
    if (!enabled) setIsOpen(false);
  }, [enabled]);

  let popup: ReactNode = null;
  if (enabled && isOpen && anchorElement) {
    popup = (
      <Popover.Root open={isOpen} onOpenChange={setIsOpen}>
      <Popover.Anchor virtualRef={{ current: anchorElement }} />
      <Popover.Portal container={container}>
      <Popover.Content
        side="top" align="start" sideOffset={8} collisionPadding={8}
        collisionBoundary={container?.closest<HTMLElement>(".react-flow") ?? undefined}
        style={{ width: "max(260px, var(--radix-popover-trigger-width))", maxWidth: "var(--radix-popover-content-available-width)", maxHeight: "var(--radix-popover-content-available-height)", zIndex: container ? 1100 : 50 }}
        className="nodrag nopan nowheel pointer-events-auto overflow-y-auto outline-none"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onInteractOutside={(event) => {
          if (wrapperRef.current?.contains(event.target as Node)) event.preventDefault();
        }}
      >
        <div className="rounded-lg border bg-card text-card-foreground shadow-lg overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/60">
            <span className="text-xs font-medium text-muted-foreground">Result</span>
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary">Preview</span>
          </div>
          <div className="px-3 py-2 text-sm break-words whitespace-pre-wrap max-h-40 overflow-auto font-mono bg-background">
            {typeof content === "function" ? content() : content}
          </div>
          <div className="px-3 py-2 bg-muted/50 text-[11px] text-muted-foreground flex items-center gap-1">
            <span className="font-semibold text-foreground">Tip:</span>
            <span>Anything inside {"{{ }}"} is JavaScript.</span>
          </div>
        </div>
      </Popover.Content>
      </Popover.Portal>
      </Popover.Root>
    );
  }
  return { isOpen: enabled && isOpen, open, wrapperRef, popup };
}
