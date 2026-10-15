import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM for signed raw transactions at rest. The action ID is authenticated data, so a
 * ciphertext copied onto another attempt row fails to decrypt.
 */
export class AttemptCipher {
  private readonly key: Buffer;

  constructor(key: string) {
    const decoded = /^[0-9a-fA-F]{64}$/.test(key) ? Buffer.from(key, 'hex') : Buffer.alloc(0);
    if (decoded.length !== 32) throw new Error('ATTEMPT_ENCRYPTION_KEY must be 32 bytes of hex');
    this.key = decoded;
  }

  encrypt(plaintext: string, actionId: string): Buffer {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(actionId, 'utf8'));
    const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]);
  }

  decrypt(payload: Uint8Array, actionId: string): string {
    const data = Buffer.from(payload);
    if (data.length < 29) throw new Error('Invalid attempt ciphertext');
    const decipher = createDecipheriv('aes-256-gcm', this.key, data.subarray(0, 12));
    decipher.setAAD(Buffer.from(actionId, 'utf8'));
    decipher.setAuthTag(data.subarray(12, 28));
    return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8');
  }
}
