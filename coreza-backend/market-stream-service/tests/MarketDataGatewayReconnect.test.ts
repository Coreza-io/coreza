import { MarketDataGateway } from '../src/services/MarketDataGateway';

type ReconnectHarness = {
  source: string;
  logger: { debug: jest.Mock; error: jest.Mock; info: jest.Mock };
  lastFatalControlMessage: unknown;
  reconnectTimer: NodeJS.Timeout | null;
  reconnectAttempts: number;
  config: {
    reconnectDelay?: number;
    maxReconnectDelay?: number;
    reconnectJitter?: number;
    maxReconnectAttempts?: number;
    reconnectResetAfterMs?: number;
  };
  credentials: object | null;
  preConnectContext: undefined;
  connect: jest.Mock;
  handleReconnect: () => void;
};

describe('MarketDataGateway reconnect control handling', () => {
  it('suppresses reconnect when a fatal control message was recorded before close', () => {
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
    const gateway = Object.create(MarketDataGateway.prototype) as ReconnectHarness;
    gateway.source = 'dhan_stream';
    gateway.logger = { debug: jest.fn(), error: jest.fn(), info: jest.fn() };
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

  it('dedupes reconnect timers and applies capped jittered backoff', () => {
    jest.useFakeTimers();
    const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5);
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const gateway = Object.create(MarketDataGateway.prototype) as ReconnectHarness;
    gateway.source = 'dhan_stream';
    gateway.logger = { debug: jest.fn(), error: jest.fn(), info: jest.fn() };
    gateway.lastFatalControlMessage = null;
    gateway.reconnectTimer = null;
    gateway.reconnectAttempts = 3;
    gateway.config = {
      reconnectDelay: 5000,
      maxReconnectDelay: 30000,
      reconnectJitter: 1000,
      maxReconnectAttempts: 5,
    };
    gateway.credentials = { api_key: 'token' };
    gateway.preConnectContext = undefined;
    gateway.connect = jest.fn().mockResolvedValue(undefined);

    gateway.handleReconnect();
    gateway.handleReconnect();

    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 30500);
    expect(gateway.logger.debug).toHaveBeenCalledWith(
      { source: 'dhan_stream' },
      'Reconnect already scheduled; skipping duplicate request',
    );

    jest.advanceTimersByTime(30500);

    expect(gateway.connect).toHaveBeenCalledTimes(1);
    expect(gateway.reconnectTimer).toBeNull();

    randomSpy.mockRestore();
    setTimeoutSpy.mockRestore();
    consoleSpy.mockRestore();
    jest.useRealTimers();
  });

  it('does not reset reconnect attempts across repeated short authenticated closes and stops at max attempts', () => {
    jest.useFakeTimers();
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
    const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const gateway = Object.create(MarketDataGateway.prototype) as ReconnectHarness & {
      isAuthenticated: boolean;
      awaitingPostAuth: boolean;
      clearReconnectTimer: jest.Mock;
      resubscribeAll: jest.Mock;
      startTradingKeepalive: jest.Mock;
      markConnectionReady: (resolveConnect?: () => void) => void;
      resetReconnectAttemptsAfterStableClose: (uptimeMs: number | null) => void;
    };
    gateway.source = 'dhan_trading';
    gateway.logger = { debug: jest.fn(), error: jest.fn(), info: jest.fn() };
    gateway.lastFatalControlMessage = null;
    gateway.reconnectTimer = null;
    gateway.config = {
      reconnectDelay: 1_000,
      maxReconnectAttempts: 5,
      reconnectResetAfterMs: 60_000,
    };
    gateway.reconnectAttempts = 0;
    gateway.awaitingPostAuth = true;
    gateway.credentials = { api_key: 'token' };
    gateway.preConnectContext = undefined;
    gateway.connect = jest.fn().mockResolvedValue(undefined);
    gateway.clearReconnectTimer = jest.fn();
    gateway.resubscribeAll = jest.fn();
    gateway.startTradingKeepalive = jest.fn();

    for (let cycle = 1; cycle <= 5; cycle += 1) {
      gateway.markConnectionReady();
      gateway.resetReconnectAttemptsAfterStableClose(1_000);
      gateway.handleReconnect();

      expect(gateway.reconnectAttempts).toBe(cycle);
      expect(gateway.reconnectTimer).not.toBeNull();
      jest.clearAllTimers();
      gateway.reconnectTimer = null;
    }

    gateway.markConnectionReady();
    gateway.resetReconnectAttemptsAfterStableClose(1_000);
    gateway.handleReconnect();

    expect(gateway.reconnectAttempts).toBe(5);
    expect(setTimeoutSpy).toHaveBeenCalledTimes(5);
    expect(consoleErrorSpy).toHaveBeenCalledWith('[dhan_trading] Max reconnection attempts reached');

    setTimeoutSpy.mockRestore();
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    jest.useRealTimers();
  });

  it('resets reconnect attempts only after configured stable close uptime', () => {
    const gateway = Object.create(MarketDataGateway.prototype) as ReconnectHarness & {
      resetReconnectAttemptsAfterStableClose: (uptimeMs: number | null) => void;
    };
    gateway.source = 'dhan_trading';
    gateway.logger = {
      debug: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
    };
    gateway.config = { reconnectResetAfterMs: 60_000 };
    gateway.reconnectAttempts = 4;

    gateway.resetReconnectAttemptsAfterStableClose(59_999);
    expect(gateway.reconnectAttempts).toBe(4);

    gateway.resetReconnectAttemptsAfterStableClose(60_000);
    expect(gateway.reconnectAttempts).toBe(0);
  });

  it('shares one in-flight connect promise across concurrent connect calls', async () => {
    let resolveConnect: (() => void) | undefined;
    const inFlight = new Promise<void>((resolve) => {
      resolveConnect = resolve;
    });
    const gateway = Object.create(MarketDataGateway.prototype) as {
      ws: null;
      connectPromise: Promise<void> | null;
      credentials: object | null;
      preConnectContext: null;
      connectSocket: jest.Mock;
      connect: MarketDataGateway['connect'];
    };
    gateway.ws = null;
    gateway.connectPromise = null;
    gateway.credentials = null;
    gateway.preConnectContext = null;
    gateway.connectSocket = jest.fn().mockReturnValue(inFlight);

    const first = gateway.connect({ api_key: 'token' });
    const second = gateway.connect({ api_key: 'token' });

    expect(first).toBe(second);
    expect(gateway.connectSocket).toHaveBeenCalledTimes(1);

    resolveConnect?.();
    await first;
    expect(gateway.connectPromise).toBeNull();
  });
});
