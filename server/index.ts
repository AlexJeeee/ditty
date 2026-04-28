import cors from "@fastify/cors";
import "dotenv/config";
import Fastify from "fastify";
import { getPort } from "./config";
import { registerAgentRoutes } from "./agent-routes";

const fastify = Fastify({
  logger: true
});

await fastify.register(cors, {
  origin: true
});

registerAgentRoutes(fastify);

const port = getPort();

try {
  await fastify.listen({
    host: "127.0.0.1",
    port
  });
} catch (error) {
  fastify.log.error(error);
  process.exit(1);
}
