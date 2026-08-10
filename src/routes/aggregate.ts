import type { FastifyInstance } from "fastify";
import { parseAggregateQuery, QueryValidationError } from "../query/parser";
import type { LogQueryRepository } from "../query/repository";

export function registerAggregateRoute(app: FastifyInstance, repository: LogQueryRepository): void {
  app.get("/logs/aggregate", async (request, reply) => {
    let query;
    try {
      query = parseAggregateQuery(request.query as Record<string, unknown>);
    } catch (error) {
      if (error instanceof QueryValidationError) {
        return reply.code(400).send({ error: error.message });
      }
      throw error;
    }
    try {
      return reply.code(200).send({ buckets: await repository.aggregate(query) });
    } catch (error) {
      request.log.error({ err: error }, "aggregate query failed");
      return reply.code(503).send({ error: "aggregation could not be queried" });
    }
  });
}
