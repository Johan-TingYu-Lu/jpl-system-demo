import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  try {
    const count = await prisma.enrollment.count();
    console.log('DB OK — enrollments:', count);
  } catch (e: any) {
    console.error('DB FAIL:', e.code, e.message);
  } finally {
    await prisma.$disconnect();
  }
}

main();
