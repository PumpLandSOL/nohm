'use strict';
// HUSH static brand-kit rasterizer. For each _studio/out/hush-*.html, drive headless Chrome
// with --screenshot at the asset's native size, saving hush-*.png to the Desktop.
// IMPORTANT: Chrome must get an ABSOLUTE file:// URL — a relative path renders Chrome's
// error page (the tell: every output is an identical ~24KB file).
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const OUT = path.join(__dirname, 'src');
const DESKTOP = require('path').join(__dirname, '..', 'brand'); require('fs').mkdirSync(DESKTOP, { recursive: true });
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const SIZES = {
  'nohm-pfp': [2000, 2000],
  'nohm-banner': [3000, 1000],
  'nohm-keyart': [2400, 1350],
  'nohm-moves': [2400, 1350],
  'nohm-treasury': [2400, 1350],
  'nohm-33': [2400, 1350],
  'nohm-index': [2400, 1350],
};

const only = process.argv[2];
const names = Object.keys(SIZES).filter((n) => !only || n === only);

for (const name of names) {
  const htmlPath = path.join(OUT, name + '.html');
  if (!fs.existsSync(htmlPath)) { console.log('SKIP (no html):', name); continue; }
  const [w, h] = SIZES[name];
  const fileUrl = 'file:///' + htmlPath.replace(/\\/g, '/');
  const png = path.join(DESKTOP, name + '.png');
  const udd = path.join(os.tmpdir(), 'nohmchrome_' + name + '_' + Date.now());
  const r = spawnSync(CHROME, [
    '--headless=new', '--no-sandbox', '--hide-scrollbars',
    '--force-device-scale-factor=1', '--default-background-color=00000000',
    '--user-data-dir=' + udd,
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--window-size=' + w + ',' + h,
    '--virtual-time-budget=3000',
    '--screenshot=' + png,
    fileUrl,
  ], { stdio: 'ignore', timeout: 60000 });
  const sz = fs.existsSync(png) ? fs.statSync(png).size : 0;
  console.log((r.status === 0 ? 'OK  ' : 'ERR ') + name + '  ' + w + 'x' + h + '  ' + sz + ' bytes -> ' + png);
}
