# Fix unreadable text on amber/active backgrounds (dark mode)

## The problem

In dark mode `--sidebar-accent` is bright amber and `--sidebar-accent-foreground` is dark brown. The active "Live" item already pairs them correctly (dark text on amber).

The sidebar **footer user button** only sets `hover:bg-sidebar-accent` — it never switches the text color. When the dropdown is open (or on hover), the bg turns amber but the name, email, and chevron remain white/muted-white, making them very hard to read. This is what your screenshot shows.

## Fix

**`src/components/layout/AppSidebar.tsx`** — the footer `DropdownMenuTrigger` button (around line 234):

- Add `hover:text-sidebar-accent-foreground` and `data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground` to the button.
- Wrap the name/email/chevron color classes so the muted `text-sidebar-foreground/70` flips to a darker tone (e.g. `text-sidebar-accent-foreground/80`) when the parent is hovered or `data-[state=open]`. Simplest: rely on the parent setting `color`, drop the `/70` opacity on hover/open via `group` utilities — convert the button to `group` and use `group-hover:text-sidebar-accent-foreground/80 group-data-[state=open]:text-sidebar-accent-foreground/80` on the email + chevron spans.

## Wider sweep

Search confirmed only two files use `bg-sidebar-accent`: `AppSidebar.tsx` (footer button — this fix) and the shadcn `sidebar.tsx` primitives (menu buttons, already pair bg + foreground correctly).

I also want to grep for the same pattern with the global `--accent` token (which is also dark-amber-ish in dark mode) — any component that does `hover:bg-accent` without `hover:text-accent-foreground` will have the same bug. If found, I will apply the same `hover:text-accent-foreground` fix. No other behavioral changes.

## Out of scope

No token/palette changes. No layout changes. Only contrast pairing on interactive states.
