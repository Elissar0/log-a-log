import type { FastifyInstance } from "fastify";
import { CursorValidationError } from "../query/cursor";
import { parseLogQuery, QueryValidationError } from "../query/parser";
import type { LogQueryRepository } from "../query/repository";

export function registerQueryRoute(app: FastifyInstance, repository: LogQueryRepository): void {
  app.get("/logs", async (request, reply) => {
    let query;
    try {
      query = parseLogQuery(request.query as Record<string, unknown>);
    } catch (error) {
      if (error instanceof QueryValidationError || error instanceof CursorValidationError) {
        return reply.code(400).send({ error: error.message });
      }
      throw error;
    }
    try {
      const page = await repository.list(query);
      return await reply.code(200).send({ logs: page.logs, next_cursor: page.nextCursor });
    } catch (error) {
      request.log.error({ err: error }, "log query failed");
      return reply.code(503).send({ error: "logs could not be queried" });
    }
  });
}
