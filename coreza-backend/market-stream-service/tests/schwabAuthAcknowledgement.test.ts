import {
  isSchwabAuthError,
  isSchwabAuthSuccess,
} from '../src/marketGateways/schwab/helpers';

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
