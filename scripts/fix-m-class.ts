import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function fix() {
  const wrongClasses = await prisma.enrollment.findMany({
    where: { className: 'M班' },
    include: { person: true }
  });

  console.log(`Found ${wrongClasses.length} enrollments with className = 'M班'`);

  for (const e of wrongClasses) {
    console.log(`Fixing ${e.sheetsId} ${e.person.name}`);
    await prisma.enrollment.update({
      where: { id: e.id },
      data: { 
        className: 'M高一班(117)',
        cohort: 117 // Update cohort just in case
      }
    });

    // We should also look at Google Sheets 114學生資料表 to fix it there
  }
}

fix()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
