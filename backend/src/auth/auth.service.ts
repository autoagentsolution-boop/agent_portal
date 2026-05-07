import { Injectable } from '@nestjs/common';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { fromNodeHeaders, toNodeHandler } from 'better-auth/node';
import { PrismaService } from '../prisma/prisma.service.js';
import type { IncomingMessage } from 'http';

@Injectable()
export class AuthService {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public readonly auth: any;

  constructor(private readonly prisma: PrismaService) {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    this.auth = betterAuth({
      database: prismaAdapter(this.prisma, {
        provider: 'postgresql',
      }),
      emailAndPassword: {
        enabled: true,
      },
      secret: process.env.BETTER_AUTH_SECRET,
      baseURL: process.env.BETTER_AUTH_URL || 'http://localhost:4000',
      trustedOrigins: [frontendUrl],
    });
  }

  async getSession(req: IncomingMessage) {
    const headers = fromNodeHeaders(req.headers);
    return this.auth.api.getSession({ headers });
  }

  get handler() {
    return toNodeHandler(this.auth);
  }
}
