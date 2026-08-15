import { afterEach, describe, expect, test } from "bun:test";
import Fastify from "fastify";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerUiRoutes } from "../../src/routes/ui";

const temporaryRoots: string[] = [];

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("dashboard static routes", () => {
  test("serves the shell without caching and hashed assets immutably", async () => {
    const root = await fixture();
    const app = Fastify({ logger: false });
    registerUiRoutes(app, root);
    await app.ready();

    const shell = await app.inject({ method: "GET", url: "/" });
    expect(shell.statusCode).toBe(200);
    expect(shell.headers["content-type"]).toContain("text/html");
    expect(shell.headers["cache-control"]).toBe("no-cache");
    expect(shell.body).toContain("Log-a-Log dashboard");

    const asset = await app.inject({ method: "GET", url: "/assets/app-test.js" });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(asset.headers["x-content-type-options"]).toBe("nosniff");
    await app.close();
  });

  test("fails registration when the production bundle is incomplete", () => {
    expect(() =>
      registerUiRoutes(Fastify({ logger: false }), join(tmpdir(), "missing-logalog-ui")),
    ).toThrow("UI bundle is incomplete");
  });
});

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "logalog-ui-"));
  temporaryRoots.push(root);
  await mkdir(join(root, "assets"));
  await writeFile(join(root, "index.html"), "<!doctype html><title>Log-a-Log dashboard</title>");
  await writeFile(join(root, "assets", "app-test.js"), "export const ready = true;");
  return root;
}
