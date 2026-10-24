/**
 * Obsidian Duet Agent - Companion Authentication & Pairing
 * Cryptographic random token generation, SHA-256 hashing, and Fastify bearer auth middleware.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { FastifyRequest, FastifyReply } from 'fastify';
import { CompanionRepository } from '../storage/repository.js';

export class CompanionAuthManager {
  private repo: CompanionRepository;
  private tokenFilePath: string;

  constructor(repo: CompanionRepository, customDir?: string) {
    this.repo = repo;
    const baseDir = customDir || path.join(process.env.USERPROFILE || process.env.HOME || '.', '.obsidian-duet');
    fs.mkdirSync(baseDir, { recursive: true });
    this.tokenFilePath = path.join(baseDir, 'companion-token.secret');
  }

  public hashToken(token: string): string {
    return crypto.createHash('sha256').update(token.trim()).digest('hex');
  }

  /**
   * Initializes or reads the persistent secret pairing token.
   * Stored with restrictive permissions (0o600).
   */
  public getOrCreatePairingToken(): string {
    if (fs.existsSync(this.tokenFilePath)) {
      try {
        const stored = fs.readFileSync(this.tokenFilePath, 'utf-8').trim();
        if (stored.length >= 32) {
          const hash = this.hashToken(stored);
          if (!this.repo.isValidToken(hash)) {
            this.repo.savePairingToken('initial-token', hash, 'Local Obsidian Client');
          }
          return stored;
        }
      } catch {}
    }

    // Generate cryptographically secure 64-character token
    const newToken = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(this.tokenFilePath, newToken, { encoding: 'utf-8', mode: 0o600 });
    const hash = this.hashToken(newToken);
    this.repo.savePairingToken(`token-${Date.now()}`, hash, 'Initial Companion Token');
    return newToken;
  }

  public authenticateRequest(req: FastifyRequest, reply: FastifyReply): boolean {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      reply.status(401).send({ error: 'Unauthorized: Missing Bearer authorization header.' });
      return false;
    }

    const token = authHeader.slice(7).trim();
    if (!token) {
      reply.status(401).send({ error: 'Unauthorized: Empty token.' });
      return false;
    }

    const hash = this.hashToken(token);
    if (!this.repo.isValidToken(hash)) {
      reply.status(401).send({ error: 'Unauthorized: Invalid or revoked companion pairing token.' });
      return false;
    }

    return true;
  }
}
