'use server';

import prisma from '@/lib/prisma';
import { getAcademicYearBySpreadsheetId, getYearConfig } from '@/lib/year-config';
import { writeSheet } from '@/lib/sheets';
import { revalidatePath } from 'next/cache';

export async function updateSemesterFee(data: {
  sheetsId: string;
  semester: 1 | 2;
  academicYear: number;
  amount: number;
  feeDateStr: string; // YYYY-MM-DD
}) {
  const { sheetsId, semester, academicYear, amount, feeDateStr } = data;
  
  // 1. Validate Date
  const feeDate = feeDateStr ? new Date(feeDateStr + 'T12:00:00Z') : null;

  // 2. Find enrollment
  const enrollment = await prisma.enrollment.findUnique({
    where: { sheetsId },
  });
  if (!enrollment) throw new Error('Enrollment not found');

  // 3. Update or create DB record
  const record = await prisma.semesterFee.upsert({
    where: {
      enrollmentId_academicYear_semester: {
        enrollmentId: enrollment.id,
        academicYear,
        semester,
      },
    },
    update: {
      amount,
      feeDate,
      status: 'paid', // If we are setting amount & date, we assume it's paid. Or we could let the user choose. But usually if there is an amount/date, it's paid.
    },
    create: {
      enrollmentId: enrollment.id,
      academicYear,
      semester,
      amount,
      feeDate,
      status: 'paid',
    },
  });

  try {
    const config = getYearConfig(academicYear);
    if (config && config.miscFee) {
      // 讀取 學費收支總表 的 A 欄 (識別碼) 以對應 Row
      const { readSheet, writeSheet } = await import('@/lib/sheets');
      const rows = await readSheet("'學費收支總表'!A:A", config.spreadsheetId);
      
      let targetRowIdx = -1;
      for (let r = 0; r < rows.length; r++) {
        if (String(rows[r]?.[0]) === sheetsId) {
          targetRowIdx = r + 1; // 1-based for A1 notation
          break;
        }
      }

      if (targetRowIdx > 0) {
        // Col index to letter. X=23, Y=24, Z=25, AA=26
        const colLetter = (colIdx: number) => {
          let letter = '';
          let c = colIdx;
          while (c >= 0) {
            letter = String.fromCharCode((c % 26) + 65) + letter;
            c = Math.floor(c / 26) - 1;
          }
          return letter;
        };

        const { upperAmountCol, upperDateCol, lowerAmountCol, lowerDateCol } = config.miscFee;
        const amountCol = semester === 1 ? upperAmountCol : lowerAmountCol;
        const dateCol = semester === 1 ? upperDateCol : lowerDateCol;

        // Date format: MM/DD
        const formattedDate = feeDate ? `${feeDate.getMonth() + 1}/${feeDate.getDate()}` : '';

        // Write amount
        await writeSheet(
          `'學費收支總表'!${colLetter(amountCol)}${targetRowIdx}`,
          [[amount]],
          config.spreadsheetId
        );

        // Write date
        await writeSheet(
          `'學費收支總表'!${colLetter(dateCol)}${targetRowIdx}`,
          [[formattedDate]],
          config.spreadsheetId
        );
      }
    }
  } catch (error) {
    console.error('Failed to sync semester fee to sheets:', error);
  }

  revalidatePath('/semester-fees');
  return { success: true };
}
