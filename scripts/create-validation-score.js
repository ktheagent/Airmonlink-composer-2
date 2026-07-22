const fs = require('node:fs');
const path = require('node:path');
const model = require('../src/core/score-model');
const airscore = require('../src/core/airscore');

const target = process.argv[2];
if (!target) {
  console.error('Usage: node scripts/create-validation-score.js <output.airscore>');
  process.exit(2);
}
const score = model.createScore({
  title: 'Windows Validation Score',
  composer: 'Airmonlink CI',
  template: 'lead',
  measures: 2
});
fs.mkdirSync(path.dirname(path.resolve(target)), { recursive: true });
fs.writeFileSync(target, airscore.serialize(score), 'utf8');
console.log(path.resolve(target));
