import { useContext, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Command as CommandPrimitive } from "cmdk";
import { Check, ChevronDown } from "lucide-react";
import { Command, CommandEmpty, CommandItem, CommandList } from "@/components/ui/command";
import { NodePortalContainerContext } from "@/contexts/NodePortalContainerContext";

type NodeOption = { id: string; label: string; distance?: number };

export default function NodeInputSelector({ options, value, onChange }: {
  options: NodeOption[];
  value?: string;
  onChange: (nodeId: string) => void;
}) {
  const container = useContext(NodePortalContainerContext);
  const anchor = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const selected = options.find(option => option.id === value);
  const query = search.trim().toLowerCase();
  const matches = options.filter(option =>
    option.label.toLowerCase().includes(query) || option.id.toLowerCase().includes(query));
  const changeOpen = (next: boolean) => {
    setOpen(next);
    setSearch("");
  };

  return (
    <Command shouldFilter={false} className="nodrag nopan h-auto overflow-visible bg-transparent">
      <Popover.Root open={open} onOpenChange={changeOpen}>
        <Popover.Anchor asChild>
          <div ref={anchor} className="flex h-9 items-center rounded-md border border-input bg-background focus-within:border-primary focus-within:ring-1 focus-within:ring-primary">
            <CommandPrimitive.Input
              ref={input}
              aria-expanded={open}
              aria-label="Select or search input nodes"
              value={open ? search : selected?.label ?? ""}
              onValueChange={next => { setOpen(true); setSearch(next); }}
              onFocus={() => { if (!open) changeOpen(true); }}
              onClick={() => { if (!open) changeOpen(true); }}
              onPaste={event => {
                if (!open) {
                  event.preventDefault();
                  setOpen(true);
                  setSearch(event.clipboardData.getData("text"));
                }
              }}
              onKeyDown={event => {
                if (!open && !event.ctrlKey && !event.metaKey && !event.altKey &&
                  (event.key.length === 1 || event.key === "Backspace" || event.key === "Delete")) {
                  event.preventDefault();
                  setOpen(true);
                  setSearch(event.key.length === 1 ? event.key : "");
                }
                if (event.key === "Escape" && open) {
                  event.preventDefault();
                  event.stopPropagation();
                  changeOpen(false);
                }
                if (!open && (event.key === "ArrowDown" || event.key === "Enter")) {
                  event.preventDefault();
                  changeOpen(true);
                }
              }}
              placeholder={open ? "Search nodes..." : "Select node..."}
              className="min-w-0 flex-1 bg-transparent px-2 py-1 text-xs text-foreground outline-none placeholder:text-muted-foreground"
            />
            <button type="button" aria-label={open ? "Close node options" : "Show node options"}
              aria-expanded={open} onMouseDown={event => event.preventDefault()}
              onClick={() => changeOpen(!open)} className="shrink-0 p-2 text-muted-foreground">
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
            </button>
          </div>
        </Popover.Anchor>
        <Popover.Portal container={container}>
          <Popover.Content align="start" sideOffset={4} collisionPadding={8}
            collisionBoundary={container?.closest<HTMLElement>(".react-flow") ?? undefined}
            onOpenAutoFocus={event => {
              event.preventDefault();
              input.current?.focus();
            }}
            onCloseAutoFocus={event => event.preventDefault()}
            onInteractOutside={event => {
              if (anchor.current?.contains(event.target as Node)) event.preventDefault();
            }}
            onWheel={event => event.stopPropagation()}
            className="nodrag nopan nowheel pointer-events-auto z-[1100] min-w-[var(--radix-popover-trigger-width)] max-w-[var(--radix-popover-content-available-width)] rounded-md border bg-popover p-1 text-popover-foreground shadow-lg outline-none">
            <CommandList className="max-h-[min(16rem,var(--radix-popover-content-available-height))]">
              <CommandEmpty className="py-4 text-center text-xs">No matching nodes.</CommandEmpty>
              {matches.map(option => (
                <CommandItem key={option.id} value={option.id} onSelect={() => {
                  onChange(option.id);
                  input.current?.focus();
                  changeOpen(false);
                }} className="gap-2 text-xs">
                  <Check className={`h-3.5 w-3.5 shrink-0 ${option.id === value ? "opacity-100" : "opacity-0"}`} />
                  <span className="min-w-0 flex-1 truncate" title={option.label}>{option.label}</span>
                  {option.distance !== undefined && (
                    <span className="shrink-0 text-muted-foreground">
                      {option.distance} {option.distance === 1 ? "node" : "nodes"} back
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandList>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </Command>
  );
}
