import { bench, describe } from 'vitest';
import { generateKeyPairSync, createSign } from 'node:crypto';
import protobuf from 'protobufjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROTO_PATH = join(__dirname, '..', '..', 'proto', 'cast_channel.proto');

// ---------------------------------------------------------------------------
// Inline the cert builder so we can benchmark it without importing the server
// ---------------------------------------------------------------------------

function derLength(len: number): Buffer {
  if (len < 0x80) return Buffer.from([len]);
  if (len < 0x100) return Buffer.from([0x81, len]);
  return Buffer.from([0x82, (len >> 8) & 0xff, len & 0xff]);
}

function derTag(tag: number, content: Buffer): Buffer {
  const l = derLength(content.length);
  return Buffer.concat([Buffer.from([tag]), l, content]);
}

function derSequence(content: Buffer): Buffer {
  return derTag(0x30, content);
}

function derSet(content: Buffer): Buffer {
  return derTag(0x31, content);
}

function derUtf8String(s: string): Buffer {
  return derTag(0x0c, Buffer.from(s, 'utf-8'));
}

function derUtcTime(s: string): Buffer {
  return derTag(0x17, Buffer.from(s, 'ascii'));
}

function buildSelfSignedCert(pkDer: Buffer, pubDer: Buffer): Buffer {
  const serial = Buffer.from([0x02, 0x01, 0x01]);
  const sigAlgOid = Buffer.from([
    0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01,
    0x0b, 0x05, 0x00,
  ]);
  const cn = derUtf8String('CastV2');
  const atv = derSequence(
    Buffer.concat([Buffer.from([0x06, 0x03, 0x55, 0x04, 0x03]), cn]),
  );
  const rdn = derSet(atv);
  const name = derSequence(rdn);
  const notBefore = derUtcTime('250101000000Z');
  const notAfter = derUtcTime('350101000000Z');
  const validity = derSequence(Buffer.concat([notBefore, notAfter]));
  const version = Buffer.from([0xa0, 0x03, 0x02, 0x01, 0x02]);
  const tbs = derSequence(
    Buffer.concat([version, serial, sigAlgOid, name, validity, name, pubDer]),
  );
  const signer = createSign('SHA256');
  signer.update(tbs);
  signer.end();
  const signature = signer.sign({
    key: Buffer.from(pkDer),
    format: 'der',
    type: 'pkcs8',
  });
  const sigBits = Buffer.concat([Buffer.from([0x00]), signature]);
  const sigBitString = derTag(0x03, sigBits);
  return derSequence(Buffer.concat([tbs, sigAlgOid, sigBitString]));
}

function derToPem(der: Buffer, label: string): string {
  const b64 = der.toString('base64');
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += 64) {
    lines.push(b64.slice(i, i + 64));
  }
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`;
}

function generateSelfSignedCert(): { key: string; cert: string } {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const pkDer = privateKey.export({ type: 'pkcs8', format: 'der' }) as Buffer;
  const pubDer = publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
  const certDer = buildSelfSignedCert(pkDer, pubDer);
  const keyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
  const certPem = derToPem(certDer, 'CERTIFICATE');
  return { key: keyPem, cert: certPem };
}

// ---------------------------------------------------------------------------
// Benchmarks
// ---------------------------------------------------------------------------

describe('TLS cert generation', () => {
  bench('generateSelfSignedCert', () => {
    generateSelfSignedCert();
  });
});

describe('Protobuf schema loading', () => {
  bench('protobuf.load (cold)', async () => {
    const r = await protobuf.load(PROTO_PATH);
    r.lookupType('extensions.api.cast_channel.CastMessage');
  });
});
