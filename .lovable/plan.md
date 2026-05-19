# Remove broker icons from Data Source Status

Hide the per-broker icon in each card of the "Data Source Status" section on the Market Subscriptions page. The broker name and Connected/Offline badge stay; only the icon (llama, ₿, Dhan logo, briefcase, etc.) is removed.

## Change

`src/pages/MarketSubscriptions.tsx` (around lines 657–665): remove the icon `<span>` so each card header just shows the broker name + status badge.

```text
Before: [icon] Alpaca           [Offline]
After:  Alpaca                  [Offline]
```

No other styling, layout, or logic changes. `sourceIcons` helper stays in the file (still used elsewhere if applicable; otherwise left untouched for now).
