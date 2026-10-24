/**
 * Obsidian Duet Agent - Windows Background Companion Service
 * Entry point for persistent execution independent of Obsidian UI.
 */

import { companionConfig } from './config.js';
import { createCompanionServer } from './api/server.js';

async function main() {
  const { app, auth } = createCompanionServer();
  const token = auth.getOrCreatePairingToken();

  try {
    const address = await app.listen({
      port: companionConfig.port,
      host: companionConfig.host,
    });

    console.log(`====================================================`);
    console.log(`Obsidian Duet Agent — Windows Companion Service v${companionConfig.version}`);
    console.log(`Endpoint: ${address}`);
    console.log(`Loopback Security: Bound strictly to ${companionConfig.host}`);
    console.log(`Pairing Token: ${token}`);
    console.log(`Status: Ready for requests from Obsidian Duet Plugin`);
    console.log(`====================================================`);

    const shutdown = async () => {
      console.log('\n[Companion] Shutting down gracefully...');
      await app.close();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (err) {
    console.error('[Companion] Failed to start server:', err);
    process.exit(1);
  }
}

main().catch(console.error);
