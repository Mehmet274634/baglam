import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "node:http";
import { ContextStore } from "../src/store.js";
import { startPanel, type Panel } from "../src/ui/server.js";
import { testHost } from "./helpers.js";

/** Raw HTTP so tests control Host/Origin/Cookie exactly (fetch forbids setting Host). */
function http(
  port: number,
  path: string,
  opts: { method?: string; headers?: Record<string, string>; body?: unknown } = {},
): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; text: string }> {
  return new Promise((resolve, reject) => {
    const body = opts.body === undefined ? undefined : JSON.stringify(opts.body);
    const req = request(
      {
        host: "127.0.0.1",
        port,
        path,
        method: opts.method ?? "GET",
        headers: { host: `127.0.0.1:${port}`, ...(body ? { "content-type": "application/json" } : {}), ...opts.headers },
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (text += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, text }));
      },
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

describe("panel server", () => {
  let dir: string;
  let dbPath: string;
  let store: ContextStore;
  let panel: Panel;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "baglam-ui-"));
    const staticDir = join(dir, "static");
    mkdirSync(join(staticDir, "assets"), { recursive: true });
    writeFileSync(join(staticDir, "index.html"), "<!doctype html><title>Bağlam</title><div id=app></div>");
    writeFileSync(join(staticDir, "assets", "app.js"), "console.log(1)");
    dbPath = join(dir, "t.db");
    store = new ContextStore(dbPath);
    panel = await startPanel({ store, user: "human:ev", host: testHost(), dbPath, staticDir, pollMs: 50 });
  });
  afterEach(async () => {
    await panel.close();
    store.close();
  });

  const token = () => new URL(panel.url).searchParams.get("t")!;

  async function login(): Promise<string> {
    const r = await http(panel.port, `/?t=${token()}`);
    expect(r.status).toBe(302);
    const cookie = String(r.headers["set-cookie"]);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    return cookie.split(";")[0];
  }

  it("binds to 127.0.0.1 and gives a tokenised url", () => {
    expect(panel.url).toMatch(new RegExp(`^http://127\\.0\\.0\\.1:${panel.port}/\\?t=[0-9a-f]{48}$`));
  });

  it("two panels keep separate sessions (cookies are shared across ports)", async () => {
    const second = await startPanel({ store, user: "human:ev", host: testHost(), dbPath, staticDir: join(dir, "static") });
    try {
      const a = await login();
      const r = await http(second.port, `/?t=${new URL(second.url).searchParams.get("t")}`);
      const b = String(r.headers["set-cookie"]).split(";")[0];
      expect(a.split("=")[0]).not.toBe(b.split("=")[0]);
      // A browser sends every 127.0.0.1 cookie to both ports; each panel must find its own.
      const both = `${b}; ${a}`;
      expect((await http(panel.port, "/api/ping", { headers: { cookie: both } })).status).toBe(200);
      expect((await http(second.port, "/api/ping", { headers: { cookie: both } })).status).toBe(200);
    } finally {
      await second.close();
    }
  });

  it("token is single-use", async () => {
    await login();
    const again = await http(panel.port, `/?t=${token()}`);
    expect(again.status).toBe(403);
    expect(again.text).toMatch(/baglam ui/);
  });

  it("api needs the session cookie", async () => {
    expect((await http(panel.port, "/api/ping")).status).toBe(401);
    const cookie = await login();
    const ok = await http(panel.port, "/api/ping", { headers: { cookie } });
    expect(ok.status).toBe(200);
    expect(JSON.parse(ok.text)).toEqual({ ok: true });
  });

  it("rejects foreign Host", async () => {
    const cookie = await login();
    const r = await http(panel.port, "/api/ping", { headers: { cookie, host: "evil.example:80" } });
    expect(r.status).toBe(403);
  });

  it("rejects foreign Origin on POST", async () => {
    const cookie = await login();
    const r = await http(panel.port, "/api/ping", { method: "POST", headers: { cookie, origin: "https://evil.example" }, body: {} });
    expect(r.status).toBe(403);
  });

  it("allows same-origin POST", async () => {
    const cookie = await login();
    const r = await http(panel.port, "/api/ping", {
      method: "POST",
      headers: { cookie, origin: `http://127.0.0.1:${panel.port}` },
      body: {},
    });
    expect(r.status).toBe(200);
  });

  it("serves index.html for app routes and assets with types", async () => {
    const cookie = await login();
    const page = await http(panel.port, "/records", { headers: { cookie } });
    expect(page.status).toBe(200);
    expect(page.text).toContain("<div id=app>");
    expect(page.headers["cache-control"]).toBe("no-store");
    const js = await http(panel.port, "/assets/app.js", { headers: { cookie } });
    expect(js.headers["content-type"]).toMatch(/javascript/);
    expect((await http(panel.port, "/assets/../../t.db", { headers: { cookie } })).status).not.toBe(200);
  });

  it("app page without a session explains how to open the panel", async () => {
    const r = await http(panel.port, "/");
    expect(r.status).toBe(403);
    expect(r.text).toMatch(/baglam ui/);
  });

  it("sends an event after a change from another connection", async () => {
    const cookie = await login();
    const other = new ContextStore(dbPath);
    const got = await new Promise<string>((resolve, reject) => {
      const req = request(
        { host: "127.0.0.1", port: panel.port, path: "/api/events", headers: { host: `127.0.0.1:${panel.port}`, cookie } },
        (res) => {
          expect(res.headers["content-type"]).toMatch(/text\/event-stream/);
          res.setEncoding("utf8");
          let buf = "";
          res.on("data", (c) => {
            buf += c;
            if (buf.includes("event: change")) {
              req.destroy();
              resolve(buf);
            }
          });
          setTimeout(() => other.addApproved({ project: "p", kind: "fact", title: "t", body: "b" }, "human"), 100);
        },
      );
      req.on("error", (e) => (String(e).includes("aborted") || String(e).includes("socket hang up") ? undefined : reject(e)));
      req.end();
      setTimeout(() => reject(new Error("no change event within 3 s")), 3000);
    });
    other.close();
    expect(got).toContain("event: change");
  });
});
