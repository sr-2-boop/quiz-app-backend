import { describe, expect, it } from 'vitest';
import { keys } from '../../src/middleware/rateLimit.js';

describe('rate limiter keys', () => {
  it('keys login failures by IP + normalized URN', () => {
    const a = keys.ipAndUrn({ ip: '10.0.0.1', body: { urn: ' e25b002749 ' } });
    const b = keys.ipAndUrn({ ip: '10.0.0.1', body: { urn: 'E25B002749' } });
    const otherUrnSameIp = keys.ipAndUrn({ ip: '10.0.0.1', body: { urn: 'E25B002750' } });
    expect(a).toBe(b);
    expect(a).not.toBe(otherUrnSameIp);
  });

  it('keys the per-URN limit by URN alone, regardless of IP', () => {
    expect(keys.urn({ ip: '1.1.1.1', body: { urn: 'e25b002749' } })).toBe(
      keys.urn({ ip: '2.2.2.2', body: { urn: 'E25B002749' } }),
    );
  });

  it('keys authenticated limits by user identity, falling back to IP', () => {
    expect(keys.user({ ip: '10.0.0.1', user: { role: 'participant', id: 'p1' } })).toBe('participant|p1');
    expect(keys.user({ ip: '10.0.0.1', user: { role: 'participant', id: 'p1' } })).not.toBe(
      keys.user({ ip: '10.0.0.1', user: { role: 'participant', id: 'p2' } }),
    );
    expect(keys.user({ ip: '10.0.0.1' })).toBe(keys.ip({ ip: '10.0.0.1' }));
  });

  it('groups IPv6 clients by subnet', () => {
    expect(keys.ip({ ip: '2001:db8:1:1::1' })).toBe(keys.ip({ ip: '2001:db8:1:1::2' }));
  });

  it('caps URN length in keys', () => {
    expect(keys.urn({ body: { urn: 'A'.repeat(500) } }).length).toBeLessThan(40);
  });
});
