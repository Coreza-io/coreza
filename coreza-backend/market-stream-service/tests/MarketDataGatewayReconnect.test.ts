import { MarketDataGateway } from '../src/services/MarketDataGateway';

type ReconnectHarness = {
  source: string;
  logger: { error: jest.Mock };
  lastFatalControlMessage: unknown;
  handleReconnect: () => void;
};

describe('MarketDataGateway reconnect control handling', () => {
  it('suppresses reconnect when a fatal control message was recorded before close', () => {
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
    const gateway = Object.create(MarketDataGateway.prototype) as ReconnectHarness;
    gateway.source = 'dhan_stream';
    gateway.logger = { error: jest.fn() };
    gateway.lastFatalControlMessage = {
      type: 'feed_disconnect',
      reasonCode: 813,
      reasonText: 'Invalid SecurityId',
      SecurityId: '1333',
      ExchangeSegment: 'NSE_EQ',
    };

    gateway.handleReconnect();

    expect(gateway.logger.error).toHaveBeenCalledWith(
      { source: 'dhan_stream', controlMessage: expect.objectContaining({ reasonCode: 813 }) },
      'Suppressing reconnect after fatal gateway control message',
    );
    expect(gateway.lastFatalControlMessage).toBeNull();
    expect(setTimeoutSpy).not.toHaveBeenCalled();
    setTimeoutSpy.mockRestore();
  });
});
