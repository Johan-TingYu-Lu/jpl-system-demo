import 'dotenv/config';
import { google } from 'googleapis';
import * as fs from 'fs';

const credentials = JSON.parse(fs.readFileSync(process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH!, 'utf-8'));
const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const sheets = google.sheets({ version: 'v4', auth });
const SID = process.env.GOOGLE_SHEETS_SPREADSHEET_ID!;

async function main() {
  const sheetName = '114學生資料表';
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SID,
    range: `'${sheetName}'!A:F`,
  });

  const rows = res.data.values as string[][];
  let rowIndex = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][0] === '704') {
      rowIndex = i + 1;
      break;
    }
  }

  if (rowIndex !== -1) {
    console.log(`Found row ${rowIndex} for 704. Current class: ${rows[rowIndex - 1][3]}`);
    await sheets.spreadsheets.values.update({
      spreadsheetId: SID,
      range: `'${sheetName}'!D${rowIndex}`,
      valueInputOption: 'RAW',
      requestBody: { values: [['M高一班(117)']] }
    });
    console.log('Updated Sheets successfully!');
  } else {
    console.log('Not found in Sheets');
  }
}

main().catch(console.error);
