import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import { startDial } from '../dial.js';

const TEST_PORT = 18008;

function request(
  path: string,
  method = 'GET',
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: '127.0.0.1', port: TEST_PORT, path, method },
      (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => (body += chunk.toString()));
        res.on('end', () =>
          resolve({ status: res.statusCode!, headers: res.headers, body }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
}

describe('DIAL HTTP server', () => {
  let cleanup: () => void;

  afterEach(async () => {
    if (cleanup) {
      cleanup();
      // Give the server a moment to close
      await new Promise((r) => setTimeout(r, 50));
    }
  });

  async function startAndWait(friendlyName?: string): Promise<void> {
    cleanup = startDial(TEST_PORT, friendlyName);
    // Wait for server to be listening
    await new Promise((r) => setTimeout(r, 100));
  }

  describe('GET /ssdp/device-desc.xml', () => {
    it('returns 200 with XML content-type', async () => {
      await startAndWait();
      const res = await request('/ssdp/device-desc.xml');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('application/xml');
    });

    it('contains correct device info', async () => {
      await startAndWait();
      const res = await request('/ssdp/device-desc.xml');
      expect(res.body).toContain('<friendlyName>Cast Bridge</friendlyName>');
      expect(res.body).toContain('<modelName>Chromecast Ultra</modelName>');
      expect(res.body).toContain('<manufacturer>Google Inc.</manufacturer>');
      expect(res.body).toContain('urn:dial-multiscreen-org:device:dial:1');
    });

    it('uses custom friendly name', async () => {
      await startAndWait('Kitchen Speaker');
      const res = await request('/ssdp/device-desc.xml');
      expect(res.body).toContain(
        '<friendlyName>Kitchen Speaker</friendlyName>',
      );
    });
  });

  describe('GET /apps/ChromeCast', () => {
    it('returns 200 with XML containing app state', async () => {
      await startAndWait();
      const res = await request('/apps/ChromeCast');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('application/xml');
      expect(res.body).toContain('<name>ChromeCast</name>');
      expect(res.body).toContain('<state>running</state>');
    });
  });

  describe('GET /unknown', () => {
    it('returns 404', async () => {
      await startAndWait();
      const res = await request('/unknown');
      expect(res.status).toBe(404);
    });
  });

  describe('OPTIONS request', () => {
    it('returns 204 with CORS headers', async () => {
      await startAndWait();
      const res = await request('/', 'OPTIONS');
      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe('*');
      expect(res.headers['access-control-allow-methods']).toContain('GET');
      expect(res.headers['access-control-allow-headers']).toContain(
        'Content-Type',
      );
    });
  });

  describe('common headers', () => {
    it('includes Application-URL header', async () => {
      await startAndWait();
      const res = await request('/ssdp/device-desc.xml');
      expect(res.headers['application-url']).toContain('/apps/');
    });

    it('includes Application-DIAL-Version header', async () => {
      await startAndWait();
      const res = await request('/ssdp/device-desc.xml');
      expect(res.headers['application-dial-version']).toBe('2.2');
    });
  });
});
