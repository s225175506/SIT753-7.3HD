const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'reports');
fs.mkdirSync(outDir, { recursive: true });

let eslintOk = true;
let eslintOutput = '';
try {
  eslintOutput = execSync('npx eslint src tests scripts -f json', {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
} catch (err) {
  eslintOk = false;
  eslintOutput = err.stdout || '[]';
}

const results = JSON.parse(eslintOutput || '[]');
let errorCount = 0;
let warningCount = 0;
for (const file of results) {
  errorCount += file.errorCount || 0;
  warningCount += file.warningCount || 0;
}

const report = {
  tool: 'ESLint',
  purpose: 'Code quality — structure, style, and maintainability (not a security scanner)',
  generatedAt: new Date().toISOString(),
  summary: {
    filesAnalysed: results.length,
    errors: errorCount,
    warnings: warningCount,
    qualityGate: errorCount === 0 ? 'PASSED' : 'FAILED',
  },
  thresholds: {
    maxErrors: 0,
    maxWarnings: 0,
  },
  notes: [
    'Quality gate fails the pipeline if ESLint reports any errors.',
    'Rules focus on unused vars, equality, and complexity — similar intent to a SonarQube style gate.',
  ],
};

fs.writeFileSync(path.join(outDir, 'code-quality.json'), JSON.stringify(report, null, 2));

const md = [
  '# Code Quality Report',
  '',
  `- Tool: ${report.tool}`,
  `- Files analysed: ${report.summary.filesAnalysed}`,
  `- Errors: ${report.summary.errors}`,
  `- Warnings: ${report.summary.warnings}`,
  `- Quality gate: **${report.summary.qualityGate}**`,
  '',
  report.notes.map((n) => `- ${n}`).join('\n'),
  '',
].join('\n');

fs.writeFileSync(path.join(outDir, 'code-quality.md'), md);
console.log(md);

if (!eslintOk || errorCount > 0) {
  process.exit(1);
}
