/**
 * Test: 生成一張收費單 PDF (用第一張 invoice 測試)
 */
import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import * as crypto from 'crypto';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const OUTPUT_DIR = path.resolve(__dirname, '../generated_invoices');
const STAMP_TAX = 'C:/Users/johan/Documents/NEW_SYSTEM/Stamp/印花稅 (1).jpg';
const STAMP_LARGE = 'C:/Users/johan/Documents/NEW_SYSTEM/Stamp/大印數位檔.jpg';
const BASE_URL = 'https://jpl.app/verify';

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

function escTex(s: string): string {
    return s.replace(/[&%$#_{}]/g, c => `\\${c}`);
}

async function main() {
    // Get first invoice with records
    const inv = await prisma.invoice.findFirst({
        where: { records: { not: undefined } },
        include: {
            enrollment: {
                include: { person: { select: { name: true } } },
            },
        },
        orderBy: { id: 'asc' },
    });

    if (!inv) { console.log('No invoices found'); return; }

    const records = inv.records as { date: string; status: number; y: number; fee: number }[];
    const dates = records.map(r => r.date);
    const shortDates = dates.map(d => d.slice(5));
    const months = [...new Set(dates.map(d => d.split('/')[1]))].sort();
    const billYear = dates[0].split('/')[0];
    const billMonth = months.length > 1 ? `${months[0]}-${months[-1]}` : months[0];
    const qrUrl = `${BASE_URL}/${inv.hashCode}`;

    console.log(`Testing with: ${inv.serialNumber} ${inv.enrollment.person.name} (${inv.enrollment.classCode})`);
    console.log(`  Dates: ${shortDates.join(', ')}`);
    console.log(`  Amount: $${inv.amount}, totalY: ${inv.totalY}`);

    // Build date cells for top table (with header)
    function dateRow(ds: string[]): string {
        while (ds.length % 5 !== 0) ds.push('');
        let rows = '';
        for (let i = 0; i < ds.length; i += 5) {
            rows += ds.slice(i, i + 5).map(d => d ? `\\large\\textbf{${d}}` : '').join(' & ') + ' \\\\\n\\hline\n';
        }
        return rows;
    }

    const dateTableTop = `\\begin{tabular}{|*{5}{>{\\centering\\arraybackslash}p{2.8cm}|}}
\\hline
\\multicolumn{5}{|c|}{\\Large\\textbf{上課紀錄}} \\\\
\\hline
${dateRow([...shortDates])}\\end{tabular}`;

    const dateTableBottom = `\\begin{tabular}{|*{5}{>{\\centering\\arraybackslash}p{2.8cm}|}}
\\hline
${dateRow([...shortDates])}\\end{tabular}`;

    const name = inv.enrollment.person.name;
    const subject = inv.enrollment.subject;
    const sessionCount = records.length;
    const sessionInfo = `${sessionCount}次${sessionCount * 3}H`;
    const receiptText = `茲\\hspace{0.5em}收到 貴子弟 ${escTex(name)}，${billYear}年 ${billMonth} 月 課程費用 ${inv.amount} 元整。`;

    const tex = `% JPL Invoice Test
\\documentclass[a4paper]{article}
\\usepackage[top=1.5cm, bottom=1.5cm, left=2cm, right=2cm]{geometry}
\\usepackage{xeCJK}
\\setCJKmainfont{標楷體}
\\usepackage{graphicx}
\\usepackage{array}
\\usepackage{tikz}
\\usepackage{qrcode}
\\pagestyle{empty}
\\setlength{\\parindent}{0pt}
\\setlength{\\tabcolsep}{4pt}

\\begin{document}

% === TOP HALF: 收費單 ===
\\begin{flushright}
\\small 收費單編號：${escTex(inv.serialNumber)}\\quad 驗證碼：${inv.hashCode}
\\end{flushright}

\\vspace{2mm}

\\begin{center}
{\\LARGE\\bfseries 臺東縣私立尬數理工文理短期補習班\\quad 收費單}
\\end{center}

\\vspace{4mm}

\\begin{center}
\\renewcommand{\\arraystretch}{1.8}
\\begin{tabular}{|p{3.2cm}|p{4.5cm}|p{3.2cm}|p{4.5cm}|}
\\hline
\\large 學生姓名： & \\large ${escTex(name)}（${escTex(subject)}） & \\large 收費日期： & \\large \\textbf{2026/03/09} \\\\
\\hline
\\large 上課次數： & \\large ${sessionInfo} & \\large 收費金額： & \\large \\textbf{${inv.amount}} \\\\
\\hline
\\end{tabular}
\\end{center}

\\vspace{4mm}

\\begin{center}
\\renewcommand{\\arraystretch}{1.6}
${dateTableTop}
\\end{center}

\\vspace{8mm}

% === TEAR LINE ===
\\begin{center}
\\begin{tikzpicture}
\\draw[dashed, gray, thick] (0,0) -- (\\textwidth - 1cm,0);
\\node at (\\textwidth/2 - 0.5cm, 0) [fill=white, text=gray] {\\small\\quad \\( \\times \\) \\quad};
\\end{tikzpicture}
\\end{center}

\\vspace{4mm}

% === BOTTOM HALF: 繳費收據 ===
\\begin{flushright}
\\small 收費單編號：${escTex(inv.serialNumber)}\\quad 驗證碼：${inv.hashCode}
\\end{flushright}

\\vspace{2mm}

\\begin{center}
{\\LARGE\\bfseries 臺東縣私立尬數理工文理短期補習班\\quad 繳費收據}
\\end{center}

\\vspace{4mm}

\\begin{center}
\\renewcommand{\\arraystretch}{1.8}
\\begin{tabular}{|p{3.2cm}|p{4.5cm}|p{3.2cm}|p{4.5cm}|}
\\hline
\\large 學生姓名： & \\large ${escTex(name)}（${escTex(subject)}） & \\large 收費日期： & \\large \\textbf{2026/03/09} \\\\
\\hline
\\large 上課次數： & \\large ${sessionInfo} & \\large 收費金額： & \\large \\textbf{${inv.amount}} \\\\
\\hline
\\end{tabular}
\\end{center}

\\vspace{2mm}

\\begin{center}
\\renewcommand{\\arraystretch}{1.6}
${dateTableBottom}
\\end{center}

\\vspace{4mm}

\\begin{center}
\\large ${receiptText}
\\end{center}

\\vspace{2mm}

{\\large \\hfill 此\\qquad 據 \\hfill\\hfill}

\\vspace{6mm}

% === STAMPS + QR ===
\\begin{center}
\\begin{tabular}{m{3cm} m{5.5cm} m{3cm} m{2.8cm}}
\\centering \\includegraphics[height=2.8cm]{${STAMP_TAX}} &
\\centering
{\\large 臺東縣私立尬數理工文理}

{\\large 短期補習班}

\\vspace{3mm}
{\\large 經收人：\\underline{\\hspace{2.5cm}}}
&
\\centering \\includegraphics[height=2.8cm]{${STAMP_LARGE}} &
\\centering \\qrcode[height=2.5cm]{${qrUrl}}
\\end{tabular}
\\end{center}

\\vspace{4mm}

{\\large \\hfill ${billYear}年\\quad\\underline{\\hspace{1.5cm}}\\quad 月\\quad\\underline{\\hspace{1.5cm}}\\quad 日 \\hspace{1cm}}

% === PAGE 2: Notes ===
\\newpage

\\vspace*{5mm}

{\\large 收費次數：每次上課為兩節課，若有特殊狀況，以一節計費。}

\\vspace{3mm}

{\\large 如有任何問題，歡迎家長聯繫：\\quad 0972-029097，呂老師。}

\\begin{flushright}
{\\large （LINE：johansoros）}
\\end{flushright}

\\vspace{3mm}

{\\large 若有意以電子支付或匯款當期費用，亦可透過 LINE PAY、Taiwan Pay 等支付工具。謝謝您。}

\\vspace{10mm}

\\begin{center}
掃描 QR Code 可於線上驗證本收費單：

\\vspace{3mm}
\\qrcode[height=3cm]{${qrUrl}}

\\vspace{2mm}
{\\small ${qrUrl}}
\\end{center}

\\end{document}
`;

    const texPath = path.join(OUTPUT_DIR, 'test_invoice.tex');
    const pdfPath = path.join(OUTPUT_DIR, 'test_invoice.pdf');
    fs.writeFileSync(texPath, tex, 'utf-8');
    console.log(`\nWrote: ${texPath}`);

    // Compile
    try {
        console.log('Compiling with xelatex...');
        execSync(
            `xelatex -interaction=nonstopmode -output-directory="${OUTPUT_DIR}" "${texPath}"`,
            { timeout: 60000, stdio: 'pipe' }
        );
        console.log(`✅ PDF generated: ${pdfPath}`);

        // Clean aux files
        for (const ext of ['.aux', '.log', '.out']) {
            const f = path.join(OUTPUT_DIR, `test_invoice${ext}`);
            if (fs.existsSync(f)) fs.unlinkSync(f);
        }
    } catch (e: any) {
        console.error('❌ XeLaTeX failed');
        const logPath = path.join(OUTPUT_DIR, 'test_invoice.log');
        if (fs.existsSync(logPath)) {
            const log = fs.readFileSync(logPath, 'utf-8');
            const errorLines = log.split('\n').filter(l => l.startsWith('!') || l.includes('Error'));
            errorLines.forEach(l => console.error(`  ${l}`));
            // Also show last 20 lines
            const lines = log.split('\n');
            console.error('\nLast 20 lines of log:');
            lines.slice(-20).forEach(l => console.error(`  ${l}`));
        }
    }
}

main()
    .catch(e => { console.error('❌', e); process.exit(1); })
    .finally(() => prisma.$disconnect());
