import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";

export interface RouteContext {
  req: IncomingMessage;
  res: ServerResponse;
  params: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
}

export type Handler = (ctx: RouteContext) => unknown | Promise<unknown>;

export interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
}

/** "/api/entries/:id/approve" → route matching that path, capturing :id. */
export function route(method: string, path: string, handler: Handler): Route {
  const keys: string[] = [];
  const pattern = new RegExp(
    "^" +
      path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/:(\w+)/g, (_, k) => {
        keys.push(k);
        return "([^/]+)";
      }) +
      "$",
  );
  return { method, pattern, keys, handler };
}

/** An error with an HTTP status and optional JSON details. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

/** Status for errors thrown by the store. */
export function statusFor(err: unknown): number {
  if (err instanceof HttpError) return err.status;
  if (!(err instanceof Error)) return 500;
  if (/database (table )?is locked|SQLITE_BUSY|database is busy/i.test(err.message)) return 503;
  if (/not pending|cannot edit|is not active/.test(err.message)) return 409;
  if (/^unknown (entry|project)|^no trust rule/.test(err.message)) return 404;
  return 400;
}

export function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(body);
}

export const CSP =
  "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

export function sendText(res: ServerResponse, status: number, text: string, type = "text/html; charset=utf-8"): void {
  res.writeHead(status, {
    "content-type": type,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...(type.startsWith("text/html") ? { "content-security-policy": CSP, "x-frame-options": "DENY" } : {}),
  });
  res.end(text);
}

const MAX_BODY = 1_000_000;

export async function readJson(req: IncomingMessage): Promise<unknown> {
  if (req.method === "GET" || req.method === "HEAD") return undefined;
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, "request body too large");
    chunks.push(chunk as Buffer);
  }
  if (!size) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "request body is not valid JSON");
  }
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".json": "application/json",
};

/** Serve a file under `root`, or the app's index.html for client-side routes. Never escapes `root`. */
export function serveStatic(res: ServerResponse, root: string, urlPath: string): void {
  const base = resolve(root);
  let rel: string;
  try {
    rel = normalize(decodeURIComponent(urlPath)).replace(/^([/\\])+/, "");
  } catch {
    return sendText(res, 400, "bad path", "text/plain");
  }
  const file = resolve(base, rel);
  if (file !== base && !file.startsWith(base + sep)) return sendText(res, 404, "not found", "text/plain");
  const isFile = existsSync(file) && statSync(file).isFile();
  if (isFile) {
    const type = TYPES[extname(file).toLowerCase()] ?? "application/octet-stream";
    const cache = type.startsWith("text/html") ? "no-store" : "public, max-age=31536000, immutable";
    res.writeHead(200, {
      "content-type": type,
      "cache-control": cache,
      "x-content-type-options": "nosniff",
      ...(type.startsWith("text/html") ? { "content-security-policy": CSP, "x-frame-options": "DENY" } : {}),
    });
    res.end(readFileSync(file));
    return;
  }
  if (extname(rel)) return sendText(res, 404, "not found", "text/plain");
  const index = join(base, "index.html");
  if (!existsSync(index)) return sendText(res, 500, "The panel is not built. Run: npm run build", "text/plain");
  sendText(res, 200, readFileSync(index, "utf8"));
}
