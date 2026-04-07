import 'dotenv/config';
import pg from 'pg';

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  // List all tables
  const { rows: tables } = await client.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name`);
  console.log('=== Tables ===');
  for (const t of tables) console.log(' ', t.table_name);

  // 591 invoices
  const { rows: inv } = await client.query(`
    SELECT i.serial_number, i.start_date, i.end_date, i.amount, i.status, i.records, i.pdf_path,
           p.name, e.class_code
    FROM invoices i JOIN enrollments e ON i.enrollment_id = e.id JOIN persons p ON e.person_id = p.id
    WHERE e.sheets_id = '591'
    ORDER BY i.serial_number
  `);
  console.log('\n=== 591 all invoices ===');
  for (const r of inv) {
    const sd = r.start_date?.toISOString().slice(0, 10);
    const ed = r.end_date?.toISOString().slice(0, 10);
    console.log(r.serial_number, r.name, sd, '~', ed, '$' + r.amount, r.status, r.pdf_path ? 'PDF✓' : 'noPDF');
  }

  const latest = inv.find((i: any) => i.status === 'draft');
  if (latest) {
    console.log('\n=== draft records ===');
    console.log(JSON.stringify(latest.records, null, 2));
  }

  // Try to find attendance table
  const attTable = tables.find((t: any) => t.table_name.includes('attend'));
  if (attTable) {
    console.log('\nUsing attendance table:', attTable.table_name);
    const { rows: att } = await client.query(`
      SELECT av.dates, av.statuses
      FROM "${attTable.table_name}" av JOIN enrollments e ON av.enrollment_id = e.id
      WHERE e.sheets_id = '591'
      ORDER BY av.updated_at DESC LIMIT 1
    `);
    if (att.length > 0) {
      const d = att[0].dates as string[];
      const s = att[0].statuses as number[];
      console.log('\n=== Attendance (status>0) ===');
      for (let i = 0; i < d.length; i++) {
        if (s[i] > 0) console.log(d[i], 'status=' + s[i]);
      }
    }
  }

  await client.end();
}
main().catch(e => { console.error(e); process.exit(1); });
