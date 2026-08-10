import Fastify from "fastify";
import type { FastifyError, FastifyInstance } from "fastify";
import type { AppConfig } from "./config";
import type { DatabasePools } from "./db/pool";
import type { WriteBatcher } from "./ingest/batcher";
import { registerHealthRoute, type Readiness } from "./routes/health";
import { registerIngestRoute } from "./routes/ingest";

export interface AppDependencies {
  readonly config: AppConfig;
  readonly pools: DatabasePools;
  readonly batcher: WriteBatcher;
  readonly readiness: Readiness;
}

export function buildApp(dependencies: AppDependencies): FastifyInstance {
  const app = Fastify({
    logger: true,
    bodyLimit: dependencies.config.bodyLimitBytes,
    requestIdHeader: "x-request-id",
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error.code === "FST_ERR_CTP_INVALID_JSON_BODY") {
      void reply.code(400).send({ error: "malformed JSON" });
      return;
    }
    if (error.code === "FST_ERR_CTP_BODY_TOO_LARGE") {
      void reply.code(413).send({ error: "request body is too large" });
      return;
    }
    request.log.error({ err: error }, "request failed");
    void reply.code(error.statusCode !== undefined && error.statusCode < 500 ? error.statusCode : 500).send({
      error: error.statusCode !== undefined && error.statusCode < 500 ? error.message : "internal error",
    });
  });

  registerHealthRoute(app, dependencies.readiness, dependencies.pools.query);
  registerIngestRoute(app, dependencies.batcher, dependencies.config);
  return app;
}
