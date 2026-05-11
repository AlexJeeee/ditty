import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AuthCredentials, AuthUser } from "../src/shared/types";
import { AuthStore, getAuthStore } from "./auth-store";

interface AuthRequestBody extends Partial<AuthCredentials> {}

interface AuthRateLimitOptions {
  max: number;
  timeWindow: string | number;
}

const DEFAULT_AUTH_RATE_LIMIT: AuthRateLimitOptions = {
  max: 10,
  timeWindow: "1 minute",
};

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
  authRateLimit = DEFAULT_AUTH_RATE_LIMIT,
) => {
  void fastify.register(async (authFastify) => {
    await authFastify.register(rateLimit, {
      global: false,
      ...authRateLimit,
      errorResponseBuilder: () => ({
        statusCode: 429,
        error: {
          message: "请求过于频繁，请稍后再试。",
        },
      }),
    });

    authFastify.post<{ Body: AuthRequestBody }>(
      "/api/auth/register",
      {
        config: {
          rateLimit: authRateLimit,
        },
      },
      async (request, reply) => {
        try {
          const { email, password } = normalizeBody(request.body);

          return await authStore.register(email, password);
        } catch (error) {
          return reply.code(400).send({
            error: {
              message:
                error instanceof Error
                  ? error.message
                  : "注册失败，请稍后重试。",
            },
          });
        }
      },
    );

    authFastify.post<{ Body: AuthRequestBody }>(
      "/api/auth/login",
      {
        config: {
          rateLimit: authRateLimit,
        },
      },
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

    authFastify.get("/api/auth/me", async (request, reply) => {
      return requireAuthenticatedUser(request, reply, authStore);
    });

    authFastify.post("/api/auth/logout", async (request) => {
      const token = getBearerToken(request);

      if (token) {
        authStore.logout(token);
      }

      return { ok: true };
    });
  });
};
