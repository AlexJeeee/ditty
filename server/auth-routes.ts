import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AuthCredentials, AuthUser } from "../src/shared/types";
import { AuthStore, getAuthStore } from "./auth-store";

interface AuthRequestBody extends Partial<AuthCredentials> {}

export const getBearerToken = (request: FastifyRequest) => {
  const authorization = request.headers.authorization;

  if (!authorization) {
    return "";
  }

  const [scheme, token] = authorization.split(" ");

  return /^Bearer$/i.test(scheme) && token ? token : "";
};

export const requireAuthenticatedUser = (
  request: FastifyRequest,
  reply: FastifyReply,
  authStore: AuthStore = getAuthStore(),
): AuthUser | null => {
  const user = authStore.getUserByToken(getBearerToken(request));

  if (!user) {
    reply.code(401).send({
      error: {
        message: "请重新登录。",
      },
    });
    return null;
  }

  return user;
};

const normalizeBody = (body: AuthRequestBody | undefined) => ({
  email: typeof body?.email === "string" ? body.email : "",
  password: typeof body?.password === "string" ? body.password : "",
});

export const registerAuthRoutes = (
  fastify: FastifyInstance,
  authStore = getAuthStore(),
) => {
  fastify.post<{ Body: AuthRequestBody }>(
    "/api/auth/register",
    async (request, reply) => {
      try {
        const { email, password } = normalizeBody(request.body);

        return await authStore.register(email, password);
      } catch (error) {
        return reply.code(400).send({
          error: {
            message:
              error instanceof Error ? error.message : "注册失败，请稍后重试。",
          },
        });
      }
    },
  );

  fastify.post<{ Body: AuthRequestBody }>(
    "/api/auth/login",
    async (request, reply) => {
      try {
        const { email, password } = normalizeBody(request.body);

        return await authStore.login(email, password);
      } catch (error) {
        return reply.code(401).send({
          error: {
            message:
              error instanceof Error ? error.message : "邮箱或密码不正确。",
          },
        });
      }
    },
  );

  fastify.get("/api/auth/me", async (request, reply) => {
    return requireAuthenticatedUser(request, reply, authStore);
  });

  fastify.post("/api/auth/logout", async (request) => {
    const token = getBearerToken(request);

    if (token) {
      authStore.logout(token);
    }

    return { ok: true };
  });
};
