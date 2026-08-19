import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  StorageService,
  type StoredObject,
  type UploadInput,
} from './storage.service';

/**
 * Cloudflare R2 driver (S3-compatible API).
 *
 * Credentials live only in this process. The frontend never receives them —
 * it only ever gets a presigned, expiring URL from getSignedUrl().
 */
@Injectable()
export class R2StorageService extends StorageService {
  private readonly logger = new Logger(R2StorageService.name);
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly defaultTtl: number;

  constructor(configService: ConfigService) {
    super();
    const accountId = configService.getOrThrow<string>('storage.r2.accountId');
    this.bucket = configService.getOrThrow<string>('storage.r2.bucket');
    this.defaultTtl = configService.get<number>(
      'storage.signedUrlTtlSeconds',
      900,
    );

    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: configService.getOrThrow<string>('storage.r2.accessKeyId'),
        secretAccessKey: configService.getOrThrow<string>(
          'storage.r2.secretAccessKey',
        ),
      },
    });
    // Log the driver, never the endpoint or credentials.
    this.logger.log('R2 storage driver initialised');
  }

  async upload(input: UploadInput): Promise<StoredObject> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
        ...(input.originalFileName
          ? {
              ContentDisposition: `attachment; filename="${sanitiseFileName(
                input.originalFileName,
              )}"`,
            }
          : {}),
      }),
    );
    return { storageKey: input.key, size: input.body.byteLength };
  }

  async getObject(key: string): Promise<Buffer> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    const body = response.Body;
    if (!body) {
      throw new Error(`R2 object ${key} returned no body`);
    }
    return Buffer.from(await body.transformToByteArray());
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  getSignedUrl(key: string, expiresInSeconds?: number): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: expiresInSeconds ?? this.defaultTtl },
    );
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return true;
    } catch {
      return false;
    }
  }
}

/** Strips quotes/control characters that would break the header. */
function sanitiseFileName(name: string): string {
  return name.replace(/[\r\n"\\]/g, '_').slice(0, 200);
}
