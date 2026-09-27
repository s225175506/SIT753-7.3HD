const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');
const version = process.env.APP_VERSION || require('../package.json').version;
const buildId = process.env.BUILD_NUMBER || `local-${Date.now()}`;

fs.mkdirSync(dist, { recursive: true });

const manifest = {
  name: 'taskflow-api',
  version,
  buildId,
  builtAt: new Date().toISOString(),
  artefact: 'taskflow-api',
  node: process.version,
};

fs.writeFileSync(path.join(dist, 'build-manifest.json'), JSON.stringify(manifest, null, 2));
fs.writeFileSync(path.join(dist, 'VERSION'), `${version}+${buildId}\n`);

console.log(`Build artefact written to dist/ (version ${version}+${buildId})`);
