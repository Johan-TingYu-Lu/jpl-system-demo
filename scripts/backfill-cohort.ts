/**
 * backfill-cohort.ts — 回填 enrollment.cohort 欄位
 *
 * 從 className 解析年次（如 "N高二班(107)" → 107）
 */
import 'dotenv/config';
import prisma from '../src/lib/prisma';

function parseCohort(classInfo: string): number | null {
  const match = classInfo.match(/\((\d{3})\)/);
  if (match) return parseInt(match[1]);
  return null;
}

async function main() {
  const enrollments = await prisma.enrollment.findMany({
    where: { cohort: null },
    select: { id: true, sheetsId: true, className: true },
  });
  console.log(`需要 backfill 的 enrollments: ${enrollments.length}`);

  let updated = 0;
  let noMatch = 0;
  for (const e of enrollments) {
    const cohort = parseCohort(e.className);
    if (cohort != null) {
      await prisma.enrollment.update({
        where: { id: e.id },
        data: { cohort },
      });
      updated++;
    } else {
      noMatch++;
      console.log(`  ⚠️ 無法解析年次: [${e.sheetsId}] "${e.className}"`);
    }
  }
  console.log(`\n已更新: ${updated}, 無法解析: ${noMatch}`);

  // 統計
  const all = await prisma.enrollment.findMany({
    select: { cohort: true },
  });
  const counts = new Map<string, number>();
  for (const e of all) {
    const key = e.cohort != null ? String(e.cohort) : '(null)';
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  console.log('\n年次分布:');
  for (const [k, v] of [...counts.entries()].sort()) {
    console.log(`  年次 ${k}: ${v} 人`);
  }

  await prisma.$disconnect();
}

main().catch(console.error);
