export const OBSIDIAN_TOKENS = {
  colors: {
    // Surface & Canvas tiers
    bgMain: '#0D1117',
    bgSecondary: '#161B22',
    bgElevated: '#21262D',
    bgActive: '#30363D',
    bgTerminal: '#090A0C',

    // Typography hierarchy
    textPrimary: '#F0F6FC',
    textSecondary: '#C9D1D9',
    textMuted: '#8B949E',
    textDark: '#0D1117',

    // Hairline structural dividers
    border: '#30363D',
    borderSubtle: '#21262D',

    // Signature kinetic lime accent
    accentPrimary: '#C7FF65',
    accentHover: '#D9FF8F',
    accentCool: '#58A6FF',

    // Semantic status tokens
    success: '#72D9A0',
    successBg: 'rgba(35, 134, 54, 0.15)',
    warning: '#F4C46A',
    warningBg: 'rgba(210, 153, 34, 0.15)',
    error: '#FF727A',
    errorBg: 'rgba(218, 54, 51, 0.15)',
  },
  typography: {
    fontSans: "'Geist', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    fontMono: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
  },
  radii: {
    sm: '0.25rem', // 4px
    md: '0.375rem', // 6px
    lg: '0.5rem', // 8px
    xl: '0.75rem', // 12px
    full: '9999px',
  },
  touch: {
    minHeight: '44px',
    minWidth: '44px',
  },
} as const;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatRelativeTime(timestampMillis: number): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - timestampMillis) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return new Date(timestampMillis).toLocaleDateString();
}
