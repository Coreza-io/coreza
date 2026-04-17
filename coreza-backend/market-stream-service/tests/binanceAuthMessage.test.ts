import { createHmac } from 'crypto';

jest.mock('../src/utils/binanceTimeSync', () => ({
  getBinanceTimestamp: jest.fn(),
}));

import { buildBinanceAuthMessage } from '../src/marketGateways/binance/helpers';
import { getBinanceTimestamp } from '../src/utils/binanceTimeSync';

describe('buildBinanceAuthMessage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses synced timestamp and includes recvWindow in signature + params', () => {
    (getBinanceTimestamp as jest.Mock).mockReturnValue(1710000000123);

    const creds = {
      api_key: 'api-key',
      secret_key: 'secret-key',
      environment: 'testnet',
      marketType: 'spot',
    };

    const msg = buildBinanceAuthMessage(creds, 'binance_trading');

    expect(getBinanceTimestamp).toHaveBeenCalledWith('testnet', 'spot');
    expect(msg?.params).toMatchObject({
      apiKey: 'api-key',
      recvWindow: 60000,
      timestamp: 1710000000123,
    });

    const expectedQuery = 'apiKey=api-key&recvWindow=60000&timestamp=1710000000123';
    const expectedSignature = createHmac('sha256', 'secret-key').update(expectedQuery).digest('hex');

    expect(msg?.params.signature).toBe(expectedSignature);
  });

  it('builds session.logon message for futures trading auth path', () => {
    const msg = buildBinanceAuthMessage(
      {
        api_key: 'api-key',
        secret_key: 'secret-key',
        environment: 'live',
        marketType: 'futures',
      },
      'binance_trading',
    );

    expect(getBinanceTimestamp).toHaveBeenCalledWith("live", "futures");
    expect(msg).toMatchObject({
      id: "session-logon",
      method: "session.logon",
      params: {
        apiKey: "api-key",
        recvWindow: 60000,
      },
    });
  });
});
