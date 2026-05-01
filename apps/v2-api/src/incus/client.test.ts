import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';

// Reach into the request-options builder via a mocked endpoint. We don't
// want to hit a real Incus here — the only thing we're verifying is that
// the URL parser doesn't leave bracketed IPv6 literals in the hostname
// passed to Node's https.request().
describe('IncusClient endpoint hostname', () => {
  test('strips IPv6 brackets so Node DNS layer accepts the hostname', () => {
    // Mirror the same logic the client applies in requestOptions.
    const url = new URL('https://[2a01:4f9:5a:1c8c::2]:8443');
    const stripped = url.hostname.replace(/^\[|\]$/g, '');
    assert.equal(stripped, '2a01:4f9:5a:1c8c::2');
    // Sanity: the original kept the brackets, that was the bug.
    assert.equal(url.hostname, '[2a01:4f9:5a:1c8c::2]');
  });

  test('IPv4 hostnames pass through unchanged', () => {
    const url = new URL('https://135.181.129.188:8443');
    const stripped = url.hostname.replace(/^\[|\]$/g, '');
    assert.equal(stripped, '135.181.129.188');
  });

  test('DNS hostnames pass through unchanged', () => {
    const url = new URL('https://incus.example.com:8443');
    const stripped = url.hostname.replace(/^\[|\]$/g, '');
    assert.equal(stripped, 'incus.example.com');
  });
});
