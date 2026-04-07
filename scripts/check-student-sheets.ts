import 'dotenv/config';
import { listSheetNames } from '../src/lib/sheets';
import { YEAR_CONFIGS } from '../src/lib/year-config';

async function main() {
  for (const config of YEAR_CONFIGS) {
    const names = await listSheetNames(config.spreadsheetId);
    const studentSheet = names.find(n => n.includes('學生資料'));
    const expected = config.studentSheetName;
    const match = names.includes(expected);
    console.log(`${config.academicYear}: expected="${expected}" actual="${studentSheet}" ${match ? '✅' : '❌ MISMATCH'}`);
  }
}
main();
