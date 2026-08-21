import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SafeHttpFetcher } from './safe-fetcher';
import { WebIngestionService } from './web-ingestion.service';
import {
  DisabledPageRenderer,
  PageRenderer,
  PlaywrightPageRenderer,
} from './renderer';

/**
 * Outbound web fetching, in one module.
 *
 * The renderer is bound by a factory rather than by a class so the rest of the
 * system depends on the PageRenderer PORT: with WEB_RENDER_ENABLED off nothing
 * can even reach the Playwright adapter, and `playwright` is never imported.
 */
@Module({
  providers: [
    SafeHttpFetcher,
    WebIngestionService,
    {
      provide: PageRenderer,
      inject: [ConfigService],
      useFactory: (config: ConfigService): PageRenderer =>
        config.get<boolean>('webIngestion.renderEnabled', false)
          ? new PlaywrightPageRenderer(config)
          : new DisabledPageRenderer(),
    },
  ],
  exports: [WebIngestionService, SafeHttpFetcher],
})
export class WebIngestionModule {}
