/**
 * compare-sheet-formats.ts — Deep column structure comparison across all 9 yearly Google Sheets (106~114)
 *
 * For each spreadsheet, reads 4 sheets:
 *   - 計費日期表 (billing date table)
 *   - 繳費金額表 (fee amount table)
 *   - 繳費日期表 (payment date table)
 *   - 學費收支總表 (tuition summary)
 *
 * Reports header fields, column positions, naming variations, and data type sampling.
 * Outputs a compatibility matrix at the end.
 */
import 'dotenv/config';
import { google } from 'googleapis';
import * as fs from 'fs';

// ============================================================================
// Config — spreadsheet IDs from audit-all-sheets.ts
// ============================================================================

const ALL_SHEETS: Record<string, string> = {
  '106': '1G90xbpj9JC-_3X2vv4i0lfDUmIPrBZsZ94-LKQj_-FE',
  '107': '13iwro7zS4Da_Z6Xnopn6nHlMfOYil-Id5ib2HyUrH2E',
  '108': '1RLv3XuGjeDZd3CEQOh-0Cn2azIJmozkwnI7gDliXC3U',
  '109': '1G7_Y7pDE__l3cpoG8TTbduweRQmIoQIlO7Q9010tb68',
  '110': '1zdzsxq2j17VVjY7gpETBX0kvkrQBAnFuv6MRztkFqa0',
  '111': '1GjCfmj1PiVdqITR1YuqYIf0AP5jHp5inTMoRpbcUGME',
  '112': '1a1jyPYVtjQPld9aHYSfCYug35GjZJihATzFd9t9FbBU',
  '113': '1iSIQyG5Gxerdmrwirr-JTBmlh9PE39dfA6UQz5Hs0Ps',
  '114': process.env.GOOGLE_SHEETS_SPREADSHEET_ID!,
};

const TARGET_SHEETS = ['計費日期表', '繳費金額表', '繳費日期表', '學費收支總表'];

// ============================================================================
// Types
// ============================================================================

interface SheetAnalysis {
  sheetName: string;
  exists: boolean;
  error?: string;
  colCount: number;
  headerRow: string[];
  row2: string[];
  row3: string[];
  row4: string[];  // 3rd data row (row index 3)
  // Key field positions
  idColLabel?: string;        // 識別碼 vs 識別號
  idColIndex?: number;
  nameColIndex?: number;
  classColIndex?: number;
  countColLabel?: string;     // 應發單次數 / 發單次數 / (none)
  countColIndex?: number;
  datePairsStartCol?: number;
  // For 學費收支總表: check cols S/T
  hasColS?: boolean;
  hasColT?: boolean;
  colSLabel?: string;
  colTLabel?: string;
}

interface YearAnalysis {
  year: string;
  sheets: Record<string, SheetAnalysis>;
}

// ============================================================================
// Helpers
// ============================================================================

function cellToString(cell: unknown): string {
  if (cell === undefined || cell === null) return '';
  if (typeof cell === 'number') return `[num:${cell}]`;
  return String(cell);
}

function cellTypeLabel(cell: unknown): string {
  if (cell === undefined || cell === null) return 'empty';
  if (typeof cell === 'number') return 'number';
  if (typeof cell === 'boolean') return 'boolean';
  const s = String(cell).trim();
  if (s === '') return 'empty';
  if (/^\d+$/.test(s)) return 'int-str';
  if (/^\d{4}[/-]\d{1,2}[/-]\d{1,2}/.test(s)) return 'date-str';
  return 'string';
}

function truncate(s: string, len: number): string {
  return s.length > len ? s.substring(0, len - 2) + '..' : s;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const credentials = JSON.parse(fs.readFileSync(process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH!, 'utf-8'));
  const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  const sheetsApi = google.sheets({ version: 'v4', auth });

  const results: YearAnalysis[] = [];

  for (const [year, spreadsheetId] of Object.entries(ALL_SHEETS)) {
    console.log(`\n${'='.repeat(100)}`);
    console.log(`  ${year} 學年  (spreadsheet: ${spreadsheetId.substring(0, 20)}...)`);
    console.log(`${'='.repeat(100)}`);

    const yearResult: YearAnalysis = { year, sheets: {} };

    for (const sheetName of TARGET_SHEETS) {
      const analysis: SheetAnalysis = {
        sheetName,
        exists: false,
        colCount: 0,
        headerRow: [],
        row2: [],
        row3: [],
        row4: [],
      };

      try {
        const r = await sheetsApi.spreadsheets.values.get({
          spreadsheetId,
          range: `'${sheetName}'!A1:AZ5`,
          valueRenderOption: 'UNFORMATTED_VALUE',
        });
        const rows = r.data.values || [];
        analysis.exists = true;

        const header = (rows[0] || []) as unknown[];
        const dataRow1 = (rows[1] || []) as unknown[];
        const dataRow2 = (rows[2] || []) as unknown[];
        const dataRow3 = (rows[3] || []) as unknown[];

        analysis.colCount = Math.max(header.length, dataRow1.length, dataRow2.length);
        analysis.headerRow = header.map(cellToString);
        analysis.row2 = dataRow1.map(cellToString);
        analysis.row3 = dataRow2.map(cellToString);
        analysis.row4 = dataRow3.map(cellToString);

        // Detect key fields
        for (let c = 0; c < header.length; c++) {
          const h = String(header[c] || '').trim();
          if (h.includes('識別碼') || h.includes('識別號')) {
            analysis.idColLabel = h;
            analysis.idColIndex = c;
          }
          if (h === '姓名') analysis.nameColIndex = c;
          if (h === '班別') analysis.classColIndex = c;
          if (h.includes('次數') || h.includes('發單')) {
            analysis.countColLabel = h;
            analysis.countColIndex = c;
          }
        }

        // Detect date pairs start column
        // Usually the column after count (or after class if no count)
        if (analysis.countColIndex !== undefined) {
          analysis.datePairsStartCol = analysis.countColIndex + 1;
        } else if (analysis.classColIndex !== undefined) {
          // Check if col after class is a number (date serial) or another header
          const nextCol = analysis.classColIndex + 1;
          if (nextCol < header.length) {
            const val = header[nextCol];
            if (typeof val === 'number' || (typeof val === 'string' && /^\d+$/.test(val.trim()))) {
              analysis.datePairsStartCol = nextCol;
            }
          }
        }

        // For 學費收支總表, check cols S(18) and T(19)
        if (sheetName === '學費收支總表') {
          analysis.hasColS = header.length > 18 && header[18] !== undefined && header[18] !== null && String(header[18]).trim() !== '';
          analysis.hasColT = header.length > 19 && header[19] !== undefined && header[19] !== null && String(header[19]).trim() !== '';
          analysis.colSLabel = header.length > 18 ? cellToString(header[18]) : '';
          analysis.colTLabel = header.length > 19 ? cellToString(header[19]) : '';
        }

      } catch (err: any) {
        analysis.exists = false;
        analysis.error = err.message?.substring(0, 80) || 'unknown error';
      }

      yearResult.sheets[sheetName] = analysis;

      // Print per-sheet detail
      console.log(`\n  --- ${sheetName} ---`);
      if (!analysis.exists) {
        console.log(`    NOT FOUND: ${analysis.error}`);
        continue;
      }

      console.log(`    Columns: ${analysis.colCount}`);
      console.log(`    Header:  [${analysis.headerRow.map(h => truncate(h, 14)).join(' | ')}]`);
      console.log(`    Row 2:   [${analysis.row2.map(h => truncate(h, 14)).join(' | ')}]`);
      console.log(`    Row 3:   [${analysis.row3.map(h => truncate(h, 14)).join(' | ')}]`);
      console.log(`    Row 4:   [${analysis.row4.map(h => truncate(h, 14)).join(' | ')}]`);

      console.log(`    ID col:  ${analysis.idColIndex !== undefined ? `col ${analysis.idColIndex} = "${analysis.idColLabel}"` : '(not found in header)'}`);
      console.log(`    Name:    col ${analysis.nameColIndex}`);
      console.log(`    Class:   col ${analysis.classColIndex}`);
      console.log(`    Count:   ${analysis.countColIndex !== undefined ? `col ${analysis.countColIndex} = "${analysis.countColLabel}"` : '(none)'}`);
      console.log(`    Dates@:  col ${analysis.datePairsStartCol ?? '?'}`);

      if (sheetName === '學費收支總表') {
        console.log(`    Col S(18): ${analysis.hasColS ? `"${analysis.colSLabel}"` : '(empty/missing)'}`);
        console.log(`    Col T(19): ${analysis.hasColT ? `"${analysis.colTLabel}"` : '(empty/missing)'}`);
      }

      // Data type sampling
      const types2 = analysis.row2.map((_, i) => {
        const raw = (i < (yearResult.sheets[sheetName] as any).__rawRow1?.length) ? undefined : undefined;
        return cellTypeLabel(analysis.row2[i] === '' ? undefined : analysis.row2[i]);
      });
      console.log(`    Types r2: [${types2.join(', ')}]`);
    }

    results.push(yearResult);
  }

  // ============================================================================
  // Compatibility Matrix
  // ============================================================================

  console.log(`\n\n${'='.repeat(100)}`);
  console.log('  COMPATIBILITY MATRIX');
  console.log(`${'='.repeat(100)}`);

  for (const sheetName of TARGET_SHEETS) {
    console.log(`\n  === ${sheetName} ===`);

    // Build a fingerprint for each year
    const fingerprints: Record<string, string> = {};
    for (const yr of results) {
      const s = yr.sheets[sheetName];
      if (!s || !s.exists) {
        fingerprints[yr.year] = 'MISSING';
        continue;
      }
      // Fingerprint: idLabel | countLabel | colCount | datePairsStart | first 5 header fields
      const fp = [
        s.idColLabel || '(no-id-header)',
        s.countColLabel || '(no-count)',
        `cols=${s.colCount}`,
        `dates@${s.datePairsStartCol ?? '?'}`,
        `hdr=[${s.headerRow.slice(0, 6).join(',')}]`,
      ].join(' | ');
      fingerprints[yr.year] = fp;

      if (sheetName === '學費收支總表') {
        fingerprints[yr.year] += ` | S=${s.colSLabel || '(none)'} T=${s.colTLabel || '(none)'}`;
      }
    }

    // Group years by fingerprint
    const groups = new Map<string, string[]>();
    for (const [year, fp] of Object.entries(fingerprints)) {
      const existing = groups.get(fp) || [];
      existing.push(year);
      groups.set(fp, existing);
    }

    let groupIdx = 0;
    for (const [fp, years] of groups) {
      groupIdx++;
      console.log(`    Format ${groupIdx}: Years [${years.join(', ')}]`);
      console.log(`      ${fp}`);
    }
  }

  // ============================================================================
  // Cross-year header comparison table
  // ============================================================================

  console.log(`\n\n${'='.repeat(100)}`);
  console.log('  HEADER COMPARISON (first 8 cols, all sheets)');
  console.log(`${'='.repeat(100)}`);

  for (const sheetName of TARGET_SHEETS) {
    console.log(`\n  === ${sheetName} ===`);
    console.log(`  ${'Year'.padEnd(6)} | ${'Col A'.padEnd(10)} | ${'Col B'.padEnd(10)} | ${'Col C'.padEnd(10)} | ${'Col D'.padEnd(14)} | ${'Col E'.padEnd(10)} | ${'Col F'.padEnd(10)} | ${'Col G'.padEnd(10)} | ${'Col H'.padEnd(10)} | Total`);
    console.log(`  ${'-'.repeat(6)} | ${'-'.repeat(10)} | ${'-'.repeat(10)} | ${'-'.repeat(10)} | ${'-'.repeat(14)} | ${'-'.repeat(10)} | ${'-'.repeat(10)} | ${'-'.repeat(10)} | ${'-'.repeat(10)} | -----`);

    for (const yr of results) {
      const s = yr.sheets[sheetName];
      if (!s || !s.exists) {
        console.log(`  ${yr.year.padEnd(6)} | MISSING`);
        continue;
      }
      const cols = [];
      for (let i = 0; i < 8; i++) {
        const w = i === 3 ? 14 : 10;
        cols.push(truncate(s.headerRow[i] || '', w).padEnd(w));
      }
      console.log(`  ${yr.year.padEnd(6)} | ${cols.join(' | ')} | ${s.colCount}`);
    }
  }

  console.log('\nDone.');
}

main().catch(console.error);
