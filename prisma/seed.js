/**
 * Prisma Seed Script
 * 初始化費率設定 + 班級
 */
const { PrismaClient } = require('../src/generated/prisma');

const prisma = new PrismaClient();

async function main() {
    console.log('🌱 開始 seed...');

    // ========================================
    // 費率設定
    // ========================================
    const rateA = await prisma.rateConfig.upsert({
        where: { name: '方案A' },
        update: {},
        create: {
            name: '方案A',
            fullSessionFee: 750,  // YY
            halfSessionFee: 375,  // Y
        },
    });
    console.log(`  ✅ 費率方案A: YY=$${rateA.fullSessionFee}, Y=$${rateA.halfSessionFee}`);

    const rateB = await prisma.rateConfig.upsert({
        where: { name: '方案B' },
        update: {},
        create: {
            name: '方案B',
            fullSessionFee: 800,  // YY
            halfSessionFee: 400,  // Y
        },
    });
    console.log(`  ✅ 費率方案B: YY=$${rateB.fullSessionFee}, Y=$${rateB.halfSessionFee}`);

    // ========================================
    // 班級設定（目前全用方案 B）
    // ========================================
    const classes = [
        { code: 'N', name: 'N高二班(116)', subject: '物理', schedule: '週二/週五', rateConfigId: rateB.id },
        { code: 'M', name: 'M高二班(116)', subject: '數學', schedule: '週日', rateConfigId: rateB.id },
    ];

    for (const cls of classes) {
        const created = await prisma.class.upsert({
            where: { code: cls.code },
            update: { name: cls.name, subject: cls.subject, schedule: cls.schedule },
            create: cls,
        });
        console.log(`  ✅ 班級 ${created.code}: ${created.name} (${created.subject}) — ${created.schedule}`);
    }

    console.log('🌱 Seed 完成！');
}

main()
    .catch((e) => {
        console.error('❌ Seed 失敗:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
