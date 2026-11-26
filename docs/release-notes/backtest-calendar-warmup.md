# Calendar-day backtest warm-up

Backtest Init's **Warm-up (days)** interprets saved `warmup_period` values and expression results as calendar days. Review saved workflows before rerunning them. A saved value of `200` now requests 200 days of history. A blank or missing value starts at Start Date, as does `0`. Saved Warm-Up Mode values are accepted and ignored.

Equity dates for Alpaca and Schwab use New York time. Dhan dates use Kolkata time, and continuous crypto dates use UTC. Timestamps with explicit offsets identify an instant. With the OTLK example's May 1, 2021 Start Date, the 60-day window begins March 2 in New York, spanning the daylight saving change.

Warm-up uses the selected provider's sessions, feed, and corporate-action adjustments. The runner consumes available source candles during warm-up and retains Coreza's existing strategy-period fill-forward behavior. Coreza consolidators use their configured timezone and anchor. Align these settings, session filters, fill-forward behavior, and adjustments before comparing results with LEAN.

Backtest Init reports the available warm-up bar counts and timestamps. The OnBar flag controls workflow routing. [OnBar warm-up status](../plans/onbar-warmup-status.md)
