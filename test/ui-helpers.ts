import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ContextStore } from "../src/store.js";
import { startPanel, type Panel } from "../src/ui/server.js";
import { panelApi } from "../src/ui/api.js";
import { testHost, type TestHost } from "./helpers.js";

export interface Reply {
  status: number;
  json: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export interface ApiHarness {
  store: ContextStore;
  host: TestHost;
  panel: Panel;
  call(method: string, path: string, body?: unknown): Promise<Reply>;
  close(): Promise<void>;
}

/** Start a panel with the real API on a temp database and sign in. */
export async function apiHarness(customHost?: TestHost): Promise<ApiHarness> {
  const dir = mkdtempSync(join(tmpdir(), "baglam-api-"));
  const staticDir = join(dir, "static");
  mkdirSync(staticDir);
  writeFileSync(join(staticDir, "index.html"), "<!doctype html>");
  const dbPath = join(dir, "t.db");
  const store = new ContextStore(dbPath);
  const host = customHost ?? testHost();
  const panel = await startPanel({ store, user: "human:ev", host, dbPath, staticDir, routes: panelApi });
  const raw = (method: string, path: string, headers: Record<string, string>, body?: unknown) =>
    new Promise<{ status: number; headers: Record<string, unknown>; text: string }>((resolve, reject) => {
      const data = body === undefined ? undefined : JSON.stringify(body);
      const req = request(
        {
          host: "127.0.0.1",
          port: panel.port,
          path,
          method,
          headers: {
            host: `127.0.0.1:${panel.port}`,
            ...(data ? { "content-type": "application/json", "content-length": String(Buffer.byteLength(data)) } : {}),
            ...headers,
          },
        },
        (res) => {
          let text = "";
          res.setEncoding("utf8");
          res.on("data", (c) => (text += c));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, text }));
        },
      );
      req.on("error", reject);
      if (data) req.write(data);
      req.end();
    });
  const login = await raw("GET", `/?t=${new URL(panel.url).searchParams.get("t")}`, {});
  const cookie = String(login.headers["set-cookie"]).split(";")[0];
  return {
    store,
    host,
    panel,
    async call(method, path, body) {
      const r = await raw(method, path, { cookie, origin: `http://127.0.0.1:${panel.port}` }, body);
      return { status: r.status, json: r.text ? JSON.parse(r.text) : undefined };
    },
    async close() {
      await panel.close();
      store.close();
    },
  };
}
