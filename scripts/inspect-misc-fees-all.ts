import 'dotenv/config';
import { google } from 'googleapis';
import * as fs from 'fs';
import { YEAR_CONFIGS } from '../src/lib/year-config';

async function main() {
  const credentials = JSON.parse(fs.readFileSync(process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH!, 'utf-8'));
  const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  const sheetsApi = google.sheets({ version: 'v4', auth });

  for (const config of YEAR_CONFIGS) {
    try {
      const r = await sheetsApi.spreadsheets.values.get({
        spreadsheetId: config.spreadsheetId,
        range: "'學費收支總表'!A1:AZ2",
        valueRenderOption: 'UNFORMATTED_VALUE',
      });
      const header = (r.data.values || [])[0] || [];
      const row2 = (r.data.values || [])[1] || [];

      // Find 雜費 columns
      const miscCols: string[] = [];
      for (let i = 0; i < header.length; i++) {
        const h = String(header[i] || '');
        if (h.includes('雜費')) {
          miscCols.push(`col${i}="${h}" val="${row2[i] ?? ''}"`);
        }
      }
      console.log(`${config.academicYear}: cols=${header.length} | ${miscCols.length > 0 ? miscCols.join(' | ') : '❌ 無雜費欄位'}`);
    } catch (e: any) {
      console.log(`${config.academicYear}: ❌ ${e.message?.substring(0, 60)}`);
    }
  }
}
main();
