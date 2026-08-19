/**
 * Storage abstraction.
 *
 * Business code depends on this interface only, never on a concrete driver, so
 * swapping local disk for R2 (or S3, or GCS) is a module-level change. Storage
 * credentials never leave the backend: the frontend receives short-lived signed
 * URLs produced here, and nothing else.
 */
export interface StoredObject {
  storageKey: string;
  size: number;
}

export interface UploadInput {
  /** Tenant-prefixed key. See StorageService.buildKey. */
  key: string;
  body: Buffer;
  contentType: string;
  /** Preserved for content-disposition on download. */
  originalFileName?: string;
}

export abstract class StorageService {
  abstract upload(input: UploadInput): Promise<StoredObject>;
  abstract delete(key: string): Promise<void>;
  /** Time-limited read URL; TTL comes from storage.signedUrlTtlSeconds. */
  abstract getSignedUrl(key: string, expiresInSeconds?: number): Promise<string>;
  abstract exists(key: string): Promise<boolean>;

  /**
   * Keys are always prefixed with the organization id. That keeps one tenant's
   * objects in a distinct namespace and makes bucket-level auditing possible.
   */
  static buildKey(
    organizationId: string,
    documentId: string,
    originalFileName: string,
  ): string {
    const extension = extname(originalFileName);
    return `org/${organizationId}/documents/${documentId}${extension}`;
  }
}

function extname(fileName: string): string {
  const index = fileName.lastIndexOf('.');
  if (index <= 0 || index === fileName.length - 1) return '';
  // Normalise and defend against path segments smuggled in via the filename.
  return fileName.slice(index).toLowerCase().replace(/[^a-z0-9.]/g, '');
}
