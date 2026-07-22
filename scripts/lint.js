const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const roots = ['src', 'test', 'scripts'];
const files = [];
function collect(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(full);
    else if (entry.name.endsWith('.js')) files.push(full);
  }
}
for (const root of roots) collect(path.join(process.cwd(), root));
let failed = false;
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    failed = true;
    console.error(`Syntax error in ${path.relative(process.cwd(), file)}\n${result.stderr}`);
  }
}
if (failed) process.exit(1);
console.log(`Syntax validation passed for ${files.length} JavaScript files.`);
