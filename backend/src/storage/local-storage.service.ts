import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import {
  StorageService,
  type StoredObject,
  type UploadInput,
} from './storage.service';

/**
 * Filesystem driver for local development, so contributors do not need R2
 * credentials to run the stack.
 *
 * `getSignedUrl` returns a URL to this backend's own download route carrying an
 * HMAC signature and expiry — the same contract as R2 from the caller's point
 * of view, without pretending the file is on a CDN.
 */
@Injectable()
export class LocalStorageService extends StorageService {
  private readonly logger = new Logger(LocalStorageService.name);
  private readonly root: string;
  private readonly secret: string;
  private readonly defaultTtl: number;
  private readonly publicBaseUrl: string;

  constructor(configService: ConfigService) {
    super();
    this.root = resolve(configService.get<string>('storage.localRoot', './storage'));
    this.secret = configService.getOrThrow<string>('auth.secretToken');
    this.defaultTtl = configService.get<number>('storage.signedUrlTtlSeconds', 900);
    const port = configService.get<number>('app.port', 3001);
    const prefix = configService.get<string>('app.globalPrefix', 'api');
    this.publicBaseUrl = `http://localhost:${port}/${prefix}`;
  }

  async upload(input: UploadInput): Promise<StoredObject> {
    const target = this.resolveKey(input.key);
    await fs.mkdir(dirname(target), { recursive: true });
    await fs.writeFile(target, input.body);
    this.logger.debug(`Stored object (${input.body.byteLength} bytes)`);
    return { storageKey: input.key, size: input.body.byteLength };
  }

  async delete(key: string): Promise<void> {
    await fs.rm(this.resolveKey(key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(this.resolveKey(key));
      return true;
    } catch {
      return false;
    }
  }

  getSignedUrl(key: string, expiresInSeconds?: number): Promise<string> {
    const expires = Math.floor(Date.now() / 1000) + (expiresInSeconds ?? this.defaultTtl);
    const signature = this.sign(key, expires);
    const url = new URL(`${this.publicBaseUrl}/documents/download`);
    url.searchParams.set('key', key);
    url.searchParams.set('expires', String(expires));
    url.searchParams.set('signature', signature);
    return Promise.resolve(url.toString());
  }

  /** Reads a stored object after verifying the signature has not expired. */
  async readSigned(key: string, expires: number, signature: string): Promise<Buffer> {
    if (!Number.isFinite(expires) || expires * 1000 < Date.now()) {
      throw new NotFoundException('Link has expired');
    }
    if (!timingSafeEquals(signature, this.sign(key, expires))) {
      throw new NotFoundException('Invalid link');
    }
    try {
      return await fs.readFile(this.resolveKey(key));
    } catch {
      throw new NotFoundException('Object not found');
    }
  }

  private sign(key: string, expires: number): string {
    return createHmac('sha256', this.secret)
      .update(`${key}:${expires}`)
      .digest('hex');
  }

  /** Refuses any key that would escape the storage root via `..`. */
  private resolveKey(key: string): string {
    const target = resolve(join(this.root, key));
    if (target !== this.root && !target.startsWith(this.root + sep)) {
      throw new NotFoundException('Invalid storage key');
    }
    return target;
  }
}

function timingSafeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
