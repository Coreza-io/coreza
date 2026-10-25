# Broker stream fill quantities

Trading listener outputs use `data.order.filledQty` for the individual execution quantity and `data.order.cumulativeFilledQty` for the broker-reported total filled for that order. A missing value stays absent; it is never replaced with zero or a quantity with a different meaning. `requestedQty` remains the original order quantity and `rawOrderData` remains unchanged.

| Broker / event | filledQty (individual execution) | cumulativeFilledQty (order total) |
| --- | --- | --- |
| Alpaca trade_updates | data.qty | data.order.filled_qty |
| Binance Spot executionReport | l | z |
| Binance Futures ORDER_TRADE_UPDATE | o.l | o.z |
| Binance Futures ALGO_UPDATE | Absent (lifecycle snapshot) | o.aq |
| Schwab native ACCT_ACTIVITY | ExecutionQuantity, when supplied | CumulativeQuantity, or order filledQuantity / filledQty |
| Legacy Schwab order snapshots | Absent | order filledQuantity / filledQty |
| Dhan order_alert | Absent (no distinct execution quantity in the documented order-alert schema) | TradedQty |

Dhan's TradedQty is treated as the order snapshot's executed total, consistent with Quantity and RemainingQuantity. Its documentation does not explicitly use the word cumulative. Confirm partial-fill payloads before relying on a different interpretation. No in-memory subtraction is introduced: reconnects, missed updates and replay would make such a derived individual quantity unreliable.

`filledAvgPrice` keeps its existing meaning. Alpaca now also exposes `lastFilledPrice` from data.price, and native Schwab exposes ExecutionPrice separately. Binance already exposes lastFilledPrice. Consumers of individual execution quantities should use their execution price, rather than the cumulative average price.

## Updating workflows

This is a breaking change to listener output semantics for Alpaca, Binance Spot, Schwab and Dhan. Binance Futures ORDER_TRADE_UPDATE already used the individual quantity. The stream output contract is separate from the Portfolio node's Filled Quantity parameter, which still expects a cumulative total on the current dev branch.

Before activating a saved workflow that maps a listener's filledQty into a cumulative consumer, change that expression to cumulativeFilledQty. For example, the Portfolio sync field should use:

```text
{{ $('AlpacaStreamListener').json.data.order.cumulativeFilledQty }}
```

The bundled stream workflow template is updated. Existing saved workflows and pinned historical payloads are not rewritten automatically. Deploy the producer and update workflows together; old pinned payloads need refreshing to contain the new field.

For the reported Alpaca example, filledQty is 0.215358275, cumulativeFilledQty is 0.43071655, and requestedQty is 0.9978.

## Broker references

- [Alpaca trade updates](https://docs.alpaca.markets/us/docs/websocket-streaming): event qty is the quantity of that fill, separate from the order filled quantity.
- [Binance Spot user data](https://developers.binance.com/docs/binance-spot-api-docs/user-data-stream): l is the last execution quantity; z is cumulative.
- [Binance Futures user data](https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/user-data-streams): order execution and algo lifecycle payloads.
- [Dhan order alerts](https://dhanhq.co/docs/v2/order-update/): Quantity, RemainingQuantity, TradedQty, TradedPrice and AvgTradedPrice.

Schwab mapping follows the native CumulativeQuantity / ExecutionQuantity fields already supported by Coreza; authenticated broker documentation and real partial-fill samples should be used for further schema variants.
