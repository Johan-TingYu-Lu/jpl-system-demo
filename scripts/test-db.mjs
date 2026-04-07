import prisma from '../src/lib/prisma.js';
try {
  const r = await prisma.$queryRawUnsafe('SELECT 1 as ok');
  console.log('DB OK:', JSON.stringify(r));
} catch (e) {
  console.error('DB FAIL:', e.message);
} finally {
  await prisma.$disconnect();
}
