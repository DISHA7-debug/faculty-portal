import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { UNKNOWN_IP, clientIpFromHeaders } from '@/lib/request-ip';

const h = (init: Record<string, string>) => new Headers(init);

/**
 * These are the tests that keep every IP-keyed control honest. If a client can choose the
 * IP attributed to them, the login throttle, signup cap, and stuffing detection are all
 * bypassable by rotating a header value.
 */
describe('clientIpFromHeaders', () => {
  it('prefers X-Real-IP, which Caddy overwrites and a client cannot forge', () => {
    const headers = h({
      'x-real-ip': '203.0.113.9',
      'x-forwarded-for': '1.2.3.4, 203.0.113.9',
    });
    assert.equal(clientIpFromHeaders(headers), '203.0.113.9');
  });

  it('ATTACK: a forged X-Forwarded-For prefix is ignored', () => {
    // Client sends "X-Forwarded-For: 1.2.3.4"; Caddy APPENDS what it actually saw.
    // Reading the leftmost entry — the conventional mistake — returns the attacker's value.
    const headers = h({ 'x-forwarded-for': '1.2.3.4, 203.0.113.9' });
    const resolved = clientIpFromHeaders(headers);

    assert.equal(resolved, '203.0.113.9', 'must read the rightmost, proxy-written entry');
    assert.notEqual(resolved, '1.2.3.4', 'must never trust the client-supplied prefix');
  });

  it('ATTACK: a long forged chain still resolves to the proxy-written entry', () => {
    const headers = h({
      'x-forwarded-for': '10.0.0.1, 10.0.0.2, 10.0.0.3, 10.0.0.4, 198.51.100.77',
    });
    assert.equal(clientIpFromHeaders(headers), '198.51.100.77');
  });

  it('ATTACK: forging X-Real-IP alone does not survive, because Caddy overwrites it', () => {
    // Simulates what reaches the app: Caddy replaced the client's value with the peer.
    const forgedButOverwritten = h({ 'x-real-ip': '203.0.113.9' });
    assert.equal(clientIpFromHeaders(forgedButOverwritten), '203.0.113.9');
  });

  it('counts in from the right by trusted-proxy depth', () => {
    const headers = h({ 'x-forwarded-for': 'client, cdn, caddy' });
    // Two proxies (CDN + Caddy): the client is the second entry from the right.
    assert.equal(clientIpFromHeaders(h({ 'x-forwarded-for': '1.1.1.1, 2.2.2.2, 3.3.3.3' }), 2), '2.2.2.2');
    assert.equal(clientIpFromHeaders(h({ 'x-forwarded-for': '1.1.1.1, 2.2.2.2, 3.3.3.3' }), 1), '3.3.3.3');
    void headers;
  });

  it('clamps rather than under-reading when the chain is shorter than configured', () => {
    // A short header means no attacker prefix survived, so the leftmost real entry is safe.
    assert.equal(clientIpFromHeaders(h({ 'x-forwarded-for': '203.0.113.9' }), 3), '203.0.113.9');
  });

  it('falls back to UNKNOWN_IP with no trusted header', () => {
    assert.equal(clientIpFromHeaders(h({})), UNKNOWN_IP);
  });

  it('ignores junk entries rather than keying Redis on them', () => {
    assert.equal(
      clientIpFromHeaders(h({ 'x-forwarded-for': '<script>, 203.0.113.9' })),
      '203.0.113.9',
    );
    assert.equal(clientIpFromHeaders(h({ 'x-forwarded-for': 'not-an-ip' })), UNKNOWN_IP);
  });

  it('strips ports and IPv6 brackets', () => {
    assert.equal(clientIpFromHeaders(h({ 'x-real-ip': '203.0.113.9:54321' })), '203.0.113.9');
    assert.equal(clientIpFromHeaders(h({ 'x-real-ip': '[2001:db8::1]' })), '2001:db8::1');
  });

  it('preserves a bare IPv6 address', () => {
    assert.equal(clientIpFromHeaders(h({ 'x-real-ip': '2001:db8::1' })), '2001:db8::1');
  });
});
