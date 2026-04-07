/**
 * 診斷：找出序號碰撞 + 缺少的收費單
 */
import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  // 1. Find serial collision groups
  const enrollments = await prisma.enrollment.findMany({
    select: { id: true, sheetsId: true, classCode: true, className: true, person: { select: { name: true } } },
  });

  const groups = new Map<string, typeof enrollments>();
  for (const e of enrollments) {
    const key = `${e.sheetsId.slice(-2).padStart(2, '0')}-${e.classCode}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(e);
  }

  const collisions: { key: string; students: typeof enrollments }[] = [];
  for (const [key, group] of groups) {
    if (group.length > 1) collisions.push({ key, students: group });
  }

  console.log(`\n=== 序號碰撞組（共 ${collisions.length} 組）===\n`);
  for (const c of collisions) {
    console.log(`碰撞 key: ${c.key} (末2碼-班碼)`);
    for (const s of c.students) {
      const invoices = await prisma.invoice.findMany({
        where: { enrollmentId: s.id },
        select: { serialNumber: true, amount: true, startDate: true },
        orderBy: { startDate: 'asc' },
      });
      console.log(`  ${s.sheetsId} ${s.person.name} (${s.className}) — DB有 ${invoices.length} 張`);
      for (const inv of invoices) {
        console.log(`    ${inv.serialNumber} | $${inv.amount} | ${inv.startDate.toISOString().slice(0, 10)}`);
      }
    }
    console.log('');
  }

  // 2. Compare expected vs actual
  console.log(`\n=== 被跳過的收費單 ===\n`);
  const { readBillingHistory } = await import('../src/lib/sheets-billing-reader.js');
  const students = await readBillingHistory();

  let totalExpected = 0;
  let totalActual = 0;
  const missing: { sheetsId: string; name: string; expected: number; actual: number }[] = [];

  for (const s of students) {
    totalExpected += s.invoices.length;
    const enrollment = enrollments.find(e => e.sheetsId === s.sheetsId);
    if (!enrollment) continue;
    const dbCount = await prisma.invoice.count({ where: { enrollmentId: enrollment.id } });
    totalActual += dbCount;
    if (dbCount < s.invoices.length) {
      missing.push({ sheetsId: s.sheetsId, name: s.name, expected: s.invoices.length, actual: dbCount });
    }
  }

  console.log(`Sheet 預期: ${totalExpected} 張`);
  console.log(`DB 實際: ${totalActual} 張`);
  console.log(`差: ${totalExpected - totalActual} 張\n`);

  if (missing.length > 0) {
    console.log('缺少收費單的學生：');
    for (const m of missing) {
      console.log(`  ${m.sheetsId} ${m.name}: 預期 ${m.expected}, 實際 ${m.actual} (缺 ${m.expected - m.actual})`);
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
