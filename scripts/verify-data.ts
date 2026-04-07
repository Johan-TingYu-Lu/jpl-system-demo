/**
 * 資料驗證腳本 — 比對 DB 與 Google Sheets 資料
 */
import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { google } from 'googleapis';
import * as fs from 'fs';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });
const credentials = JSON.parse(fs.readFileSync(process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH!, 'utf-8'));
const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
const sheetsApi = google.sheets({ version: 'v4', auth });
const SID = process.env.GOOGLE_SHEETS_SPREADSHEET_ID!;

const CODE_LABELS = ['N(無)', 'V(假)', 'Y(半)', 'YY(全)'];

async function main() {
    console.log('='.repeat(70));
    console.log('🔍 資料驗證：DB vs Google Sheets');
    console.log('='.repeat(70));

    // 1. DB 統計
    console.log('\n📊 DB 統計:');
    const persons = await prisma.person.count();
    const enrollments = await prisma.enrollment.count();
    const attendance = await prisma.monthlyAttendance.count();
    const activeEnroll = await prisma.enrollment.count({ where: { status: 'active' } });
    const droppedEnroll = await prisma.enrollment.count({ where: { status: { in: ['dropped', '永久停止'] } } });

    console.log(`  persons:            ${persons}`);
    console.log(`  enrollments:        ${enrollments} (在學:${activeEnroll}, 退出:${droppedEnroll})`);
    console.log(`  monthly_attendance: ${attendance}`);

    // 2. 抽查：陳昱均（已知有 N=542, M=560 兩個學號）
    console.log('\n🔎 抽查 1: 搜尋「陳昱均」...');
    const yukun = await prisma.person.findMany({
        where: { name: { contains: '陳昱均' } },
        include: {
            enrollments: {
                include: {
                    attendances: { orderBy: [{ year: 'asc' }, { month: 'asc' }] }
                }
            }
        },
    });

    for (const p of yukun) {
        console.log(`  Person #${p.id}: ${p.name} (phone: ${p.phone || '無'})`);
        for (const e of p.enrollments) {
            console.log(`    Enrollment #${e.id}: sheets_id=${e.sheetsId} ${e.classCode}班(${e.subject}) [${e.status}]`);
            for (const a of e.attendances) {
                const nonZeroDays = a.days
                    .map((v, idx) => v > 0 ? `${idx + 1}日=${CODE_LABELS[v]}` : null)
                    .filter(Boolean);
                const totalY = a.days.reduce((sum, v) => sum + (v === 3 ? 2 : v === 2 ? 1 : 0), 0);
                console.log(`      ${a.year}/${String(a.month).padStart(2, '0')}: [${nonZeroDays.join(', ')}] → 合計 ${totalY}Y`);
            }
        }
    }

    // 3. Sheets 對照：542 的 2026/02 出席
    console.log('\n📋 Google Sheets 對照: 542 的 2026/02...');
    try {
        const res = await sheetsApi.spreadsheets.values.get({
            spreadsheetId: SID,
            range: "'2026/02上課紀錄'!A:AZ",
            valueRenderOption: 'UNFORMATTED_VALUE',
        });
        const rows = res.data.values || [];
        // Find row with 542
        for (let r = 0; r < rows.length; r++) {
            if (String(rows[r][0]).trim() === '542') {
                console.log(`  Sheets row ${r}: ${rows[r].slice(0, 8).join(' | ')}`);
                // Show all non-empty attendance columns
                const nonEmpty = rows[r]
                    .map((v: unknown, idx: number) => {
                        const s = String(v || '').toUpperCase().trim();
                        return ['YY', 'Y', 'V', 'N'].includes(s) ? `col${idx}=${s}` : null;
                    })
                    .filter(Boolean);
                console.log(`  出席欄位: ${nonEmpty.join(', ')}`);
                break;
            }
        }
    } catch (e) {
        console.log('  ⚠️ 無法讀取');
    }

    // 4. 抽查幾位在學學生的 Y 值累計
    console.log('\n📈 在學學生 Y 值累計（前 10 位）:');
    const activeStudents = await prisma.enrollment.findMany({
        where: { status: 'active' },
        take: 10,
        orderBy: { sheetsId: 'asc' },
        include: {
            person: { select: { name: true } },
            attendances: true,
        },
    });

    for (const e of activeStudents) {
        let totalY = 0;
        let monthCount = 0;
        for (const a of e.attendances) {
            const my = a.days.reduce((s, v) => s + (v === 3 ? 2 : v === 2 ? 1 : 0), 0);
            totalY += my;
            if (my > 0) monthCount++;
        }
        console.log(`  ${e.sheetsId} ${e.person.name.padEnd(4)} (${e.classCode}/${e.subject}): ${e.attendances.length} 個月, 合計 ${totalY}Y`);
    }

    // 5. Check for person dedup
    console.log('\n🔗 Person 去重檢查（應有兩個學號的人）:');
    const multiEnroll = await prisma.person.findMany({
        where: { enrollments: { some: {} } },
        include: {
            enrollments: { select: { sheetsId: true, classCode: true, subject: true } },
        },
    });
    const multi = multiEnroll.filter(p => p.enrollments.length > 1);
    console.log(`  共 ${multi.length} 人有多個學號:`);
    for (const p of multi.slice(0, 15)) {
        const ids = p.enrollments.map(e => `${e.sheetsId}(${e.classCode})`).join(', ');
        console.log(`    ${p.name}: ${ids}`);
    }

    console.log('\n' + '='.repeat(70));
    console.log('✅ 驗證完成');
    console.log('='.repeat(70));
}

main()
    .catch(e => { console.error('❌', e); process.exit(1); })
    .finally(() => prisma.$disconnect());
