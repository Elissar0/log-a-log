import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AppConfig } from "../config";
import { WriteBatcher, WriteQueueOverloadedError } from "../ingest/batcher";
import { EnvelopeValidationError, validateIngestBody } from "../ingest/validation";

export function registerIngestRoute(
  app: FastifyInstance,
  batcher: WriteBatcher,
  config: AppConfig,
): void {
  let admitted = 0;
  const admittedRequests = new WeakSet<FastifyRequest>();

  app.post(
    "/logs",
    {
      onRequest: (request, reply, done) => {
        if (admitted >= config.maxConcurrentIngestRequests) {
          void reply.code(503).send({ error: "ingestion is overloaded" });
          done();
          return;
        }
        admitted += 1;
        admittedRequests.add(request);
        done();
      },
      onResponse: (request, _reply, done) => {
        if (admittedRequests.delete(request)) admitted -= 1;
        done();
      },
    },
    async (request, reply) => {
      let batch;
      try {
        batch = validateIngestBody(request.body, config.maxLogsPerRequest);
      } catch (error) {
        if (error instanceof EnvelopeValidationError) {
          return reply.code(400).send({ error: error.message });
        }
        throw error;
      }

      if (batch.logs.length === 0) {
        return reply.code(400).send({ accepted: 0, rejected: batch.rejected });
      }

      try {
        await batcher.submit(batch.logs, batch.normalizedBytes);
        return reply.code(200).send({ accepted: batch.logs.length, rejected: batch.rejected });
      } catch (error) {
        if (error instanceof WriteQueueOverloadedError) {
          return reply.code(503).send({ error: "ingestion is overloaded" });
        }
        request.log.error({ err: error }, "log transaction failed");
        return reply.code(503).send({ error: "logs could not be committed" });
      }
    },
  );
}
