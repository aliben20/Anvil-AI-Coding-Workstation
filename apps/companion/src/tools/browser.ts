/**
 * Obsidian Duet Agent - Browser Automation Tools
 * Enforces domain allowlists, private address blocking, and isolated browser sessions.
 */

import { PermissionPolicyEnforcer } from './policies.js';

export interface BrowserScrapeResult {
  url: string;
  title: string;
  content: string;
  links: string[];
}

export class ControlledBrowserRunner {
  private enforcer: PermissionPolicyEnforcer;

  constructor(enforcer: PermissionPolicyEnforcer) {
    this.enforcer = enforcer;
  }

  public async scrapeUrl(urlString: string): Promise<BrowserScrapeResult> {
    const validUrl = this.enforcer.validateBrowserUrl(urlString);

    try {
      // Dynamic import of playwright if installed
      // @ts-ignore
      const { chromium } = await import('playwright');
      const browser = await chromium.launch({ headless: true });
      const context = await browser.newContext({
        userAgent: 'ObsidianDuetAgent/1.0 (+https://obsidian.md)',
        viewport: { width: 1280, height: 800 },
        ignoreHTTPSErrors: false,
      });
      const page = await context.newPage();

      try {
        await page.goto(validUrl.toString(), { timeout: 20000, waitUntil: 'domcontentloaded' });
        const title = await page.title();
        const content = await page.evaluate(() => {
          // Clean non-text tags
          const clone = document.body.cloneNode(true) as HTMLElement;
          const scripts = clone.querySelectorAll('script, style, noscript, svg, nav, footer');
          scripts.forEach((s) => s.remove());
          return clone.innerText || '';
        });

        const links = await page.evaluate(() => {
          return Array.from(document.querySelectorAll('a[href]'))
            .map((a) => (a as HTMLAnchorElement).href)
            .filter((h) => h.startsWith('http'))
            .slice(0, 20);
        });

        return {
          url: validUrl.toString(),
          title,
          content: content.slice(0, 10000), // Bounded text extract
          links,
        };
      } finally {
        await context.close();
        await browser.close();
      }
    } catch {
      // Lightweight HTTP fetch fallback if Playwright browser binaries are not downloaded
      const res = await fetch(validUrl.toString(), {
        headers: { 'User-Agent': 'ObsidianDuetAgent/1.0' },
      });
      if (!res.ok) {
        throw new Error(`Failed to fetch URL (HTTP ${res.status}): ${res.statusText}`);
      }
      const html = await res.text();
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      const title = titleMatch ? titleMatch[1].trim() : validUrl.hostname;
      const stripped = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      return {
        url: validUrl.toString(),
        title,
        content: stripped.slice(0, 10000),
        links: [],
      };
    }
  }
}
