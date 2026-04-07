/**
 * Sync Engine v5 — Google Sheets ↔ DB 同步（多學年支援）
 *
 * Pull: Sheets → DB
 *   - students: {學年}學生資料表 → persons + enrollments
 *   - attendance: YYYY/MM上課紀錄 → monthly_attendance (int[31] vectors)
 *
 * 新增：
 *   - pullStudentsForYear(yearConfig) — 指定學年拉學生
 *   - pullAttendanceForYear(yearConfig) — 指定學年拉出席
 *   - pullForYear(yearConfig) — 指定學年完整同步
 *   - pullMultipleYears([106,107,...]) — 批次同步多學年
 *   - 原有 pullStudents() / pullAttendance() / pullAll() 保持向後相容（預設 114）
 */
import prisma from './prisma';
import { readSheet, listSheetNames } from './sheets';
import { pullBillingHistory, type ImportResult } from './billing-history-importer';
import { type YearConfig, getYearConfig } from './year-config';

// ============================================================================
// Parsers
// ============================================================================

/**
 * 從班別字串解析年次
 * "N高二班(107)" → 107
 * "M高三班(115)" → 115
 * "第一屆(105)" → 105
 * "家教班" → null
 */
export function parseCohort(classInfo: string): number | null {
    const match = classInfo.match(/\((\d{3})\)/);
    if (match) return parseInt(match[1]);
    return null;
}

// Status code mapping
function statusToCode(s: unknown): number {
    const upper = String(s || '').trim().toUpperCase();
    if (upper === 'YY') return 3;
    if (upper === 'Y') return 2;
    if (upper === 'V') return 1;
    if (upper === 'N') return 0;
    return -1;
}

export interface SyncResult {
    persons: number;
    enrollments: number;
    attendanceVectors: number;
    billingImport: ImportResult | null;
    errors: string[];
}

export interface YearSyncResult {
    academicYear: number;
    persons: number;
    enrollments: number;
    attendanceVectors: number;
    errors: string[];
}

// ============================================================================
// 多學年版本
// ============================================================================

/**
 * Pull students from specified year's 學生資料表 → persons + enrollments
 */
export async function pullStudentsForYear(
    config: YearConfig
): Promise<{ persons: number; enrollments: number }> {
    const rows = await readSheet(
        `'${config.studentSheetName}'!A:V`,
        config.spreadsheetId
    );
    if (rows.length < 2) return { persons: 0, enrollments: 0 };

    const personMap = new Map<string, number>();
    let personCount = 0, enrollCount = 0;

    for (let i = 1; i < rows.length; i++) {
        const row = rows[i] as string[];
        const sheetsId = String(row[0] || '').trim();
        const name = String(row[1] || '').trim();
        const classInfo = String(row[2] || '').trim();
        if (!sheetsId || !name) continue;

        let classCode = '', subject = '';
        if (classInfo.startsWith('N')) { classCode = 'N'; subject = '物理'; }
        else if (classInfo.startsWith('M')) { classCode = 'M'; subject = '數學'; }

        let status = 'active';
        if (classInfo.includes('永久停止')) status = '永久停止';
        else if (classInfo.includes('停')) status = 'dropped';
        else if (classInfo.includes('畢')) status = 'graduated';

        const phone = String(row[7] || '').trim();
        const dedupKey = `${name}|${phone}`;
        let personId = personMap.get(dedupKey);

        if (!personId) {
            const existing = await prisma.person.findFirst({
                where: { name, phone: phone || undefined },
            });
            if (existing) {
                personId = existing.id;
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

        // 解析年次
        const cohort = parseCohort(classInfo);

        // enrollment 用 sheetsId 去重
        const existingEnroll = await prisma.enrollment.findUnique({ where: { sheetsId } });
        if (!existingEnroll) {
            await prisma.enrollment.create({
                data: {
                    sheetsId, personId,
                    classCode: classCode || 'X',
                    subject: subject || classInfo,
                    className: classInfo,
                    cohort,
                    status,
                    startYear: config.academicYear,
                    endYear: config.academicYear,
                },
            });
            enrollCount++;
        } else {
            // 更新 endYear + cohort（如果之前沒解析到）
            const updateData: Record<string, unknown> = {};
            if (existingEnroll.endYear == null || config.academicYear > existingEnroll.endYear) {
                updateData.endYear = config.academicYear;
            }
            if (existingEnroll.cohort == null && cohort != null) {
                updateData.cohort = cohort;
            }
            if (Object.keys(updateData).length > 0) {
                await prisma.enrollment.update({
                    where: { sheetsId },
                    data: updateData,
                });
            }
        }
    }

    return { persons: personCount, enrollments: enrollCount };
}

/**
 * Pull attendance from specified year's YYYY/MM上課紀錄 → monthly_attendance
 */
export async function pullAttendanceForYear(config: YearConfig): Promise<number> {
    const allSheets = await listSheetNames(config.spreadsheetId);
    const attendanceSheets = allSheets.filter(n => config.attendance.sheetNamePattern.test(n));
    let totalVectors = 0;

    for (const sheetName of attendanceSheets) {
        const match = sheetName.match(/^(\d{4})\/(\d{2})上課紀錄$/);
        if (!match) continue;
        const year = parseInt(match[1]);
        const month = parseInt(match[2]);

        const rows = await readSheet(`'${sheetName}'!A:BZ`, config.spreadsheetId);
        if (rows.length < 4) continue;

        // Find header row (識別碼 or 識別號)
        let headerRowIdx = -1;
        for (let r = 0; r < Math.min(10, rows.length); r++) {
            const val = String(rows[r]?.[config.attendance.idCol] || '').trim();
            if (val === '識別碼' || val === '識別號') {
                headerRowIdx = r;
                break;
            }
        }
        if (headerRowIdx === -1) continue;

        // Build day→column mapping from header row
        const dayColMap = new Map<number, number>();
        const headerRow = rows[headerRowIdx];
        for (let c = config.attendance.dayColStart; c < (headerRow?.length || 0); c++) {
            const val = headerRow[c];
            const num = typeof val === 'number' ? val : parseInt(String(val || ''));
            if (!isNaN(num) && num >= 1 && num <= 31) {
                dayColMap.set(c, num);
            }
        }
        if (dayColMap.size === 0) continue;

        // Process student rows
        const dataStartIdx = headerRowIdx + 1;
        for (let r = dataStartIdx; r < rows.length; r++) {
            const row = rows[r];
            const sheetsId = String(row[config.attendance.idCol] || '').trim();
            if (!sheetsId || !/^\d+$/.test(sheetsId)) continue;

            const enrollment = await prisma.enrollment.findUnique({ where: { sheetsId } });
            if (!enrollment) continue;

            const days: number[] = new Array(31).fill(0);
            let hasAny = false;

            for (const [colIdx, day] of dayColMap) {
                const code = statusToCode(row[colIdx]);
                if (code >= 0) {
                    days[day - 1] = code;
                    if (code > 0) hasAny = true;
                }
            }
            if (!hasAny) continue;

            await prisma.monthlyAttendance.upsert({
                where: {
                    enrollmentId_year_month: { enrollmentId: enrollment.id, year, month },
                },
                update: { days },
                create: { enrollmentId: enrollment.id, year, month, days },
            });
            totalVectors++;
        }
    }

    return totalVectors;
}

/**
 * Pull all data for a specific academic year
 */
export async function pullForYear(config: YearConfig): Promise<YearSyncResult> {
    const errors: string[] = [];
    let students = { persons: 0, enrollments: 0 };
    let vectors = 0;

    try { students = await pullStudentsForYear(config); }
    catch (e) { errors.push(`Students(${config.academicYear}): ${e}`); }

    try { vectors = await pullAttendanceForYear(config); }
    catch (e) { errors.push(`Attendance(${config.academicYear}): ${e}`); }

    return {
        academicYear: config.academicYear,
        persons: students.persons,
        enrollments: students.enrollments,
        attendanceVectors: vectors,
        errors,
    };
}

/**
 * Pull all data for multiple academic years (sequential, oldest → newest)
 */
export async function pullMultipleYears(
    academicYears: number[]
): Promise<YearSyncResult[]> {
    const results: YearSyncResult[] = [];
    const sorted = [...academicYears].sort((a, b) => a - b);

    for (const year of sorted) {
        const config = getYearConfig(year);
        if (!config) {
            results.push({
                academicYear: year,
                persons: 0, enrollments: 0, attendanceVectors: 0,
                errors: [`No config found for academic year ${year}`],
            });
            continue;
        }
        console.log(`\n📋 同步 ${year} 學年...`);
        const result = await pullForYear(config);
        results.push(result);
        console.log(`  → persons: +${result.persons}, enrollments: +${result.enrollments}, attendance: ${result.attendanceVectors}`);
        if (result.errors.length > 0) {
            console.log(`  ⚠️ errors: ${result.errors.join('; ')}`);
        }
    }

    return results;
}

// ============================================================================
// 向後相容（預設 114 學年）
// ============================================================================

/** Pull students from 114學生資料表 (向後相容) */
export async function pullStudents(): Promise<{ persons: number; enrollments: number }> {
    const config = getYearConfig(114);
    if (!config) throw new Error('Config for year 114 not found');
    return pullStudentsForYear(config);
}

/** Pull attendance from 114 YYYY/MM上課紀錄 (向後相容) */
export async function pullAttendance(): Promise<number> {
    const config = getYearConfig(114);
    if (!config) throw new Error('Config for year 114 not found');
    return pullAttendanceForYear(config);
}

/**
 * Full sync: pull students + attendance + billing history (114 only)
 * 順序重要：billing 依賴 students (enrollment) 和 attendance 都已同步
 */
export async function pullAll(): Promise<SyncResult> {
    const errors: string[] = [];
    let students = { persons: 0, enrollments: 0 };
    let vectors = 0;
    let billingImport: ImportResult | null = null;

    try { students = await pullStudents(); }
    catch (e) { errors.push(`Students: ${e}`); }

    try { vectors = await pullAttendance(); }
    catch (e) { errors.push(`Attendance: ${e}`); }

    try { billingImport = await pullBillingHistory(); }
    catch (e) { errors.push(`BillingHistory: ${e}`); }

    return {
        persons: students.persons,
        enrollments: students.enrollments,
        attendanceVectors: vectors,
        billingImport,
        errors,
    };
}

// Re-export for direct access
export { pullBillingHistory } from './billing-history-importer';
