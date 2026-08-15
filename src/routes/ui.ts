import { existsSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";

export function registerUiRoutes(app: FastifyInstance, uiRoot: string): void {
  const indexPath = join(uiRoot, "index.html");
  const assetsPath = join(uiRoot, "assets");
  if (!existsSync(indexPath) || !existsSync(assetsPath)) {
    throw new Error(`UI bundle is incomplete at ${uiRoot}`);
  }

  app.get("/assets/*", async (request, reply) => {
    const name = (request.params as { readonly "*": string })["*"];
    if (!/^[A-Za-z0-9._-]+$/.test(name)) return reply.code(404).send({ error: "asset not found" });
    const assetPath = join(assetsPath, name);
    const asset = Bun.file(assetPath);
    if (!(await asset.exists())) return reply.code(404).send({ error: "asset not found" });
    return reply
      .header("Cache-Control", "public, max-age=31536000, immutable")
      .header("X-Content-Type-Options", "nosniff")
      .type(contentType(name))
      .send(Buffer.from(await asset.arrayBuffer()));
  });

  app.get("/", async (_request, reply) => {
    const html = await Bun.file(indexPath).text();
    return reply
      .header("Cache-Control", "no-cache")
      .header("X-Content-Type-Options", "nosniff")
      .type("text/html; charset=utf-8")
      .send(html);
  });
}

function contentType(name: string): string {
  if (name.endsWith(".css")) return "text/css; charset=utf-8";
  if (name.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (name.endsWith(".svg")) return "image/svg+xml";
  if (name.endsWith(".woff2")) return "font/woff2";
  return "application/octet-stream";
}
