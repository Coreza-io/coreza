# Accept full Alpaca crypto pairs in order inputs

## Problem

The Alpaca Stream Listener emits symbols such as `ETH/USD`. When an expression passes that value into the Alpaca order node's Base Asset field, Coreza can append the selected Quote Currency again and send `ETH/USD/USD`. Alpaca rejects that symbol.

## Implementation

1. In `coreza-backend/src/brokers/alpaca/capabilities.ts` and `coreza-backend/src/brokers/alpaca/http/operations.ts`, use the same Alpaca-specific resolver for crypto order inputs. Resolve expressions first. If the resolved base field contains a valid full pair, use its base and quote even when the separate quote field has a different or default value. For base-only input, combine it with the selected quote and preserve existing defaults. Continue to accept existing supported `symbol` forms when the split fields are absent. Preserve existing precedence for base-only inputs when both representations are present.
2. Normalize case and surrounding whitespace. Reject malformed explicit pairs such as `ETH/USD/USD` and `ETH/` before any broker request. Keep intentional defaults for absent inputs separate from invalid input handling. Ensure the HTTP builder cannot reconstruct a pair after normalization. Use the canonical pair for place-order JSON and preserve the existing compact conversion for the close-position path. Keep order-ID operations and stock symbols on their current paths.
3. Update the crypto Base Asset field help in the affected Alpaca order node definitions. Explain that it accepts either `ETH` with Quote Currency or a full pair such as `ETH/USD`, including an expression from the Stream Listener. Retain existing persisted field names and defaults so saved workflows need no migration.
4. Keep listener input handling outside this fix. Existing market stream names such as `ETH/USD@bar_1m`, subscription and unregister payloads, Redis routing, and account-level `trade_updates` keep their existing format. Preserve inbound order-event payloads and the gateway's existing symbol matching. A future listener input change should resolve full and split pairs identically across subscribe, register, unsubscribe, and unregister.

## Acceptance checks

- Pass `BarSeries[0].symbol` from the listener into the order node. Verify the mocked outgoing order request contains `symbol: "ETH/USD"` exactly once.
- Verify saved split-field inputs `ETH` + `USD` still submit `ETH/USD`. Verify an explicit `ETH/BTC` stays `ETH/BTC` even with the quote dropdown set to USD. Check the existing compact-symbol path and malformed-pair rejection.
- Verify close-position requests still use the current compact path segment for crypto and stock requests are unaffected.
- Compare stream names and routing before and after the order change. Confirm the existing listener still registers and unregisters the same symbol, and incoming order updates continue to match whether their symbols are slash-delimited or compact.
- Use mocked broker requests for validation. No live orders are needed.

## References

- [Alpaca crypto spot trading](https://docs.alpaca.markets/us/docs/crypto-trading)
- [Alpaca trading WebSocket](https://docs.alpaca.markets/us/docs/websocket-streaming)
- [Coreza Alpaca stream parser](https://github.com/Coreza-io/coreza/blob/dev/coreza-backend/market-stream-service/src/marketGateways/alpaca/helpers.ts#L99)
