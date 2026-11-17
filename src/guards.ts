/** Detects credentials in text so they never enter shared memory. Pure functions, no I/O. */

export interface SecretFinding {
  type: string;
  /** Safe to show: first 4 characters and an ellipsis. */
  masked: string;
}

// Order matters: more specific patterns first; overlapping later matches are ignored.
const PATTERNS: [string, RegExp][] = [
  ["Private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/g],
  ["GitHub token", /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})/g],
  ["Anthropic API key", /\bsk-ant-[A-Za-z0-9_-]{20,}/g],
  ["OpenAI API key", /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/g],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{35}/g],
  ["Stripe key", /\b(?:sk|rk)_(?:live|test)_[0-9A-Za-z]{16,}/g],
  ["Slack token", /\bxox[abprs]-[0-9A-Za-z-]{10,}/g],
  ["JWT", /\beyJ[\w-]{10,}\.eyJ[\w-]{10,}\.[\w-]{10,}/g],
  ["Password in URL", /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:[^\s@/]+@/g],
];

const CANDIDATE = /[A-Za-z0-9+/_=-]{32,}/g;
const ENTROPY_THRESHOLD = 4.2;

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
  const digits = (token.match(/[0-9]/g) ?? []).length;
  if (digits < 3 || !/[a-z]/.test(token) || !/[A-Z]/.test(token)) return false;
  return entropy(token) > ENTROPY_THRESHOLD;
}

const mask = (s: string) => `${s.slice(0, 4)}…`;

export function scanSecrets(text: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  const taken: [number, number][] = [];
  const overlaps = (a: number, b: number) => taken.some(([s, e]) => a < e && b > s);

  for (const [type, re] of PATTERNS) {
    for (const m of text.matchAll(re)) {
      const start = m.index!, end = start + m[0].length;
      if (overlaps(start, end)) continue;
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

export function scanEntryFields(f: { title: string; body: string; rationale?: string | null; tags?: string[] }): SecretFinding[] {
  return [f.title, f.body, f.rationale ?? "", ...(f.tags ?? [])].flatMap((t) => scanSecrets(t));
}

export function describeFindings(findings: SecretFinding[]): string {
  return findings.map((f) => `${f.type} (${f.masked})`).join(", ");
}
