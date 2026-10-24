/**
 * Obsidian Duet Agent - Fastify Server Factory
 */

import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { companionConfig } from '../config.js';
import { CompanionDatabase } from '../storage/database.js';
import { DatabaseMigrator } from '../storage/migrations.js';
import { CompanionRepository } from '../storage/repository.js';
import { CompanionAuthManager } from './auth.js';
import { ProviderRegistry } from '../providers/registry.js';
import { TaskQueue } from '../tasks/queue.js';
import { TaskRecoveryService } from '../tasks/recovery.js';
import { PermissionPolicyEnforcer } from '../tools/policies.js';
import { MultiAgentRuntime } from '../agents/runtime.js';
import { registerCompanionRoutes } from './routes.js';

export function createCompanionServer(customDbPath?: string): {
  app: FastifyInstance;
  db: CompanionDatabase;
  auth: CompanionAuthManager;
  repo: CompanionRepository;
  runtime: MultiAgentRuntime;
} {
  const app = Fastify({
    logger: false,
    requestTimeout: 120000,
  });

  app.register(cors, {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  });

  const db = new CompanionDatabase(customDbPath);
  const migrator = new DatabaseMigrator(db.getRawDb());
  migrator.runMigrations();

  const repo = new CompanionRepository(db.getRawDb());
  const recoveryService = new TaskRecoveryService(repo);
  recoveryService.runRecovery();

  const auth = new CompanionAuthManager(repo);
  const token = auth.getOrCreatePairingToken();

  const providers = new ProviderRegistry();
  const queue = new TaskQueue(repo);
  const enforcer = new PermissionPolicyEnforcer();
  const runtime = new MultiAgentRuntime(providers, queue, enforcer);

  const startTime = Date.now();
  registerCompanionRoutes(app, auth, repo, runtime, providers, startTime);

  return { app, db, auth, repo, runtime };
}
