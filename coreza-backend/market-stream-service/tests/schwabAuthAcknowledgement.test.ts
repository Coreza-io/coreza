import {
  buildSchwabSubscribeMessage,
  buildSchwabUnsubscribeMessage,
  isSchwabAuthError,
  isSchwabAuthSuccess,
} from '../src/marketGateways/schwab/helpers';
import { schwabGatewayConfig } from '../src/marketGateways/schwab/config';

describe('Schwab auth acknowledgement helpers', () => {
  it('detects successful ADMIN LOGIN acknowledgements with numeric zero code', () => {
    const msg = {
      service: 'ADMIN',
      command: 'LOGIN',
      content: { code: 0, msg: 'server=example;status=OK' },
    };

    expect(isSchwabAuthSuccess(msg)).toBe(true);
    expect(isSchwabAuthError(msg)).toBe(false);
  });

  it('detects successful ADMIN LOGIN acknowledgements with string zero code', () => {
    const msg = {
      service: 'ADMIN',
      command: 'LOGIN',
      content: { code: '0', msg: 'server=example;status=OK' },
    };

    expect(isSchwabAuthSuccess(msg)).toBe(true);
    expect(isSchwabAuthError(msg)).toBe(false);
  });

  it('detects ADMIN LOGIN acknowledgements with non-zero codes as auth errors', () => {
    const msg = {
      service: 'ADMIN',
      command: 'LOGIN',
      content: { code: 3, msg: 'status=DENIED' },
    };

    expect(isSchwabAuthSuccess(msg)).toBe(false);
    expect(isSchwabAuthError(msg)).toBe(true);
  });

  it('ignores non-login Schwab control messages', () => {
    const msg = {
      service: 'LEVELONE_EQUITIES',
      command: 'SUBS',
      content: { code: 0 },
    };

    expect(isSchwabAuthSuccess(msg)).toBe(false);
    expect(isSchwabAuthError(msg)).toBe(false);
  });

  it('does not treat missing LOGIN code as an auth error', () => {
    const msg = {
      service: 'ADMIN',
      command: 'LOGIN',
      content: { msg: 'status=PENDING' },
    };

    expect(isSchwabAuthSuccess(msg)).toBe(false);
    expect(isSchwabAuthError(msg)).toBe(false);
  });
});

describe('Schwab subscription requests', () => {
  const creds = {
    schwabClientCustomerId: 'customer-123',
    schwabClientCorrelId: 'correl-456',
  };

  it('stamps Schwab client identifiers on subscribe request frames', () => {
    const msg = buildSchwabSubscribeMessage(
      ['otlk@quote'],
      'schwab_equity',
      creds,
    );
    const request = msg.requests[0];

    expect(request).toMatchObject({
      service: 'LEVELONE_EQUITIES',
      command: 'SUBS',
      SchwabClientCustomerId: 'customer-123',
      SchwabClientCorrelId: 'correl-456',
      parameters: {
        keys: 'OTLK',
        fields: '0,1,2,3,4,5,8,10,11,12,17,34,35',
      },
    });
  });

  it('stamps Schwab client identifiers on unsubscribe request frames', () => {
    const msg = buildSchwabUnsubscribeMessage(
      ['otlk@quote'],
      'schwab_equity',
      creds,
    );
    const request = msg.requests[0];

    expect(request).toMatchObject({
      service: 'LEVELONE_EQUITIES',
      command: 'UNSUBS',
      SchwabClientCustomerId: 'customer-123',
      SchwabClientCorrelId: 'correl-456',
      parameters: {
        keys: 'OTLK',
      },
    });
    expect(request.parameters).not.toHaveProperty('fields');
  });

  it('forwards credentials from the Schwab gateway config into subscribe frames', () => {
    const msg = schwabGatewayConfig.makeSubscribeMessage(
      ['otlk@quote'],
      'schwab_equity',
      creds,
    );
    const request = msg.requests[0];

    expect(request).toMatchObject({
      service: 'LEVELONE_EQUITIES',
      command: 'SUBS',
      SchwabClientCustomerId: 'customer-123',
      SchwabClientCorrelId: 'correl-456',
    });
  });
});
