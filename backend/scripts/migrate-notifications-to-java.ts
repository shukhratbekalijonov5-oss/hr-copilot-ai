/**
 * One-time backfill: legacy NestJS notification rows → the Java
 * Notification Service (the authoritative store since the Java migration).
 *
 *   ts-node --compiler-options '{"module":"CommonJS"}' scripts/migrate-notifications-to-java.ts
 *
 * Idempotent BY THE TARGET's unique constraint: every legacy row travels as
 * eventId `legacy:{id}`, so a re-run (or a crash mid-way) re-sends rows the
 * Java side answers "duplicate" for and imports nothing twice. Preserves
 * recipient, type, audience, organization scope, read state and creation
 * time. Reads only — the legacy table is left untouched as an archive.
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  NotificationServiceClient,
  type LegacyImportRow,
} from '../src/notifications/notification-service.client';

const BATCH = 200;

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const logger = new Logger('NotificationBackfill');
  const prisma = app.get(PrismaService);
  const client = app.get(NotificationServiceClient);

  let cursor: string | undefined;
  let imported = 0;
  let duplicates = 0;
  for (;;) {
    const rows = await prisma.notification.findMany({
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
    });
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1].id;

    const payload: LegacyImportRow[] = rows.map((row) => ({
      eventId: `legacy:${row.id}`,
      recipientUserId: row.recipientUserId,
      type: row.type,
      audience: row.audience,
      organizationId: row.organizationId,
      readAt: row.readAt ? row.readAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      context: {
        vacancyId: row.vacancyId ?? undefined,
        vacancyTitle: row.vacancyTitleSnapshot ?? undefined,
        candidateId: row.candidateId ?? undefined,
        candidateName: row.candidateNameSnapshot ?? undefined,
        actorName: row.actorNameSnapshot ?? undefined,
        applicationId: row.applicationId ?? undefined,
        conversationId: row.conversationId ?? undefined,
        messageId: row.messageId ?? undefined,
        messagePreview: row.messagePreview ?? undefined,
      },
    }));
    const result = await client.importLegacy(payload);
    imported += result.imported;
    duplicates += result.duplicates;
    logger.log(
      `Batch of ${rows.length}: ${result.imported} imported, ${result.duplicates} duplicates`,
    );
  }

  logger.log(`Backfill done: ${imported} imported, ${duplicates} duplicates`);
  await app.close();
}

void main();
