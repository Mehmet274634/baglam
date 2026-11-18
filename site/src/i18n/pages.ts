export type Lang = "en" | "tr";
export const LANGS: Lang[] = ["en", "tr"];

/** Every page of the site, in nav order. "" is the home page. */
export const PAGES = ["", "how-it-works", "handoff", "automatic-saving", "panel", "security", "tools", "get-started", "pricing", "faq"] as const;
export type Page = (typeof PAGES)[number];

/** URL of a page in a language: English at the root, Turkish under /tr/. */
export function href(lang: Lang, page: Page, hash = ""): string {
  const base = lang === "en" ? "/" : "/tr/";
  return `${base}${page ? `${page}/` : ""}${hash}`;
}

/** The public source repository. */
export const REPO_URL = "https://github.com/Mehmet274634/baglam";
