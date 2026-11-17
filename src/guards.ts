/** Detects credentials in text so they never enter shared memory. Pure functions, no I/O. */

export interface SecretFinding {
  type: string;
  /** Safe to show: first 4 characters and an ellipsis. */
  masked: string;
}

/** A URL password that is clearly a placeholder in docs or config templates. */
const PLACEHOLDER_PASSWORD = /^(?:\$\{[^}]*\}|\$[A-Z_][A-Z0-9_]*|<[^>]*>|\{[^}]*\}|\*+|password|passwd|pass|pwd|secret|changeme|xxx+)$/i;

// Order matters: more specific patterns first; overlapping later matches are ignored.
// `accept` filters out matches that only look like secrets.
const PATTERNS: { type: string; re: RegExp; accept?: (m: RegExpMatchArray) => boolean }[] = [
  { type: "Private key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { type: "AWS access key", re: /\bAKIA[0-9A-Z]{16}\b/g },
  { type: "GitHub token", re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})/g },
  { type: "Anthropic API key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  // Real keys always carry digits; plain kebab-case words after "sk-" are prose.
  { type: "OpenAI API key", re: /\bsk-(?:proj-)?(?=[A-Za-z_-]*\d)[A-Za-z0-9_-]{20,}/g },
  { type: "Google API key", re: /\bAIza[0-9A-Za-z_-]{35}/g },
  { type: "Stripe key", re: /\b(?:sk|rk)_(?:live|test)_[0-9A-Za-z]{16,}/g },
  { type: "Slack token", re: /\bxox[abprs]-[0-9A-Za-z-]{10,}/g },
  { type: "JWT", re: /\beyJ[\w-]{10,}\.eyJ[\w-]{10,}\.[\w-]{10,}/g },
  {
    type: "Password in URL",
    re: /\b[a-z][a-z0-9+.-]*:\/\/([^\s:/@]+):([^\s@/]+)@/gi,
    accept: (m) => !PLACEHOLDER_PASSWORD.test(m[2]) && !/^<.*>$/.test(m[1]),
  },
];

// No "/" here: slashes separate path and URL segments, which are checked one by one.
const CANDIDATE = /[A-Za-z0-9+=_-]{32,}/g;
const ENTROPY_THRESHOLD = 4.2;
const HASH_PREFIX = /^(?:sha(?:1|224|256|384|512)|md5)-/i;

/** True for identifiers built from word-like parts: getUserById2FA…, Release_x64_Win10SDK…. */
function wordLike(token: string): boolean {
  const parts = token
    .split(/[_-]+|(?<=[a-z])(?=[A-Z])|(?<=[A-Za-z])(?=[0-9])|(?<=[0-9])(?=[A-Za-z])/)
    .filter(Boolean);
  if (parts.length < 3) return false;
  const avg = parts.reduce((n, p) => n + p.length, 0) / parts.length;
  return avg >= 2.5;
}

function entropy(s: string): number {
  const counts = new Map<string, number>();
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let h = 0;
  for (const n of counts.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

/** Random-looking token: mixed case, several digits, not hex, high entropy. */
function looksRandom(token: string): boolean {
  if (/^[0-9a-f-]+$/i.test(token)) return false; // hashes, UUIDs
  if (HASH_PREFIX.test(token)) return false; // lockfile integrity values
  if (wordLike(token)) return false;
  const digits = (token.match(/[0-9]/g) ?? []).length;
  if (digits < 3 || !/[a-z]/.test(token) || !/[A-Z]/.test(token)) return false;
  return entropy(token) > ENTROPY_THRESHOLD;
}

const mask = (s: string) => `${s.slice(0, 4)}…`;

export function scanSecrets(text: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  const taken: [number, number][] = [];
  const overlaps = (a: number, b: number) => taken.some(([s, e]) => a < e && b > s);

  for (const { type, re, accept } of PATTERNS) {
    for (const m of text.matchAll(re)) {
      const start = m.index!, end = start + m[0].length;
      if (overlaps(start, end)) continue;
      if (accept && !accept(m)) {
        taken.push([start, end]); // a recognised placeholder: not a secret, and not "random" either
        continue;
      }
      taken.push([start, end]);
      findings.push({ type, masked: mask(m[0]) });
    }
  }
  for (const m of text.matchAll(CANDIDATE)) {
    const start = m.index!, end = start + m[0].length;
    if (overlaps(start, end) || !looksRandom(m[0])) continue;
    taken.push([start, end]);
    findings.push({ type: "High-entropy string", masked: mask(m[0]) });
  }
  return findings;
}

export function scanEntryFields(f: {
  title: string;
  body: string;
  rationale?: string | null;
  tags?: string[];
  audience?: string[];
}): SecretFinding[] {
  return [f.title, f.body, f.rationale ?? "", ...(f.tags ?? []), ...(f.audience ?? [])].flatMap((t) => scanSecrets(t));
}

export function describeFindings(findings: SecretFinding[]): string {
  return findings.map((f) => `${f.type} (${f.masked})`).join(", ");
}
