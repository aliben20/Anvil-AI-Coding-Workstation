/**
 * Obsidian Duet Agent - Security & Permission Policies
 * Strict path canonicalization, symlink/junction escape blocking, terminal allowlists, and browser URL filtering.
 */

import fs from 'fs';
import path from 'path';

export class PermissionPolicyEnforcer {
  private approvedRoots: Set<string> = new Set();
  private allowedExecutables: Set<string> = new Set(['git', 'npm', 'node', 'python', 'cargo', 'bun', 'tsc']);
  private allowedDomains: Set<string> = new Set(['github.com', 'obsidian.md', 'docs.anthropic.com', 'platform.openai.com', 'wikipedia.org']);

  constructor(initialRoots: string[] = []) {
    for (const r of initialRoots) {
      this.addApprovedRoot(r);
    }
  }

  public addApprovedRoot(rootPath: string): void {
    if (!rootPath) return;
    try {
      const resolved = path.resolve(rootPath);
      const canonical = fs.existsSync(resolved) ? fs.realpathSync(resolved) : resolved;
      this.approvedRoots.add(canonical.toLowerCase());
    } catch {
      this.approvedRoots.add(path.resolve(rootPath).toLowerCase());
    }
  }

  public removeApprovedRoot(rootPath: string): void {
    const canonical = path.resolve(rootPath).toLowerCase();
    this.approvedRoots.delete(canonical);
  }

  public getApprovedRoots(): string[] {
    return Array.from(this.approvedRoots);
  }

  /**
   * Validates that targetPath is strictly inside one of the approved project roots.
   * Resolves symlinks and Windows junctions to prevent escape attacks.
   */
  public validateProjectPath(targetPath: string): string {
    if (!targetPath || typeof targetPath !== 'string') {
      throw new Error('Path validation failed: Target path is required.');
    }

    // Check for null bytes and illegal device names
    if (targetPath.includes('\0') || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(path.basename(targetPath))) {
      throw new Error(`Security Exception: Path contains illegal control characters or device names: '${targetPath}'`);
    }

    const resolved = path.resolve(targetPath);
    let canonical = resolved;
    if (fs.existsSync(resolved)) {
      try {
        canonical = fs.realpathSync(resolved);
      } catch {
        canonical = resolved;
      }
    } else {
      // Check existing parent directory realpath
      let cur = path.dirname(resolved);
      while (cur !== path.dirname(cur)) {
        if (fs.existsSync(cur)) {
          const parentReal = fs.realpathSync(cur);
          canonical = path.join(parentReal, path.relative(cur, resolved));
          break;
        }
        cur = path.dirname(cur);
      }
    }

    const canonicalLower = canonical.toLowerCase();

    // Block sensitive directories
    const sensitive = ['.ssh', '.aws', '.git', 'appdata', 'windows\\system32'];
    for (const s of sensitive) {
      if (canonicalLower.includes(path.sep + s + path.sep) || canonicalLower.endsWith(path.sep + s)) {
        throw new Error(`Security Exception: Access to sensitive path '${s}' is prohibited.`);
      }
    }

    let isWithinApproved = false;
    for (const root of this.approvedRoots) {
      if (canonicalLower === root || canonicalLower.startsWith(root + path.sep)) {
        isWithinApproved = true;
        break;
      }
    }

    if (!isWithinApproved) {
      throw new Error(
        `Access Denied: Path '${targetPath}' is outside approved project roots. Approved roots: [${Array.from(this.approvedRoots).join(', ')}]`
      );
    }

    return canonical;
  }

  /**
   * Validates terminal executable against explicit allowlist.
   */
  public validateTerminalExecutable(executable: string): string {
    const baseName = path.basename(executable).toLowerCase().replace(/\.exe$/, '');
    if (!this.allowedExecutables.has(baseName)) {
      throw new Error(
        `Command execution blocked: Executable '${executable}' is not in the approved allowlist [${Array.from(this.allowedExecutables).join(', ')}].`
      );
    }
    return baseName;
  }

  /**
   * Validates browser URL against domain allowlists and blocks internal/private IP ranges.
   */
  public validateBrowserUrl(urlString: string): URL {
    let parsed: URL;
    try {
      parsed = new URL(urlString);
    } catch {
      throw new Error(`Invalid browser URL: '${urlString}'`);
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`Invalid protocol '${parsed.protocol}'. Only http and https navigation is permitted.`);
    }

    const host = parsed.hostname.toLowerCase();

    // Block private/internal networks and cloud metadata
    if (
      host === '169.254.169.254' ||
      host === 'metadata.google.internal' ||
      host === 'instance-data'
    ) {
      throw new Error(`Security Exception: Navigation to cloud metadata service '${host}' is blocked.`);
    }

    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      host.endsWith('.local') ||
      host.endsWith('.internal')
    ) {
      throw new Error(`Security Exception: Navigation to internal/private target '${host}' is blocked.`);
    }

    let isDomainAllowed = false;
    for (const d of this.allowedDomains) {
      if (host === d || host.endsWith('.' + d)) {
        isDomainAllowed = true;
        break;
      }
    }

    if (!isDomainAllowed) {
      throw new Error(`Domain '${host}' is not in the approved browser allowlist [${Array.from(this.allowedDomains).join(', ')}].`);
    }

    return parsed;
  }
}
