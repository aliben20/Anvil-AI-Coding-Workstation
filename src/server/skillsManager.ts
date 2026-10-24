/**
 * @license MIT
 * OBSIDIAN Skills Engine & Manager
 *
 * Implements the Agent Skills convention (`SKILL.md` with YAML frontmatter):
 * - Progressive disclosure: lightweight metadata summaries for discovery; full instructions on activation
 * - Strict security: path traversal protection, input sanitization, safe path resolution
 * - Dual-scope support: Global skills (.anvil-data/skills) and Workspace skills (<workspace>/.anvil/skills)
 * - Selective runtime matching: zero skill pollution on greetings; high precision on domain requests
 * - Full CRUD, import from directory/file, and persistence of enabled/disabled states
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  SkillCategory,
  SkillDefinition,
  SkillScope,
  SkillSummary,
  SkillValidationStatus,
} from '../types.js';

export interface IWorkspacePathResolver {
  getWorkspaceRoot(workspaceId: string): string;
}

const VALID_CATEGORIES: Set<SkillCategory> = new Set([
  'build',
  'code',
  'debug',
  'security',
  'testing',
  'ui',
  'general',
]);

const SKILL_ID_REGEX = /^[a-z0-9][a-z0-9_-]{1,63}$/;
const GREETING_PROMPT_REGEX =
  /^(hi|hello|hey|yo|sup|greetings|good\s+(morning|afternoon|evening|day)|thanks|thank\s+you|who\s+are\s+you|what\s+can\s+you\s+do|howdy|ok|okay)[\s.?!]*$/i;

interface SkillsState {
  disabledSkills: Record<string, boolean>;
}

export class SkillsManager {
  private globalSkillsDir: string;
  private stateFilePath: string;
  private workspaceResolver: IWorkspacePathResolver;
  private watchers = new Map<string, fs.FSWatcher>();
  private changeListeners: Array<(workspaceId?: string) => void> = [];
  private debounceTimer: NodeJS.Timeout | null = null;

  constructor(dataDir: string, workspaceResolver: IWorkspacePathResolver) {
    this.globalSkillsDir = path.join(dataDir, 'skills');
    this.stateFilePath = path.join(this.globalSkillsDir, 'skills-state.json');
    this.workspaceResolver = workspaceResolver;

    fs.mkdirSync(this.globalSkillsDir, { recursive: true });
    this.seedBuiltinSkills();
  }

  // ---------------------------------------------------------------------------
  // Change Listeners & File Watching
  // ---------------------------------------------------------------------------
  public onSkillsChanged(callback: (workspaceId?: string) => void): () => void {
    this.changeListeners.push(callback);
    return () => {
      this.changeListeners = this.changeListeners.filter((cb) => cb !== callback);
    };
  }

  private notifySkillsChanged(workspaceId?: string): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      for (const listener of this.changeListeners) {
        try {
          listener(workspaceId);
        } catch (err) {
          console.error('[SkillsManager] Error notifying skills change listener:', err);
        }
      }
    }, 250);
    if (typeof this.debounceTimer.unref === 'function') {
      this.debounceTimer.unref();
    }
  }

  public setupWatchers(workspaceIds?: string[]): void {
    const candidateDirs = new Set<string>();

    for (const gDir of this.getGlobalSkillDirs()) {
      if (fs.existsSync(gDir)) {
        candidateDirs.add(path.resolve(gDir));
      }
    }

    if (workspaceIds) {
      for (const wsId of workspaceIds) {
        for (const wsDir of this.getWorkspaceSkillDirs(wsId)) {
          if (fs.existsSync(wsDir)) {
            candidateDirs.add(path.resolve(wsDir));
          }
        }
      }
    }

    // Stop watchers no longer in candidate list
    for (const [watchedPath, watcher] of this.watchers.entries()) {
      if (!candidateDirs.has(watchedPath)) {
        try {
          watcher.close();
        } catch {}
        this.watchers.delete(watchedPath);
      }
    }

    // Start watchers for newly discovered directories
    for (const dir of candidateDirs) {
      if (!this.watchers.has(dir)) {
        try {
          const watcher = fs.watch(dir, { recursive: true }, (_eventType, _filename) => {
            this.notifySkillsChanged();
          });
          if (typeof watcher.unref === 'function') {
            watcher.unref();
          }
          watcher.on('error', () => {
            try {
              watcher.close();
            } catch {}
            this.watchers.delete(dir);
          });
          this.watchers.set(dir, watcher);
        } catch {
          // Permissions or filesystem lack recursive watch support on specific directory
        }
      }
    }
  }

  public rescan(workspaceIds?: string[]): void {
    this.setupWatchers(workspaceIds);
    this.notifySkillsChanged();
  }

  public dispose(): void {
    for (const watcher of this.watchers.values()) {
      try {
        watcher.close();
      } catch {}
    }
    this.watchers.clear();
    this.changeListeners = [];
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  // ---------------------------------------------------------------------------
  // State Management (enabled / disabled persistence)
  // ---------------------------------------------------------------------------
  private loadState(): SkillsState {
    if (!fs.existsSync(this.stateFilePath)) {
      return { disabledSkills: {} };
    }
    try {
      const raw = fs.readFileSync(this.stateFilePath, 'utf-8');
      return JSON.parse(raw);
    } catch {
      return { disabledSkills: {} };
    }
  }

  private saveState(state: SkillsState): void {
    try {
      fs.writeFileSync(this.stateFilePath, JSON.stringify(state, null, 2), 'utf-8');
    } catch (err) {
      console.error('[SkillsManager] Failed to save skills state:', err);
    }
  }

  private isSkillEnabled(skillId: string): boolean {
    const state = this.loadState();
    return !state.disabledSkills[skillId];
  }

  public setSkillEnabled(skillId: string, enabled: boolean): boolean {
    const sanitizedId = this.sanitizeId(skillId);
    const state = this.loadState();
    if (enabled) {
      delete state.disabledSkills[sanitizedId];
    } else {
      state.disabledSkills[sanitizedId] = true;
    }
    this.saveState(state);
    return true;
  }

  // ---------------------------------------------------------------------------
  // ID Sanitization & Path Safety
  // ---------------------------------------------------------------------------
  public sanitizeId(rawId: string): string {
    const raw = String(rawId || '').trim();
    if (!raw || raw.includes('/') || raw.includes('\\') || raw.includes('..')) {
      throw new Error(
        `Invalid skill ID "${rawId}". IDs cannot contain directory separators or traversal characters.`
      );
    }

    const clean = raw
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '-')
      .replace(/--+/g, '-')
      .replace(/^-|-$/g, '');
    if (!SKILL_ID_REGEX.test(clean)) {
      throw new Error(
        `Invalid skill ID "${rawId}". IDs must be 2-64 characters matching [a-z0-9_-].`
      );
    }
    return clean;
  }

  private assertSafePath(baseDir: string, targetPath: string): void {
    const normalizedBase = path.resolve(baseDir);
    const normalizedTarget = path.resolve(targetPath);
    if (!normalizedTarget.startsWith(normalizedBase)) {
      throw new Error(`Security Violation: Path traversal detected outside "${normalizedBase}".`);
    }
  }

  public getWorkspaceSkillDirs(workspaceId: string): string[] {
    try {
      const root = this.workspaceResolver.getWorkspaceRoot(workspaceId);
      if (!root) return [];
      return [
        path.join(root, '.agents', 'skills'),
        path.join(root, '.skills'),
        path.join(root, 'skills'),
        path.join(root, '.anvil', 'skills'),
        path.join(root, '.obsidian', 'skills'),
        path.join(root, '.gemini', 'skills'),
      ];
    } catch {
      return [];
    }
  }

  public getGlobalSkillDirs(): string[] {
    const dirs: string[] = [this.globalSkillsDir];
    try {
      const home = os.homedir();
      if (home) {
        dirs.push(
          path.join(home, '.agents', 'skills'),
          path.join(home, '.skills'),
          path.join(home, '.obsidian', 'skills'),
          path.join(home, '.gemini', 'antigravity', 'builtin', 'skills')
        );
      }
    } catch {
      // ignore
    }
    return dirs;
  }

  private getWorkspaceSkillsDir(workspaceId: string): string {
    const dirs = this.getWorkspaceSkillDirs(workspaceId);
    return dirs.find((d) => fs.existsSync(d)) || dirs[0];
  }

  // ---------------------------------------------------------------------------
  // Frontmatter Parsing & Serialization
  // ---------------------------------------------------------------------------
  public parseSkillMarkdown(raw: string): {
    frontmatter: Record<string, unknown>;
    instructions: string;
  } {
    const trimmed = raw.trimStart();
    if (!trimmed.startsWith('---')) {
      return { frontmatter: {}, instructions: raw.trim() };
    }

    const firstBreak = trimmed.indexOf('\n');
    if (firstBreak === -1) {
      return { frontmatter: {}, instructions: raw.trim() };
    }

    const rest = trimmed.slice(firstBreak + 1);
    const closingIndex = rest.search(/^---\s*$/m);
    if (closingIndex === -1) {
      return { frontmatter: {}, instructions: raw.trim() };
    }

    const yamlBlock = rest.slice(0, closingIndex);
    const instructions = rest.slice(closingIndex).replace(/^---\s*$/m, '').trim();
    const frontmatter = this.parseSimpleYaml(yamlBlock);

    return { frontmatter, instructions };
  }

  private parseSimpleYaml(yamlBlock: string): Record<string, unknown> {
    const lines = yamlBlock.split(/\r?\n/);
    const result: Record<string, unknown> = {};
    let currentListKey: string | null = null;
    let currentList: string[] = [];

    let currentBlockKey: string | null = null;
    let currentBlockLines: string[] = [];
    let blockType: '|' | '>' | 'quote' | null = null;

    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i];
      const trimmed = rawLine.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        if (blockType && rawLine.startsWith('  ')) {
          currentBlockLines.push(rawLine.trim());
        }
        continue;
      }

      // Handle multiline block/quote continuation
      if (currentBlockKey) {
        if (blockType === 'quote') {
          currentBlockLines.push(trimmed);
          if (trimmed.endsWith('"') && !trimmed.endsWith('\\"')) {
            const joined = currentBlockLines.join(' ');
            result[currentBlockKey] = joined
              .replace(/^"|"$/g, '')
              .replace(/\\"/g, '"')
              .replace(/\\\\/g, '\\');
            currentBlockKey = null;
            blockType = null;
            currentBlockLines = [];
          }
          continue;
        } else if (rawLine.startsWith('  ') || rawLine.startsWith('\t')) {
          currentBlockLines.push(trimmed);
          continue;
        } else {
          // End of block
          result[currentBlockKey] =
            blockType === '|' ? currentBlockLines.join('\n') : currentBlockLines.join(' ');
          currentBlockKey = null;
          blockType = null;
          currentBlockLines = [];
        }
      }

      // Handle list item continuation (e.g. "  - item")
      if (trimmed.startsWith('- ') && currentListKey) {
        currentList.push(trimmed.slice(2).trim().replace(/^["']|["']$/g, ''));
        continue;
      }

      // Flush previous list
      if (currentListKey) {
        result[currentListKey] = currentList;
        currentListKey = null;
        currentList = [];
      }

      const colonIdx = trimmed.indexOf(':');
      if (colonIdx === -1) continue;

      const key = trimmed.slice(0, colonIdx).trim();
      let val = trimmed.slice(colonIdx + 1).trim();

      if (val === '|' || val === '>') {
        currentBlockKey = key;
        blockType = val as '|' | '>';
        currentBlockLines = [];
        continue;
      }

      // Check if multiline quoted string
      if (
        val.startsWith('"') &&
        (!val.endsWith('"') || val === '"' || (val.endsWith('\\"') && !val.endsWith('\\\\"')))
      ) {
        currentBlockKey = key;
        blockType = 'quote';
        currentBlockLines = [val];
        continue;
      }

      // Check if value is inline JSON array: [a, b, c]
      if (val.startsWith('[') && val.endsWith(']')) {
        const inner = val.slice(1, -1).trim();
        result[key] = inner
          ? inner.split(',').map((s) => s.trim().replace(/^["']|["']$/g, ''))
          : [];
      } else if (!val) {
        // Starts a multiline YAML list
        currentListKey = key;
        currentList = [];
      } else {
        // Simple scalar or single-line quoted
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        val = val.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
        if (val === 'true') result[key] = true;
        else if (val === 'false') result[key] = false;
        else if (!isNaN(Number(val)) && val.length > 0 && !val.includes(' ')) result[key] = Number(val);
        else result[key] = val;
      }
    }

    if (currentListKey) {
      result[currentListKey] = currentList;
    }
    if (currentBlockKey) {
      result[currentBlockKey] =
        blockType === '|' ? currentBlockLines.join('\n') : currentBlockLines.join(' ');
    }

    return result;
  }

  public serializeSkillMarkdown(def: {
    name: string;
    description: string;
    version?: string;
    category?: string;
    scope?: string;
    source?: string;
    author?: string;
    tools?: string[];
    keywords?: string[];
    prerequisites?: string[];
    instructions: string;
  }): string {
    const lines: string[] = ['---'];
    lines.push(`name: ${JSON.stringify(def.name)}`);
    lines.push(`description: ${JSON.stringify(def.description)}`);
    if (def.version) lines.push(`version: ${JSON.stringify(def.version)}`);
    if (def.category) lines.push(`category: ${def.category}`);
    if (def.scope) lines.push(`scope: ${def.scope}`);
    if (def.source) lines.push(`source: ${def.source}`);
    if (def.author) lines.push(`author: ${JSON.stringify(def.author)}`);

    if (def.tools && def.tools.length > 0) {
      lines.push('tools:');
      for (const t of def.tools) lines.push(`  - ${t}`);
    }

    if (def.keywords && def.keywords.length > 0) {
      lines.push('keywords:');
      for (const k of def.keywords) lines.push(`  - ${k}`);
    }

    if (def.prerequisites && def.prerequisites.length > 0) {
      lines.push('prerequisites:');
      for (const p of def.prerequisites) lines.push(`  - ${p}`);
    }

    lines.push('---');
    lines.push('');
    lines.push(def.instructions.trim());
    lines.push('');

    return lines.join('\n');
  }

  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------
  public validateSkillDefinition(def: Partial<SkillDefinition>): {
    valid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    if (!def.id || !SKILL_ID_REGEX.test(def.id)) {
      errors.push('Skill id must match [a-z0-9_-]{2,64}.');
    }
    if (!def.name || def.name.trim().length < 2) {
      errors.push('Skill name must be at least 2 characters.');
    }
    if (!def.description || def.description.trim().length < 5) {
      errors.push('Skill description must be at least 5 characters.');
    }
    if (!def.instructions || def.instructions.trim().length < 10) {
      errors.push('Skill instructions must be at least 10 characters.');
    }
    if (def.category && !VALID_CATEGORIES.has(def.category)) {
      errors.push(
        `Invalid category "${def.category}". Allowed: ${Array.from(VALID_CATEGORIES).join(', ')}`
      );
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  // ---------------------------------------------------------------------------
  // Discovery & Progressive Disclosure
  // ---------------------------------------------------------------------------
  public listSkills(workspaceId?: string): SkillSummary[] {
    const skillMap = new Map<string, SkillSummary>();

    // 1. Workspace-scoped skills take precedence if workspaceId is provided
    if (workspaceId) {
      const wsDirs = this.getWorkspaceSkillDirs(workspaceId);
      for (const dir of wsDirs) {
        this.readSkillsFromDir(dir, 'workspace', workspaceId, skillMap);
      }
    }

    // 2. Global-scoped skills fill in remaining
    const globalDirs = this.getGlobalSkillDirs();
    for (const dir of globalDirs) {
      this.readSkillsFromDir(dir, 'global', undefined, skillMap);
    }

    // Sort alphabetically by name
    return Array.from(skillMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  private readSkillsFromDir(
    baseDir: string,
    scope: SkillScope,
    workspaceId: string | undefined,
    skillMap: Map<string, SkillSummary>
  ): void {
    if (!fs.existsSync(baseDir)) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(baseDir, { withFileTypes: true });
    } catch (err) {
      console.warn(`[SkillsManager] Could not read skill directory ${baseDir}:`, err);
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const folderName = entry.name;
      let skillId = folderName.toLowerCase();
      try {
        skillId = this.sanitizeId(folderName);
      } catch {
        skillId = folderName.replace(/[^a-z0-9_-]/gi, '-').toLowerCase() || 'unnamed-skill';
      }

      // If already discovered from a higher-priority directory, skip
      if (skillMap.has(skillId)) continue;

      const skillDirPath = path.join(baseDir, folderName);
      const skillFilePath = path.join(skillDirPath, 'SKILL.md');
      const canonicalDirPath = path.resolve(skillDirPath);
      const canonicalFilePath = path.resolve(skillFilePath);

      try {
        this.assertSafePath(baseDir, skillDirPath);
      } catch {
        continue;
      }

      let dirStat: fs.Stats | null = null;
      try {
        dirStat = fs.statSync(skillDirPath);
      } catch {}

      if (!fs.existsSync(skillFilePath)) {
        skillMap.set(skillId, {
          id: skillId,
          name: folderName,
          description: 'Directory does not contain a SKILL.md specification file.',
          category: 'general',
          scope,
          workspaceId,
          enabled: false,
          requiredTools: [],
          source: scope === 'workspace' ? 'custom' : 'built-in',
          path: skillDirPath,
          canonicalPath: canonicalDirPath,
          createdAtMillis: dirStat?.birthtimeMs || dirStat?.mtimeMs || Date.now(),
          updatedAtMillis: dirStat?.mtimeMs || Date.now(),
          validationStatus: 'missing',
          validationError: `Missing SKILL.md in directory "${canonicalDirPath}".`,
        });
        continue;
      }

      try {
        const fileStat = fs.statSync(skillFilePath);
        const rawContent = fs.readFileSync(skillFilePath, 'utf-8');
        const { frontmatter, instructions } = this.parseSkillMarkdown(rawContent);

        const name =
          typeof frontmatter.name === 'string' && frontmatter.name.trim()
            ? frontmatter.name.trim()
            : folderName;
        const description =
          typeof frontmatter.description === 'string' && frontmatter.description.trim()
            ? frontmatter.description.trim()
            : '';
        const version = frontmatter.version ? String(frontmatter.version) : undefined;
        const author = frontmatter.author ? String(frontmatter.author) : undefined;
        const categoryRaw = String(frontmatter.category || 'general').toLowerCase() as SkillCategory;
        const category: SkillCategory = VALID_CATEGORIES.has(categoryRaw) ? categoryRaw : 'general';
        const requiredTools = Array.isArray(frontmatter.tools)
          ? frontmatter.tools.map(String)
          : [];
        const keywords = Array.isArray(frontmatter.keywords)
          ? frontmatter.keywords.map(String)
          : [];
        const source = String(frontmatter.source || (scope === 'workspace' ? 'custom' : 'built-in')) as
          | 'built-in'
          | 'custom'
          | 'imported';

        const validationErrors: string[] = [];
        if (!frontmatter.name) {
          validationErrors.push('Missing "name" field in frontmatter');
        }
        if (!description) {
          validationErrors.push('Missing "description" field in frontmatter');
        }
        if (!instructions || instructions.trim().length === 0) {
          validationErrors.push('SKILL.md has no instructions body');
        }

        const isValid = validationErrors.length === 0;
        const validationStatus: SkillValidationStatus = isValid ? 'valid' : 'invalid';
        const validationError = isValid ? undefined : validationErrors.join('; ');

        skillMap.set(skillId, {
          id: skillId,
          name,
          description: description || 'No description provided.',
          version,
          author,
          category,
          scope,
          workspaceId,
          enabled: isValid ? this.isSkillEnabled(skillId) : false,
          requiredTools,
          source,
          path: skillFilePath,
          canonicalPath: canonicalFilePath,
          createdAtMillis: fileStat.birthtimeMs || fileStat.mtimeMs,
          updatedAtMillis: fileStat.mtimeMs,
          keywords,
          validationStatus,
          validationError,
        });
      } catch (err) {
        skillMap.set(skillId, {
          id: skillId,
          name: folderName,
          description: 'Failed to read or parse SKILL.md.',
          category: 'general',
          scope,
          workspaceId,
          enabled: false,
          requiredTools: [],
          source: scope === 'workspace' ? 'custom' : 'built-in',
          path: skillFilePath,
          canonicalPath: canonicalFilePath,
          createdAtMillis: dirStat?.birthtimeMs || dirStat?.mtimeMs || Date.now(),
          updatedAtMillis: dirStat?.mtimeMs || Date.now(),
          validationStatus: 'failed',
          validationError: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  public getSkill(skillId: string, workspaceId?: string): SkillDefinition | null {
    const sanitizedId = this.sanitizeId(skillId);

    // Check workspace directories in order
    if (workspaceId) {
      const wsDirs = this.getWorkspaceSkillDirs(workspaceId);
      for (const wsDir of wsDirs) {
        const wsSkillPath = path.join(wsDir, sanitizedId, 'SKILL.md');
        if (fs.existsSync(wsSkillPath)) {
          return this.loadSkillFromPath(wsSkillPath, sanitizedId, 'workspace', workspaceId);
        }
      }
    }

    // Check global directories in order
    const globalDirs = this.getGlobalSkillDirs();
    for (const gDir of globalDirs) {
      const globalPath = path.join(gDir, sanitizedId, 'SKILL.md');
      if (fs.existsSync(globalPath)) {
        return this.loadSkillFromPath(globalPath, sanitizedId, 'global', undefined);
      }
    }

    return null;
  }

  private loadSkillFromPath(
    filePath: string,
    id: string,
    scope: SkillScope,
    workspaceId?: string
  ): SkillDefinition {
    const stat = fs.statSync(filePath);
    const rawContent = fs.readFileSync(filePath, 'utf-8');
    const { frontmatter, instructions } = this.parseSkillMarkdown(rawContent);

    const name = String(frontmatter.name || id);
    const description = String(
      frontmatter.description || 'Custom autonomous agent skill instructions.'
    );
    const version = frontmatter.version ? String(frontmatter.version) : undefined;
    const author = frontmatter.author ? String(frontmatter.author) : undefined;
    const categoryRaw = String(frontmatter.category || 'general').toLowerCase() as SkillCategory;
    const category: SkillCategory = VALID_CATEGORIES.has(categoryRaw) ? categoryRaw : 'general';
    const requiredTools = Array.isArray(frontmatter.tools)
      ? frontmatter.tools.map(String)
      : [];
    const keywords = Array.isArray(frontmatter.keywords)
      ? frontmatter.keywords.map(String)
      : [];
    const prerequisites = Array.isArray(frontmatter.prerequisites)
      ? frontmatter.prerequisites.map(String)
      : [];
    const source = String(frontmatter.source || (scope === 'workspace' ? 'custom' : 'built-in')) as
      | 'built-in'
      | 'custom'
      | 'imported';

    // Check for auxiliary reference files inside skill directory
    const dir = path.dirname(filePath);
    const referenceFiles: string[] = [];
    try {
      const files = fs.readdirSync(dir);
      for (const f of files) {
        if (f !== 'SKILL.md' && !f.startsWith('.')) {
          referenceFiles.push(f);
        }
      }
    } catch {
      // Ignore
    }

    const validationErrors: string[] = [];
    if (!frontmatter.name) validationErrors.push('Missing "name" field in frontmatter');
    if (!description) validationErrors.push('Missing "description" field in frontmatter');
    if (!instructions || instructions.trim().length === 0) {
      validationErrors.push('SKILL.md has no instructions body');
    }

    const isValid = validationErrors.length === 0;

    return {
      id,
      name,
      description,
      version,
      author,
      category,
      scope,
      workspaceId,
      enabled: isValid ? this.isSkillEnabled(id) : false,
      requiredTools,
      source,
      path: filePath,
      canonicalPath: path.resolve(filePath),
      createdAtMillis: stat.birthtimeMs || stat.mtimeMs,
      updatedAtMillis: stat.mtimeMs,
      keywords,
      instructions,
      prerequisites,
      referenceFiles: referenceFiles.length > 0 ? referenceFiles : undefined,
      validationStatus: isValid ? 'valid' : 'invalid',
      validationError: isValid ? undefined : validationErrors.join('; '),
    };
  }

  // ---------------------------------------------------------------------------
  // CRUD & Import Operations
  // ---------------------------------------------------------------------------
  public createSkill(
    def: Partial<SkillDefinition> & { id: string; name: string; description: string; instructions: string }
  ): SkillDefinition {
    const sanitizedId = this.sanitizeId(def.id);
    const validation = this.validateSkillDefinition({ ...def, id: sanitizedId });
    if (!validation.valid) {
      throw new Error(`Skill validation failed: ${validation.errors.join('; ')}`);
    }

    const scope: SkillScope = def.scope || 'global';
    let baseDir: string;
    if (scope === 'workspace' && def.workspaceId) {
      const wsDirs = this.getWorkspaceSkillDirs(def.workspaceId);
      baseDir = wsDirs.find((d) => fs.existsSync(d)) || wsDirs[0];
    } else {
      baseDir = this.globalSkillsDir;
    }

    const skillDir = path.join(baseDir, sanitizedId);
    this.assertSafePath(baseDir, skillDir);
    fs.mkdirSync(skillDir, { recursive: true });

    const skillFilePath = path.join(skillDir, 'SKILL.md');
    const content = this.serializeSkillMarkdown({
      name: def.name,
      description: def.description,
      version: def.version || '1.0.0',
      category: def.category || 'general',
      scope,
      source: def.source || (scope === 'workspace' ? 'custom' : 'built-in'),
      author: def.author || 'OBSIDIAN User',
      tools: def.requiredTools || [],
      keywords: def.keywords || [],
      prerequisites: def.prerequisites || [],
      instructions: def.instructions,
    });

    fs.writeFileSync(skillFilePath, content, 'utf-8');
    this.notifySkillsChanged(def.workspaceId);

    const loaded = this.getSkill(sanitizedId, def.workspaceId);
    if (!loaded) {
      throw new Error(`Failed to load newly created skill "${sanitizedId}".`);
    }
    return loaded;
  }

  public importFromMarkdown(
    rawMarkdown: string,
    scope: SkillScope = 'global',
    workspaceId?: string,
    forcedId?: string
  ): SkillDefinition {
    const { frontmatter, instructions } = this.parseSkillMarkdown(rawMarkdown);
    const suggestedId = forcedId || String(frontmatter.id || frontmatter.name || 'imported-skill');
    const id = this.sanitizeId(suggestedId);

    const name = String(frontmatter.name || id);
    const description = String(
      frontmatter.description || 'Imported agent skill instructions.'
    );
    const categoryRaw = String(frontmatter.category || 'general').toLowerCase() as SkillCategory;
    const category = VALID_CATEGORIES.has(categoryRaw) ? categoryRaw : 'general';

    return this.createSkill({
      id,
      name,
      description,
      version: frontmatter.version ? String(frontmatter.version) : '1.0.0',
      category,
      scope,
      workspaceId,
      author: frontmatter.author ? String(frontmatter.author) : 'Imported',
      requiredTools: Array.isArray(frontmatter.tools) ? frontmatter.tools.map(String) : [],
      keywords: Array.isArray(frontmatter.keywords) ? frontmatter.keywords.map(String) : [],
      prerequisites: Array.isArray(frontmatter.prerequisites)
        ? frontmatter.prerequisites.map(String)
        : [],
      instructions: instructions || 'No explicit instructions provided.',
      source: 'imported',
    });
  }

  public importFromDirectory(
    dirPath: string,
    scope: SkillScope = 'global',
    workspaceId?: string
  ): SkillDefinition {
    const normalizedDir = path.resolve(dirPath);
    if (!fs.existsSync(normalizedDir) || !fs.statSync(normalizedDir).isDirectory()) {
      throw new Error(`Directory not found: "${dirPath}".`);
    }

    const skillMdPath = path.join(normalizedDir, 'SKILL.md');
    if (!fs.existsSync(skillMdPath)) {
      throw new Error(`Missing SKILL.md in directory: "${dirPath}".`);
    }

    const raw = fs.readFileSync(skillMdPath, 'utf-8');
    const folderName = path.basename(normalizedDir);
    const created = this.importFromMarkdown(raw, scope, workspaceId, folderName);

    // Copy any auxiliary files
    const targetDir = path.dirname(created.path);
    const files = fs.readdirSync(normalizedDir);
    for (const f of files) {
      if (f !== 'SKILL.md' && !f.startsWith('.')) {
        const srcFile = path.join(normalizedDir, f);
        const dstFile = path.join(targetDir, f);
        if (fs.statSync(srcFile).isFile()) {
          this.assertSafePath(targetDir, dstFile);
          fs.copyFileSync(srcFile, dstFile);
        }
      }
    }

    return this.getSkill(created.id, workspaceId) || created;
  }

  public deleteSkill(skillId: string, workspaceId?: string): boolean {
    const sanitizedId = this.sanitizeId(skillId);
    let deleted = false;

    // Check workspace directories
    if (workspaceId) {
      const wsDirs = this.getWorkspaceSkillDirs(workspaceId);
      for (const wsDir of wsDirs) {
        const wsSkillDir = path.join(wsDir, sanitizedId);
        if (fs.existsSync(wsSkillDir)) {
          this.assertSafePath(wsDir, wsSkillDir);
          fs.rmSync(wsSkillDir, { recursive: true, force: true });
          deleted = true;
          break;
        }
      }
    }

    // Check global directories
    if (!deleted) {
      const globalDirs = this.getGlobalSkillDirs();
      for (const gDir of globalDirs) {
        const globalSkillDir = path.join(gDir, sanitizedId);
        if (fs.existsSync(globalSkillDir)) {
          this.assertSafePath(gDir, globalSkillDir);
          fs.rmSync(globalSkillDir, { recursive: true, force: true });
          deleted = true;
          break;
        }
      }
    }

    if (deleted) {
      this.notifySkillsChanged(workspaceId);
    }

    return deleted;
  }

  // ---------------------------------------------------------------------------
  // Runtime Matching for Agent Orchestration
  // ---------------------------------------------------------------------------
  /**
   * Selectively matches relevant skills for the user's prompt.
   *
   * Behavioral rules:
   * 1. Greetings (e.g. "hi", "hello", "who are you") NEVER match any coding skills (returns []).
   * 2. Explicit invocations (e.g. `@skill:id` or `$id`) force-match the specified skill if enabled.
   * 3. Natural language relevance matching scores keywords, tools, and categories,
   *    returning only high-confidence skills (capped at top 2) to prevent context pollution.
   */
  public matchSkills(prompt: string, workspaceId?: string): SkillDefinition[] {
    const trimmed = String(prompt || '').trim();
    if (!trimmed) return [];

    // Rule 1: Greetings match zero skills
    if (GREETING_PROMPT_REGEX.test(trimmed)) {
      return [];
    }

    const available = this.listSkills(workspaceId).filter(
      (s) => s.enabled && (!s.validationStatus || s.validationStatus === 'valid')
    );
    if (available.length === 0) return [];

    const matchedIds = new Set<string>();

    // Rule 2: Explicit triggers (@skill:id, @id, $id)
    const explicitRegex = /(?:@skill:|@|\$)([a-z0-9_-]+)/gi;
    let match: RegExpExecArray | null;
    while ((match = explicitRegex.exec(trimmed)) !== null) {
      const candidateId = match[1].toLowerCase();
      if (available.some((s) => s.id === candidateId)) {
        matchedIds.add(candidateId);
      }
    }

    // Rule 3: Natural language relevance scoring
    const normalizedPrompt = trimmed.toLowerCase();
    const promptTokens = new Set(
      normalizedPrompt
        .replace(/[^a-z0-9]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length >= 3)
    );

    const scored: Array<{ skill: SkillSummary; score: number }> = [];

    for (const skill of available) {
      if (matchedIds.has(skill.id)) continue;

      let score = 0;

      // Check keywords
      if (skill.keywords) {
        for (const kw of skill.keywords) {
          const lowerKw = kw.toLowerCase();
          if (normalizedPrompt.includes(lowerKw)) {
            score += 3;
          } else if (promptTokens.has(lowerKw)) {
            score += 2;
          }
        }
      }

      // Check skill name tokens
      const nameTokens = skill.name.toLowerCase().split(/\s+/);
      for (const nt of nameTokens) {
        if (nt.length >= 3 && promptTokens.has(nt)) {
          score += 1.5;
        }
      }

      // Check tool names mentioned in prompt
      for (const tool of skill.requiredTools) {
        if (normalizedPrompt.includes(tool.toLowerCase())) {
          score += 2;
        }
      }

      // High confidence threshold (minimum score 3 required)
      if (score >= 3) {
        scored.push({ skill, score });
      }
    }

    // Sort by score descending and take top 2
    scored.sort((a, b) => b.score - a.score);
    for (const item of scored.slice(0, 2)) {
      matchedIds.add(item.skill.id);
    }

    // Load full definitions for activated skills
    const definitions: SkillDefinition[] = [];
    for (const id of matchedIds) {
      const def = this.getSkill(id, workspaceId);
      if (def && def.enabled) {
        definitions.push(def);
      }
    }

    return definitions;
  }

  // ---------------------------------------------------------------------------
  // Built-in Skill Templates (Initial 8 Production-grade Skills)
  // ---------------------------------------------------------------------------
  private seedBuiltinSkills(): void {
    const builtins: Array<{
      id: string;
      name: string;
      description: string;
      category: SkillCategory;
      version: string;
      tools: string[];
      keywords: string[];
      prerequisites: string[];
      instructions: string;
    }> = [
      {
        id: 'android-apk-builder',
        name: 'Android APK Builder',
        description: 'Autonomous tool-driven pipeline to compile, optimize, and verify Android APK containers.',
        category: 'build',
        version: '1.2.0',
        tools: ['build_apk', 'verify_apk', 'check_toolchain', 'run_command', 'list_files', 'read_file'],
        keywords: ['apk', 'android', 'gradle', 'build', 'compile', 'aapt2', 'dex', 'zipalign', 'assemble', 'bundle', 'notes'],
        prerequisites: ['Android build tools (aapt2, d8, zipalign)', 'OpenJDK 17 or compatible javac'],
        instructions: `# Android APK Builder Playbook

When tasked with building an Android application or APK container:
1. Workspace Verification:
   - Run 'list_files' or 'read_file' on AndroidManifest.xml and build configurations to verify project structure.
2. Toolchain Inspection:
   - Call 'check_toolchain' to ensure compilers (javac, d8, aapt2) and environment paths are valid.
3. Execution:
   - Invoke 'build_apk' with '{ variant: "release", optimize_size: true }'.
   - Use AAPT2 resource compilation, D8 desugaring/compilation, and ZipAlign packaging.
4. Container Verification:
   - Call 'verify_apk' on the generated artifact to inspect classes.dex, manifest integrity, and file size.
5. Reporting:
   - Report the exact output APK path, measured byte size, SHA-256 container digest, and verification status.
   - Never fabricate build output or report success without real tool verification.`,
      },
      {
        id: 'apk-size-optimizer',
        name: 'APK Size Optimizer',
        description: 'Techniques and rules to shrink Android APK binaries, eliminate unused assets, and minimize dex overhead.',
        category: 'build',
        version: '1.1.0',
        tools: ['build_apk', 'verify_apk', 'read_file', 'write_file', 'run_command', 'list_files'],
        keywords: ['size', 'shrink', 'optimize', 'bloat', 'minify', 'r8', 'proguard', 'compression', 'reduce', 'mb', 'kb', 'small'],
        prerequisites: ['build_apk capability', 'D8/R8 shrinker'],
        instructions: `# APK Size Optimization Guidelines

Follow these strict size reduction directives:
1. Dex Optimization:
   - Ensure D8/R8 is invoked with release mode and aggressive minification.
   - Remove unused library dependencies and duplicate helper classes.
2. Resource Shrinking:
   - Convert raster images (PNG/JPEG) to WebP or vector drawables (VectorDrawable XML).
   - Strip unused locale translations and unneeded screen densities when targeting specific devices.
3. Packaging & Compression:
   - Use ZipAlign 4-byte boundary alignment for uncompressed .so libraries and assets.
   - Audit assets directory: remove temporary debug assets, raw mock JSONs, and unused fonts.
4. Validation:
   - Call 'verify_apk' to measure the final size delta before and after optimization.`,
      },
      {
        id: 'kotlin-compose-dev',
        name: 'Kotlin & Jetpack Compose Development',
        description: 'Idiomatic Jetpack Compose UI architecture, state management, and modern Kotlin practices.',
        category: 'code',
        version: '1.0.0',
        tools: ['read_file', 'write_file', 'search_files', 'list_files'],
        keywords: ['compose', 'jetpack', 'kotlin', 'ui', 'composable', 'viewmodel', 'stateflow', 'coroutine', 'scaffold'],
        prerequisites: ['Kotlin compiler support', 'Jetpack Compose dependencies'],
        instructions: `# Jetpack Compose Development Standard

1. State & Recomposition Hygiene:
   - Always hoist state: prefer stateless composables that accept values and emit event lambdas.
   - Use 'remember' with appropriate keys to prevent expensive object allocations during recomposition.
   - Use 'derivedStateOf' when calculating values derived from rapidly changing states (e.g. scroll offsets).
2. Architecture:
   - Follow Unidirectional Data Flow (UDF): ViewModels expose Immutable UI state via StateFlow.
   - Handle one-off events (navigation, snackbars) via shared Channels or event wrappers.
3. UI Structure:
   - Use Material 3 tokens ('MaterialTheme.colorScheme', 'MaterialTheme.typography').
   - Provide standard preview annotations ('@Preview(showBackground = true)') for standalone testing.`,
      },
      {
        id: 'build-failure-debugger',
        name: 'Build Failure Debugger',
        description: 'Systematic diagnosis and resolution of AAPT2, Gradle, javac, and linker errors.',
        category: 'debug',
        version: '1.0.0',
        tools: ['run_command', 'read_file', 'search_files', 'check_toolchain'],
        keywords: ['fail', 'error', 'bug', 'crash', 'stacktrace', 'exception', 'debug', 'unresolved', 'syntax', 'broken'],
        prerequisites: ['Access to workspace logs and build files'],
        instructions: `# Build Failure Debugging Protocol

When a build fails:
1. Isolate the Root Failure:
   - Inspect the first error in the compiler log, not the cascading downstream failures.
   - Differentiate between AAPT2 resource parsing errors, javac type resolution errors, and D8 packaging errors.
2. AAPT2 Errors:
   - Check XML attributes for misspelled namespaces ('http://schemas.android.com/apk/res/android').
   - Check resource ID collisions or invalid characters in file names (must match '[a-z0-9_.]').
3. Dependency Mismatches:
   - Check compileSdk vs targetSdk vs library dependency version compatibility.
4. Validate Fix:
   - Re-run the exact failing build step after applying code changes and verify exit code 0.`,
      },
      {
        id: 'code-reviewer',
        name: 'Autonomous Code Reviewer',
        description: 'Audits Kotlin, TypeScript, and Java code for correctness, security, concurrency, and performance smells.',
        category: 'security',
        version: '1.0.0',
        tools: ['read_file', 'search_files', 'list_files'],
        keywords: ['review', 'audit', 'smell', 'refactor', 'clean', 'standards', 'lint', 'pr', 'convention'],
        prerequisites: ['Read access to source files'],
        instructions: `# Code Review Audit Checklist

Review source code against these quality gates:
1. Nullability & Safety:
   - Ensure proper handling of nullable types without forced '!!' operators.
   - Check array bounds and boundary edge cases.
2. Concurrency & Leaks:
   - Verify CoroutineScopes are tied to lifecycle (e.g. viewModelScope, lifecycleScope) to prevent memory leaks.
   - Avoid blocking threads with 'runBlocking' on main dispatchers.
3. Resource Management:
   - Confirm all streams, sockets, database cursors, and file handles use '.use { }' or 'try-with-resources'.
4. Security Smells:
   - No hardcoded API tokens, credentials, or private keys.
   - Ensure input sanitization on web and shell invocation boundaries.`,
      },
      {
        id: 'test-planner',
        name: 'Test Strategy & Generator',
        description: 'Comprehensive test design for unit, integration, and UI component verification.',
        category: 'testing',
        version: '1.0.0',
        tools: ['read_file', 'write_file', 'run_command', 'search_files'],
        keywords: ['test', 'junit', 'assert', 'mock', 'unit', 'coverage', 'instrumentation', 'spec'],
        prerequisites: ['Test runner availability'],
        instructions: `# Automated Test Engineering

1. Unit Testing:
   - Structure tests using the Arrange-Act-Assert (AAA) pattern.
   - Test happy path, boundary values (0, empty, maximum), and error edge cases.
2. Mocking & Fakes:
   - Prefer in-memory fakes over brittle mocks for repositories and data stores.
3. Execution:
   - Run tests and confirm assertion output before concluding verification.`,
      },
      {
        id: 'responsive-ui-designer',
        name: 'Responsive UI Architect',
        description: 'Adaptive layout strategies for mobile, tablet, foldable, and desktop screens.',
        category: 'ui',
        version: '1.0.0',
        tools: ['read_file', 'write_file', 'search_files'],
        keywords: ['responsive', 'adaptive', 'tablet', 'foldable', 'layout', 'breakpoint', 'landscape', 'portrait', 'windowsize'],
        prerequisites: ['UI layout files'],
        instructions: `# Responsive & Adaptive Design System

1. Breakpoints:
   - Compact (< 600dp): single column, bottom navigation bar.
   - Medium (600dp - 840dp): dual pane or navigation rail.
   - Expanded (> 840dp): persistent navigation drawer, multi-column master-detail views.
2. Touch Targets:
   - Interactive elements must maintain a minimum touch target of 48dp x 48dp.
3. Density Independence:
   - Use density-independent pixels (dp) for dimensions and scalable pixels (sp) for text.`,
      },
      {
        id: 'manifest-security-auditor',
        name: 'Android Manifest & Security Auditor',
        description: 'Audits AndroidManifest.xml for exported component vulnerabilities, permission scopes, and cleartext leaks.',
        category: 'security',
        version: '1.0.0',
        tools: ['read_file', 'search_files', 'list_files'],
        keywords: ['manifest', 'security', 'vulnerability', 'permission', 'exported', 'intent-filter', 'cleartext', 'keystore'],
        prerequisites: ['Access to AndroidManifest.xml'],
        instructions: `# Android Manifest Security Protocol

Audit AndroidManifest.xml for:
1. Exported Components:
   - Explicitly declare 'android:exported="false"' on all Activities, Services, and Receivers that do not require external intents.
   - For components with '<intent-filter>', ensure 'android:permission' guards are applied if intended for external callers.
2. Network Security:
   - Reject 'android:usesCleartextTraffic="true"' in release builds.
3. Backup & Storage:
   - Ensure 'android:allowBackup="false"' unless a custom BackupAgent with encrypted storage is implemented.
   - Use FileProvider with scoped paths instead of world-readable external storage.`,
      },
    ];

    for (const b of builtins) {
      const skillDir = path.join(this.globalSkillsDir, b.id);
      const skillFile = path.join(skillDir, 'SKILL.md');
      if (!fs.existsSync(skillFile)) {
        try {
          fs.mkdirSync(skillDir, { recursive: true });
          const content = this.serializeSkillMarkdown({
            name: b.name,
            description: b.description,
            version: b.version,
            category: b.category,
            scope: 'global',
            author: 'OBSIDIAN Built-in',
            tools: b.tools,
            keywords: b.keywords,
            prerequisites: b.prerequisites,
            instructions: b.instructions,
          });
          fs.writeFileSync(skillFile, content, 'utf-8');
        } catch (err) {
          console.error(`[SkillsManager] Failed to seed built-in skill ${b.id}:`, err);
        }
      }
    }
  }
}
