/** Queue and job names for exchange-rate refreshing. */
export const FX_RATES_QUEUE = 'fx-rates';
export const FX_REFRESH_JOB = 'fx-rates-refresh';

/**
 * The repeatable job's fixed id.
 *
 * BullMQ keys a repeatable by (name, id, pattern/every). Pinning the id means
 * a restart re-registers the SAME schedule instead of adding a second one, so
 * ten deploys do not produce ten refresh cycles hammering the provider.
 */
export const FX_REFRESH_REPEAT_KEY = 'fx-rates-refresh:every-30m';
