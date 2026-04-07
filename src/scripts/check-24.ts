import 'dotenv/config';
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const ids = ['479','558','561','590','596','606','607','611','612','621','626','633','634','637','641','648','649','652','661','665','676','677','685','686'];

async function main() {
  const { rows } = await pool.query(`
    SELECT e.sheets_id as id, p.name, e.class_name as cls, e.status as enroll,
           COUNT(i.id)::int as db_count,
           COUNT(i.id) FILTER (WHERE i.status='draft')::int as draft,
           COUNT(i.id) FILTER (WHERE i.status='paid')::int as paid,
           COUNT(i.id) FILTER (WHERE i.pdf_path IS NOT NULL)::int as has_pdf,
           COUNT(i.id) FILTER (WHERE i.pdf_path IS NULL AND i.id IS NOT NULL)::int as no_pdf,
           MAX(i.serial_number) as latest_serial,
           (array_agg(i.status ORDER BY i.serial_number DESC))[1] as latest_status,
           (array_agg(i.created_at ORDER BY i.serial_number DESC))[1]::text as latest_created
    FROM enrollments e
    JOIN persons p ON e.person_id = p.id
    LEFT JOIN invoices i ON i.enrollment_id = e.id AND i.serial_number LIKE '26-%'
    WHERE e.sheets_id = ANY($1)
    GROUP BY e.sheets_id, p.name, e.class_name, e.status
    ORDER BY e.sheets_id::int
  `, [ids]);

  console.log('ID\t姓名\t班級\tDB數\t已繳\tdraft\tPDF有\tPDF無\t最新序號\t\t最新狀態\t生成日');
  console.log('—'.repeat(90));
  for (const r of rows) {
    console.log(`${r.id}\t${r.name}\t${r.cls}\t${r.db_count}\t${r.paid}\t${r.draft}\t${r.has_pdf}\t${r.no_pdf}\t${r.latest_serial || '—'}\t${r.latest_status || '—'}\t${r.latest_created ? r.latest_created.slice(0,10) : '—'}`);
  }

  // Missing IDs (no enrollment at all)
  const found = new Set(rows.map((r: any) => r.id));
  const missing = ids.filter(id => !found.has(id));
  if (missing.length > 0) {
    console.log(`\n⚠️ DB 無 enrollment: ${missing.join(', ')}`);
  }

  await pool.end();
}
main().catch(e => console.error('ERR:', e.message));
