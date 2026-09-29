// capture real NEAR OHM pages for the demo video (dev server on :8228 with DEV_FAUCET=1). Seeds two stakers first.
'use strict';
const { open, sleep } = require('./cdp.cjs'); const path = require('path'); const fs = require('fs');
const B = 'http://localhost:' + (process.env.PORT || 8228); const OUT = path.join(__dirname, 'shots'); fs.mkdirSync(OUT, { recursive: true });
const W = 'alice-nohm-test.near';
const post = (u, b) => fetch(B + u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
(async () => {
  for (let i = 0; i < 30; i++) { const m = await (await fetch(B + '/api/metrics')).json(); if (m.nearUsd > 0) break; await sleep(1000); }
  const a = await post('/api/account', { wallet: W });
  if (!a.staked) { await post('/api/dev/faucet', { wallet: W, near: 25, nohm: 5000 }); await post('/api/bond', { wallet: W, market: 'near5', amount: 8 }); await post('/api/bond', { wallet: W, market: 'near14', amount: 5 }); await post('/api/stake', { wallet: W, amount: 3200 }); await post('/api/dev/faucet', { wallet: 'bob-nohm-test.near', nohm: 900 }); await post('/api/stake', { wallet: 'bob-nohm-test.near', amount: 900 }); }
  const c = await open(B + '/', 1440, 860, 9551); await sleep(4500);
  const S = async (n, wait = 1200) => { await sleep(wait); await c.shot(path.join(OUT, n + '.png')); console.log(n); };
  const go = async (u) => { await c.send('Page.navigate', { url: B + u }); await sleep(3800); };
  await c.ev("localStorage.setItem('nohm_w','" + W + "'); 1"); await go('/'); await S('01-landing');
  await c.ev("window.scrollTo(0, 760); 1"); await S('02-moves', 900);
  await go('/app'); await S('03-dash');
  await c.ev("go('stake'); 1"); await S('04-stake', 800);
  await c.ev("go('bond'); 1"); await S('05-bond', 800);
  await c.ev("go('desk'); 1"); await S('06-desk', 800);
  await go('/docs'); await S('07-docs');
  c.close();
})().catch((e) => { console.error(e); process.exit(1); });
