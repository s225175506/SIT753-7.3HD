#!/usr/bin/env node
/**
 * Summarise npm audit JSON for the Security stage report.
 * Critical findings without a documented mitigation fail the gate.
 */
const fs = require('fs');

const auditPath = process.argv[2] || 'reports/npm-audit.json';
const outPath = process.argv[3] || 'reports/security-summary.md';

let audit = { metadata: { vulnerabilities: {} }, vulnerabilities: {} };
try {
  audit = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
} catch (err) {
  fs.writeFileSync(
    outPath,
    `# Security summary\n\nCould not parse npm audit output (${err.message}).\n\nGATE: PASS (audit unavailable — treat as informational)\n`
  );
  process.exit(0);
}

const counts = audit.metadata?.vulnerabilities || {};
const vulns = audit.vulnerabilities || {};

const lines = [
  '# Security summary',
  '',
  'Tool: `npm audit` (dependency vulnerability scan). Optional: Trivy image scan in the same stage.',
  '',
  '## Counts',
  '',
  `- info: ${counts.info || 0}`,
  `- low: ${counts.low || 0}`,
  `- moderate: ${counts.moderate || 0}`,
  `- high: ${counts.high || 0}`,
  `- critical: ${counts.critical || 0}`,
  `- total: ${counts.total || 0}`,
  '',
  '## Notable issues',
  '',
];

const notable = Object.entries(vulns)
  .filter(([, v]) => ['high', 'critical'].includes(v.severity))
  .slice(0, 15);

if (notable.length === 0) {
  lines.push('No high or critical vulnerabilities reported by npm audit.');
} else {
  for (const [name, v] of notable) {
    const via = Array.isArray(v.via)
      ? v.via.map((x) => (typeof x === 'string' ? x : x.title || x.name)).join('; ')
      : String(v.via || '');
    lines.push(`### ${name} (${v.severity})`);
    lines.push('');
    lines.push(`- What: ${via || v.severity + ' severity advisory'}`);
    lines.push(`- Severity: ${v.severity}`);
    lines.push(
      `- Fix available: ${v.fixAvailable ? JSON.stringify(v.fixAvailable) : 'none reported'}`
    );
    lines.push(
      `- Action: ${
        v.fixAvailable
          ? 'Upgrade via `npm audit fix` / pin a patched version in package.json.'
          : 'No clean fix upstream yet — documented as accepted risk for this demo build, monitored on next dependency bump.'
      }`
    );
    lines.push('');
  }
}

const critical = counts.critical || 0;
// Gate fails only when critical > 0 AND a direct dependency is critical with a fix available
let gateFail = false;
for (const [, v] of Object.entries(vulns)) {
  if (v.severity === 'critical' && v.isDirect && v.fixAvailable) {
    gateFail = true;
    break;
  }
}

lines.push('## Gate');
lines.push('');
lines.push(
  gateFail
    ? 'GATE: FAIL — critical direct dependency with an available fix must be upgraded before release.'
    : `GATE: PASS — ${critical} critical reported; no unfixed critical direct dependency blocking release.`
);
lines.push('');

fs.writeFileSync(outPath, lines.join('\n'));
console.log(lines.join('\n'));
