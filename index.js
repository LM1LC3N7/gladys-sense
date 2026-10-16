// -----------------------------------------------------------------------------
// Entry point: SDK wiring only. Every handler is registered BEFORE connect(),
// and delegates to the SenseApp (src/app.js).
//
// Environment variables provided by the Gladys supervisor, read by the SDK:
// GLADYS_HOST_API_URL, GLADYS_INTEGRATION_TOKEN, GLADYS_INTEGRATION_SELECTOR.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { SenseApp } from './src/app.js';
import { ACTIONS } from './src/constants.js';

const gladys = new GladysIntegration();
const app = new SenseApp({ gladys });

// --- Discovery -------------------------------------------------------------------
gladys.onScanRequest(() => app.scan());
gladys.onDeviceCreated((device) => app.deviceCreated(device));

// --- Configuration screen buttons ----------------------------------------------
gladys.onAction(ACTIONS.TEST, () => app.testConnection());
gladys.onAction(ACTIONS.MFA, (fields) => app.verifyMfa(fields));

// --- Configuration changed by the user ----------------------------------------
gladys.onConfigUpdated((config) => {
  logger.info('Configuration updated');
  return app.configUpdated(config);
});

// --- Connection lifecycle ------------------------------------------------------
gladys.on('connected', async () => {
  try {
    await app.start(await gladys.getConfig());
  } catch (err) {
    logger.error('Start failed', err);
  }
});
gladys.on('disconnected', () => {
  app.stop().catch((err) => logger.error('Stop failed', err));
});
gladys.handleShutdown(() => app.stop());

logger.info('Starting the Sense integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
