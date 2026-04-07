import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const p = new PrismaClient({ adapter });

async function main() {
  const total = await p.invoice.count();
  const byStatus = await p.invoice.groupBy({ by: ['status'], _count: true });
  console.log('Total invoices:', total);
  console.log('By status:', JSON.stringify(byStatus));

  const raw: any[] = await p.$queryRaw`
    SELECT e.sheets_id, p.name, i.status, COUNT(*)::int as cnt,
           MIN(i.start_date)::text as min_start, MAX(i.end_date)::text as max_end
    FROM invoices i
    JOIN enrollments e ON i.enrollment_id = e.id
    JOIN persons p ON e.person_id = p.id
    GROUP BY e.sheets_id, p.name, i.status
    ORDER BY e.sheets_id::int, i.status
  `;
  console.log('\nDB Invoice distribution:');
  for (const r of raw) {
    console.log(`  ID ${r.sheets_id.padStart(3)} ${r.name.padEnd(6)} [${r.status.padEnd(7)}] x${r.cnt}  (${r.min_start} ~ ${r.max_end})`);
  }

  const summary: any[] = await p.$queryRaw`
    SELECT COUNT(DISTINCT e.sheets_id)::int as unique_students,
           MIN(e.sheets_id::int) as min_id, MAX(e.sheets_id::int) as max_id
    FROM invoices i JOIN enrollments e ON i.enrollment_id = e.id
  `;
  console.log('\nSummary:', JSON.stringify(summary));
}

main().then(() => p.$disconnect());
