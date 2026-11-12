import { Prisma, PrismaClient } from '@prisma/client';

export const db = new PrismaClient();
export type Db = PrismaClient;
export type Tx = Prisma.TransactionClient;
