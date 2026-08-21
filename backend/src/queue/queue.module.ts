import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RESUME_PROCESSING_QUEUE } from './queue.constants';
import { DocumentProcessingProducer } from './document-processing.producer';
import { DocumentProcessingProcessor } from './document-processing.processor';
import { ProcessingModule } from '../processing/processing.module';
import { AiModule } from '../ai/ai.module';
import { WebIngestionModule } from '../web-ingestion/web-ingestion.module';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        // BullMQ needs its own connection: blocking commands require
        // maxRetriesPerRequest: null, which RedisService deliberately does not use.
        connection: {
          url: config.getOrThrow<string>('redis.url'),
          maxRetriesPerRequest: null,
        },
      }),
    }),
    BullModule.registerQueue({
      name: RESUME_PROCESSING_QUEUE,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        // Keep enough history for the UI and for debugging, bounded so Redis
        // memory does not grow without limit.
        removeOnComplete: { age: 24 * 3600, count: 1_000 },
        removeOnFail: { age: 7 * 24 * 3600, count: 5_000 },
      },
    }),
    ProcessingModule,
    AiModule,
    // The worker owns candidate-link fetching: a URL fetch is slow, fails, and
    // must retry with backoff — exactly what a queue is for, and exactly what
    // must never happen inside a request transaction.
    WebIngestionModule,
  ],
  providers: [DocumentProcessingProducer, DocumentProcessingProcessor],
  exports: [DocumentProcessingProducer, BullModule],
})
export class QueueModule {}
