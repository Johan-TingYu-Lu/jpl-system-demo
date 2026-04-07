/**
 * JPL Sheets → DB 資料遷移腳本 v2（修正版）
 * 
 * 已知結構：
 *   Row 0: 統計數字（忽略）
 *   Row 1: [識別碼數, '日期', serialDate, totalFee, ..., '上課1'~'上課10', serialDate×28]
 *   Row 2: ['識別碼', '姓名', '班別', '該月總費用', '上課時數', '其他缺課次數', '請假次數', '上課次數', ..., 1, 2, ..., 31]
 *   Row 3+: 學生資料 + 出席 (YY/Y/V/N at cols 21~51 = days 1~31)
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

async function readSheet(range: string): Promise<unknown[][]> {
    const res = await sheetsApi.spreadsheets.values.get({
        spreadsheetId: SID,
        range,
        valueRenderOption: 'UNFORMATTED_VALUE',
    });
    return (res.data.values as unknown[][]) || [];
}

function statusToCode(s: unknown): number {
    const upper = String(s || '').trim().toUpperCase();
    if (upper === 'YY') return 3;
    if (upper === 'Y') return 2;
    if (upper === 'V') return 1;
    if (upper === 'N') return 0;
    return -1;
}

// ============================================================================
// Step 1: Import students (same as before)
// ============================================================================
async function importStudents() {
    console.log('\n👤 步驟 1: 匯入學生資料...');
    const rows = await readSheet("'114學生資料表'!A:V");
    if (rows.length < 2) { console.log('  ⚠️ 無資料'); return; }

    const personMap = new Map<string, number>();
    let personCount = 0, enrollCount = 0;

    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const sheetsId = String(row[0] || '').trim();
        const name = String(row[1] || '').trim();
        const classInfo = String(row[2] || '').trim();
        if (!sheetsId || !name) continue;

        let classCode = '';
        let subject = '';
        if (classInfo.startsWith('N')) { classCode = 'N'; subject = '物理'; }
        else if (classInfo.startsWith('M')) { classCode = 'M'; subject = '數學'; }

        let status = 'active';
        if (classInfo.includes('永久停止')) status = '永久停止';
        else if (classInfo.includes('停止') || classInfo.includes('停')) status = 'dropped';
        else if (classInfo.includes('畢')) status = 'graduated';

        const phone = String(row[7] || '').trim();
        const dedupKey = `${name}|${phone}`;
        let personId = personMap.get(dedupKey);

        if (!personId) {
            // Check if person already exists in DB (from previous runs)
            const existingPersons = await prisma.person.findMany({
                where: { name, phone: phone || null },
                select: { id: true },
                take: 1,
            });
            if (existingPersons.length > 0) {
                personId = existingPersons[0].id;
            } else {
                const person = await prisma.person.create({
                    data: {
                        name,
                        englishName: String(row[3] || '').trim() || null,
                        nickname: String(row[4] || '').trim() || null,
                        birthday: String(row[5] || '').trim() || null,
                        gender: String(row[6] || '').trim() || null,
                        phone: phone || null,
                        fb: String(row[8] || '').trim() || null,
                        lineId: String(row[9] || '').trim() || null,
                        contactName: String(row[11] || '').trim() || null,
                        contactRelation: String(row[12] || '').trim() || null,
                        contactPhone: String(row[13] || '').trim() || null,
                        contactFb: String(row[14] || '').trim() || null,
                        highSchool: String(row[15] || '').trim() || null,
                        highSchoolYear: String(row[16] || '').trim() || null,
                        juniorHigh: String(row[17] || '').trim() || null,
                        juniorHighYear: String(row[18] || '').trim() || null,
                        notes: String(row[19] || '').trim() || null,
                    },
                });
                personId = person.id;
                personCount++;
            }
            personMap.set(dedupKey, personId);
        }

        const existing = await prisma.enrollment.findUnique({ where: { sheetsId } });
        if (!existing) {
            await prisma.enrollment.create({
                data: {
                    sheetsId, personId,
                    classCode: classCode || 'X',
                    subject: subject || classInfo,
                    className: classInfo,
                    status,
                },
            });
            enrollCount++;
        } else {
            // Update status/className if changed
            await prisma.enrollment.update({
                where: { sheetsId },
                data: { className: classInfo, status },
            });
        }
    }

    console.log(`  ✅ Persons: ${personCount}, Enrollments: ${enrollCount}`);
}

// ============================================================================
// Step 2: Import attendance with CORRECT column mapping
// ============================================================================
async function importAttendance() {
    console.log('\n📅 步驟 2: 匯入出席紀錄（修正版）...');

    const sheetRes = await sheetsApi.spreadsheets.get({
        spreadsheetId: SID,
        fields: 'sheets.properties.title',
    });
    const allSheets = sheetRes.data.sheets?.map(s => s.properties?.title || '') || [];
    const attendanceSheets = allSheets.filter(n => /^\d{4}\/\d{2}上課紀錄$/.test(n));

    console.log(`  找到 ${attendanceSheets.length} 個出席工作表`);
    let totalVectors = 0;

    for (const sheetName of attendanceSheets) {
        const match = sheetName.match(/^(\d{4})\/(\d{2})上課紀錄$/);
        if (!match) continue;
        const year = parseInt(match[1]);
        const month = parseInt(match[2]);

        console.log(`\n  📋 ${sheetName}...`);
        const rows = await readSheet(`'${sheetName}'!A:BZ`);
        if (rows.length < 4) { console.log(`    ⚠️ 行數不足(${rows.length})`); continue; }

        // ====================================================================
        // 找到日期-欄位映射
        // 策略：找到行 2（包含 "識別碼"/"姓名" 的那行），然後在同一行找數字 1~31
        // ====================================================================
        let headerRowIdx = -1;
        const dayColMap = new Map<number, number>(); // colIdx → day number

        for (let r = 0; r < Math.min(10, rows.length); r++) {
            const firstCell = String(rows[r]?.[0] || '').trim();
            if (firstCell === '識別碼') {
                headerRowIdx = r;
                break;
            }
        }

        if (headerRowIdx === -1) {
            console.log(`    ⚠️ 找不到 "識別碼" 行，跳過`);
            continue;
        }

        // Scan the header row for day numbers
        const headerRow = rows[headerRowIdx];
        for (let c = 8; c < (headerRow?.length || 0); c++) {
            const val = headerRow[c];
            const num = typeof val === 'number' ? val : parseInt(String(val || ''));
            if (!isNaN(num) && num >= 1 && num <= 31) {
                dayColMap.set(c, num);
            }
        }

        if (dayColMap.size === 0) {
            console.log(`    ⚠️ 找不到日期欄位，跳過`);
            continue;
        }

        const sortedDays = [...dayColMap.entries()].sort((a, b) => a[0] - b[0]);
        const uniqueDays = [...new Set(sortedDays.map(([, d]) => d))].sort((a, b) => a - b);
        console.log(`    日期: ${uniqueDays.map(d => d + '號').join(', ')} (${dayColMap.size} 欄)`);

        // ====================================================================
        // Process each student row
        // ====================================================================
        let monthVectors = 0;
        const dataStartIdx = headerRowIdx + 1;

        for (let r = dataStartIdx; r < rows.length; r++) {
            const row = rows[r];
            const sheetsId = String(row[0] || '').trim();
            if (!sheetsId || !/^\d+$/.test(sheetsId)) continue;

            const enrollment = await prisma.enrollment.findUnique({ where: { sheetsId } });
            if (!enrollment) continue;

            // Build 31-element vector
            const days: number[] = new Array(31).fill(0);
            let hasAny = false;

            for (const [colIdx, day] of dayColMap) {
                const val = row[colIdx];
                const code = statusToCode(val);
                if (code >= 0) {
                    days[day - 1] = code;
                    if (code > 0) hasAny = true;
                }
            }

            if (!hasAny) continue;

            await prisma.monthlyAttendance.upsert({
                where: {
                    enrollmentId_year_month: {
                        enrollmentId: enrollment.id,
                        year, month,
                    },
                },
                update: { days },
                create: { enrollmentId: enrollment.id, year, month, days },
            });
            monthVectors++;
        }

        totalVectors += monthVectors;
        console.log(`    ✅ ${monthVectors} 筆向量`);
    }

    console.log(`\n  📊 合計: ${totalVectors} 筆月度向量`);
}

// ============================================================================
// Main
// ============================================================================
async function main() {
    console.log('='.repeat(70));
    console.log('📦 JPL 資料遷移 v4.1 — 114學年（修正日期對應）');
    console.log('='.repeat(70));

    // Only reset attendance vectors (preserve persons/enrollments/invoices/payments)
    console.log('\n🗑️ 清空出席資料（保留學生+收費單）...');
    await prisma.monthlyAttendance.deleteMany();
    console.log('  ✅ 已清空 monthly_attendance');

    await importStudents();
    await importAttendance();

    // Summary
    const pc = await prisma.person.count();
    const ec = await prisma.enrollment.count();
    const ac = await prisma.monthlyAttendance.count();

    // Spot check: 542
    const e542 = await prisma.enrollment.findUnique({
        where: { sheetsId: '542' },
        include: {
            person: { select: { name: true } },
            attendances: { where: { year: 2026, month: 2 } },
        },
    });

    console.log('\n' + '='.repeat(70));
    console.log('📊 遷移完成！');
    console.log(`  persons: ${pc}, enrollments: ${ec}, monthly_attendance: ${ac}`);

    if (e542) {
        console.log(`\n🔎 驗證 542 (${e542.person.name}) 2026/02:`);
        const feb = e542.attendances[0];
        if (feb) {
            const labels = ['N', 'V', 'Y', 'YY'];
            const nonZero = feb.days
                .map((v, i) => v > 0 ? `${i + 1}日=${labels[v]}` : null)
                .filter(Boolean);
            const totalY = feb.days.reduce((s, v) => s + (v === 3 ? 2 : v === 2 ? 1 : 0), 0);
            console.log(`  出席: ${nonZero.join(', ')}`);
            console.log(`  Y值: ${totalY} (應為 8)`);
        }
    }

    console.log('='.repeat(70));
}

main()
    .catch(e => { console.error('❌', e); process.exit(1); })
    .finally(() => prisma.$disconnect());
