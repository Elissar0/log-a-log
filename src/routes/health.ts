import type { FastifyInstance } from "fastify";

export interface Readiness {
  ready: boolean;
}

export interface DatabaseProbe {
  query(sql: string): Promise<unknown>;
}

export function registerHealthRoute(
  app: FastifyInstance,
  readiness: Readiness,
  database: DatabaseProbe,
): void {
  app.get("/health", async (_request, reply) => {
    if (!readiness.ready) return reply.code(503).send({ status: "starting" });
    try {
      await database.query("SELECT 1");
      return await reply.code(200).send({ status: "ok" });
    } catch {
      readiness.ready = false;
      return reply.code(503).send({ status: "starting" });
    }
  });
}
