import { DEFAULTS } from '../../config/constants.js';

export const DELIVERY_RETRY_CONFIG = {
  attempts: DEFAULTS.DELIVERY_MAX_ATTEMPTS,
  backoff: {
    type: 'exponential' as const,
    delay: DEFAULTS.DELIVERY_BACKOFF_BASE_MS,
  },
};
