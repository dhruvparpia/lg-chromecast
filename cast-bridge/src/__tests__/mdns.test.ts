import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockStop = vi.fn();
const mockDestroy = vi.fn();
const mockPublish = vi.fn().mockReturnValue({ stop: mockStop });

vi.mock('bonjour-service', () => {
  const BonjourMock = function () {
    return { publish: mockPublish, destroy: mockDestroy };
  };
  return { Bonjour: BonjourMock };
});

import { startMdns } from '../mdns.js';

describe('startMdns', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a cleanup function', () => {
    const cleanup = startMdns(8009);
    expect(typeof cleanup).toBe('function');
  });

  it('calling cleanup does not throw', () => {
    const cleanup = startMdns(8009);
    expect(() => cleanup()).not.toThrow();
  });

  it('publishes with correct service type and port', () => {
    startMdns(9999);
    expect(mockPublish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'googlecast',
        protocol: 'tcp',
        port: 9999,
      }),
    );
  });

  it('uses default friendly name', () => {
    startMdns(8009);
    expect(mockPublish).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Cast Bridge',
        txt: expect.objectContaining({ fn: 'Cast Bridge' }),
      }),
    );
  });

  it('accepts a custom friendly name', () => {
    startMdns(8009, 'Living Room TV');
    expect(mockPublish).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Living Room TV',
        txt: expect.objectContaining({ fn: 'Living Room TV' }),
      }),
    );
  });

  it('passes expected TXT record fields', () => {
    startMdns(8009);
    const txtRecord = mockPublish.mock.calls[0][0].txt;
    expect(txtRecord).toHaveProperty('id');
    expect(txtRecord).toHaveProperty('cd');
    expect(txtRecord).toHaveProperty('md', 'Chromecast Ultra');
    expect(txtRecord).toHaveProperty('ve', '05');
    expect(txtRecord).toHaveProperty('ca', '201221');
    expect(txtRecord).toHaveProperty('st', '0');
    expect(txtRecord).toHaveProperty('ic', '/setup/icon.png');
  });

  it('cleanup stops the service and destroys bonjour', () => {
    const cleanup = startMdns(8009);
    cleanup();
    expect(mockStop).toHaveBeenCalled();
    expect(mockDestroy).toHaveBeenCalled();
  });
});
