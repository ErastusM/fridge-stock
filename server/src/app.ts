import Fastify, { FastifyError } from 'fastify';
import jwt from '@fastify/jwt';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { config } from './config';
import { HttpError } from './errors';
import { authRoutes } from './routes/auth';
import { kioskRoutes } from './routes/kiosk';
import { setupRoutes } from './routes/setup';
import { reportRoutes } from './routes/reports';

export async function buildApp({ logger = true }: { logger?: boolean } = {}) {
  const app = Fastify({
    logger: logger ? { redact: ['req.headers.authorization', 'req.headers["x-device-token"]'] } : false,
    bodyLimit: 256 * 1024,
    trustProxy: true,
  });

  await app.register(jwt, { secret: config.jwtSecret });

  app.setErrorHandler((err: FastifyError | Error, req, reply) => {
    if (err instanceof ZodError) {
      const first = err.issues[0];
      return reply.status(400).send({ error: first ? `${first.path.join('.') || 'body'}: ${first.message}` : 'Invalid request', issues: err.issues });
    }
    if (err instanceof HttpError) return reply.status(err.statusCode).send({ error: err.message, details: err.details });
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return reply.status(409).send({ error: 'That name is already used' });
    }
    const status = (err as FastifyError).statusCode;
    if (status && status < 500) return reply.status(status).send({ error: err.message });
    req.log.error(err);
    return reply.status(500).send({ error: 'Something went wrong' });
  });

  app.get('/api/health', async () => ({ ok: true }));
  await app.register(
    async (api) => {
      await api.register(authRoutes);
      await api.register(kioskRoutes);
      await api.register(setupRoutes);
      await api.register(reportRoutes);
    },
    { prefix: '/api' },
  );
  return app;
}
