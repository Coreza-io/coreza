import {
  decodeSchwabDecimal,
  normalizeSchwabAccountActivityMessage,
} from '../src/marketGateways/schwab/helpers';

const quantity = { lo: 1000000, signScale: 12 };
const avgPrice = { lo: 13599, signScale: 12 };

function accountActivityMessage(eventType: string, detailKey: string, detail: Record<string, unknown>) {
  return {
    service: 'ACCT_ACTIVITY',
    content: [
      {
        '1': 'content-account',
        '2': eventType,
        '3': {
          SchwabOrderID: '1006823016739',
          AccountNumber: 'account-123',
          BaseEvent: {
            EventType: eventType,
            [detailKey]: detail,
          },
        },
      },
    ],
  };
}

describe('Schwab account activity normalization', () => {
  it('decodes Schwab protobuf decimal values', () => {
    expect(decodeSchwabDecimal(quantity)).toBe(1);
    expect(decodeSchwabDecimal(avgPrice)).toBeCloseTo(0.013599, 8);
    expect(decodeSchwabDecimal({ lo: 10000, signScale: 13 })).toBe(-0.01);
    expect(decodeSchwabDecimal({ lo: '99600' })).toBe(99600);
  });

  it('normalizes OrderCreated payloads from nested BaseEvent details', () => {
    const normalized = normalizeSchwabAccountActivityMessage(
      accountActivityMessage('OrderCreated', 'OrderCreatedEventEquityOrder', {
        OrderLegs: [
          {
            BuySellCode: 'Buy',
            OrderTypeCode: 'Market',
            Quantity: quantity,
            Security: { Symbol: 'ADTX' },
          },
        ],
        EntryTimestamp: { DateTimeString: '2026-06-18 14:01:02.003' },
      }),
    );

    expect(normalized).toMatchObject({
      type: 'order_update',
      orderEvent: 'OrderCreated',
      orderStatus: 'pending_new',
      symbol: 'ADTX',
      side: 'buy',
      orderType: 'market',
      requestedQty: 1,
      orderId: '1006823016739',
      accountId: 'account-123',
    });
    expect(normalized?.t).toBe(Date.parse('2026-06-18T14:01:02.003'));
  });

  it('normalizes OrderAccepted as new using event status precedence', () => {
    const normalized = normalizeSchwabAccountActivityMessage(
      accountActivityMessage('OrderAccepted', 'OrderAcceptedEvent', {
        Status: 'Open',
        QuoteOnOrderEntry: [{ Symbol: 'ADTX' }],
      }),
    );

    expect(normalized?.orderStatus).toBe('new');
    expect(normalized?.symbol).toBe('ADTX');
  });

  it.each([
    ['ExecutionRequested', 'ExecutionRequestedEventRoutedInfo'],
    ['ExecutionRequestCreated', 'ExecutionRequestCreatedEvent'],
    ['ExecutionRequestCompleted', 'ExecutionRequestCompletedEvent'],
  ])('normalizes %s as new regardless of varying detail key', (eventType, detailKey) => {
    const normalized = normalizeSchwabAccountActivityMessage(
      accountActivityMessage(eventType, detailKey, {
        OrderInfoForTransactionPosting: { Symbol: 'ADTX' },
      }),
    );

    expect(normalized?.orderStatus).toBe('new');
    expect(normalized?.symbol).toBe('ADTX');
    expect(normalized?.orderId).toBe('1006823016739');
  });

  it('normalizes OrderFillCompleted with filled quantity and average price', () => {
    const normalized = normalizeSchwabAccountActivityMessage(
      accountActivityMessage('OrderFillCompleted', 'OrderFillCompletedEventOrderLegQuantityInfo', {
        OrderInfoForTransactionPosting: { Symbol: 'ADTX' },
        CumulativeQuantity: quantity,
        AveragePrice: avgPrice,
      }),
    );

    expect(normalized).toMatchObject({
      type: 'order_update',
      orderStatus: 'filled',
      symbol: 'ADTX',
      filledQty: 1,
    });
    expect(normalized?.filledAvgPrice).toBeCloseTo(0.013599, 8);
  });
});
