const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const ui = path.join(root, 'src', 'ui');
const core = path.join(root, 'src', 'core');
let html = fs.readFileSync(path.join(ui, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(ui, 'styles.css'), 'utf8');
const logo = fs.readFileSync(path.join(root, 'assets', 'official-logo.png')).toString('base64');

html = html.replace('<link rel="stylesheet" href="styles.css" />', `<style>\n${css}\n</style>`);
html = html.replaceAll('../../assets/official-logo.png', `data:image/png;base64,${logo}`);

const scripts = [
  'music-theory.js', 'score-model.js', 'layout-engine.js', 'lyrics.js', 'solfa-parser.js', 'solfa.js', 'solfa-layout.js', 'harmony.js',
  'airscore.js', 'history.js', 'selection.js', 'editing.js', 'notations.js', 'midi-input.js', 'formats.js', 'playback.js', 'workspace-state.js'
].map(file => ({
  source: `../core/${file}`,
  code: fs.readFileSync(path.join(core, file), 'utf8')
})).concat([{ source: 'app.js', code: fs.readFileSync(path.join(ui, 'app.js'), 'utf8') }]);

for (const script of scripts) {
  const tag = `<script src="${script.source}"></script>`;
  const safe = script.code.replace(/<\/script/gi, '<\\/script');
  html = html.replace(tag, () => `<script>\n${safe}\n</script>`);
}

const output = path.join(root, 'Airmonlink-Composer-Preview.html');
fs.writeFileSync(output, html);
console.log(`Built ${output}`);
