/**
 * Prisma Seed Script (v5 schema)
 * 初始化費率設定 + 班級（含 settlementSessions / hoursPerSession）
 */
import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
    console.log('Seed v5 start...');

    // 方案A: YY=$750, Y=$375, 4次結算, $3,000
    const rateA = await prisma.rateConfig.upsert({
        where: { name: '方案A' },
        update: { fullSessionFee: 750, halfSessionFee: 375, settlementSessions: 4, hoursPerSession: 3.0 },
        create: { name: '方案A', fullSessionFee: 750, halfSessionFee: 375, settlementSessions: 4, hoursPerSession: 3.0 },
    });
    console.log(`  方案A: YY=$${rateA.fullSessionFee}, Y=$${rateA.halfSessionFee}, ${rateA.settlementSessions}次`);

    // 方案B: YY=$800, Y=$400, 5次結算, $4,000
    const rateB = await prisma.rateConfig.upsert({
        where: { name: '方案B' },
        update: { fullSessionFee: 800, halfSessionFee: 400, settlementSessions: 5, hoursPerSession: 3.0 },
        create: { name: '方案B', fullSessionFee: 800, halfSessionFee: 400, settlementSessions: 5, hoursPerSession: 3.0 },
    });
    console.log(`  方案B: YY=$${rateB.fullSessionFee}, Y=$${rateB.halfSessionFee}, ${rateB.settlementSessions}次`);

    // 方案C-850: YY=$850, Y=$425, 4次結算, $3,400
    const rateC850 = await prisma.rateConfig.upsert({
        where: { name: '方案C-850' },
        update: { fullSessionFee: 850, halfSessionFee: 425, settlementSessions: 4, hoursPerSession: 3.0 },
        create: { name: '方案C-850', fullSessionFee: 850, halfSessionFee: 425, settlementSessions: 4, hoursPerSession: 3.0 },
    });
    console.log(`  方案C-850: YY=$${rateC850.fullSessionFee}, Y=$${rateC850.halfSessionFee}, ${rateC850.settlementSessions}次`);

    // 方案C-900: YY=$900, Y=$450, 4次結算, $3,600
    const rateC900 = await prisma.rateConfig.upsert({
        where: { name: '方案C-900' },
        update: { fullSessionFee: 900, halfSessionFee: 450, settlementSessions: 4, hoursPerSession: 3.0 },
        create: { name: '方案C-900', fullSessionFee: 900, halfSessionFee: 450, settlementSessions: 4, hoursPerSession: 3.0 },
    });
    console.log(`  方案C-900: YY=$${rateC900.fullSessionFee}, Y=$${rateC900.halfSessionFee}, ${rateC900.settlementSessions}次`);

    for (const cls of [
        { code: 'N', name: 'N高二班(116)', subject: '物理', schedule: '週二/週五', rateConfigId: rateB.id },
        { code: 'M', name: 'M高二班(116)', subject: '數學', schedule: '週日', rateConfigId: rateB.id },
    ]) {
        const c = await prisma.class.upsert({
            where: { code: cls.code },
            update: { name: cls.name, subject: cls.subject, schedule: cls.schedule, rateConfigId: cls.rateConfigId },
            create: cls,
        });
        console.log(`  班級 ${c.code}: ${c.name} (${c.subject})`);
    }

    console.log('Seed v5 complete.');
}

main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
