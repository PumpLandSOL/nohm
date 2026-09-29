// NEAR OHM E2E (dev server, DEV_FAUCET=1, fresh DATA_PATH, TREASURY set): resolve, bond, claim, stake, rebase math, withdraw, deposit guards.
const B = 'http://localhost:' + (process.env.PORT || 8229); const A = 'alice-nohm-test.near', C = 'carol-nohm-test.near';
const post = (u, w, b) => fetch(B + u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ wallet: w, ...b }) }).then((r) => r.json());
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? '  · ' + x : '')); if (!c) fails++; };
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  let M; for (let i = 0; i < 25; i++) { M = await (await fetch(B + '/api/metrics')).json(); if (M.nearUsd > 0 && M.chain.ok) break; await sleep(1000); }
  ok('NEAR price + chain height live', M.nearUsd > 0 && M.chain.ok && M.chain.height > 1e8, 'NEAR $' + M.nearUsd + ' · height ' + M.chain.height);
  ok('epoch 8h, rate from APY', M.rebaseSec === 28800 && near(M.rate, Math.pow(1 + M.apy / 100, 1 / (31557600 / 28800)) - 1, 1e-9), 'r=' + (M.rate * 100).toFixed(4) + '%');
  ok('two bond markets', M.bonds.length === 2 && M.bonds[0].nohmPerNear > 0);
  const rs = await post('/api/resolve', 'near'); ok('resolve: real account exists', rs.ok === true);
  const rs2 = await post('/api/resolve', 'this-account-does-not-exist-9f2k.near'); ok('resolve: missing account is false', rs2.ok === false);
  const rs3 = await post('/api/resolve', '0xabc'); ok('resolve: EVM address is not a live NEAR account', rs3.ok === false || /not a NEAR/.test(rs3.error || ''));
  const b0 = await post('/api/bond', A, { market: 'near5', amount: 10 }); ok('bond without NEAR refused', /deposit first|minimum/.test(b0.error || ''), b0.error);
  await post('/api/dev/faucet', A, { near: 50 }); await post('/api/dev/faucet', C, { near: 5 });
  const b1 = await post('/api/bond', A, { market: 'near5', amount: 10 });
  const expect = 10 * M.nearUsd / (M.price * (1 - 0.065));
  ok('bond 10 NEAR → discounted NOHM payout', b1.ok && near(b1.payout, expect, expect * 0.02) && near(b1.near, 40), 'payout ' + b1.payout.toFixed(1) + ' expected ~' + expect.toFixed(1));
  const c1 = await post('/api/claim', A, {}); ok('claim right after bond ≈ 0 (linear vest)', c1.ok && c1.claimed < b1.payout * 0.001, 'claimed ' + c1.claimed);
  await post('/api/dev/faucet', A, { nohm: 1000 });
  const s1 = await post('/api/stake', A, { amount: 600 }); ok('stake 600 → sNOHM ≈ 600, shares = 600/index', s1.ok && near(s1.staked, 600, 0.01) && near(s1.agons * s1.index, 600, 0.01) && near(s1.nohm, 400, 0.01), 'staked ' + s1.staked.toFixed(4));
  ok('next reward = staked × r', near(s1.nextReward, 600 * M.rate, 1e-6));
  const u1 = await post('/api/unstake', A, { amount: 100 }); ok('unstake 100', u1.ok && near(u1.staked, 500, 0.01) && near(u1.nohm, 500, 0.01));
  const cs = await post('/api/claim', A, { autostake: true }); ok('claim & stake routes vested NOHM into stake', cs.ok && cs.staked >= 500);
  const M2 = await (await fetch(B + '/api/metrics')).json(); ok('metrics: total staked, 1 staker, leaderboard, bonded totals, tape', M2.totalStaked >= 500 && M2.stakers === 1 && M2.leaderboard.length === 1 && near(M2.bonded.near, 10) && M2.feed.length >= 2, JSON.stringify({ ts: M2.totalStaked.toFixed(2), bonded: M2.bonded }));
  ok('backing = treasury usd / supply', near(M2.backingPerToken, M2.treasuryUsd / M2.circulating, 1e-12));
  const w0 = await post('/api/withdraw', C, { asset: 'NEAR', amount: 0.1 }); ok('withdraw below minimum refused', /minimum/.test(w0.error || ''));
  const w1 = await post('/api/withdraw', C, { asset: 'NEAR', amount: 2 }); ok('withdraw queued, desk debited', w1.ok && w1.queued.status === 'queued' && near(w1.near, 3));
  const w2 = await post('/api/withdraw', C, { asset: 'NOHM', amount: 1 }); ok('NOHM withdraw closed until mint', /token is live/.test(w2.error || ''));
  const d0 = await post('/api/deposit', C, { tx: 'nope' }); ok('bad hash rejected', /hash|not open/.test(d0.error || ''), d0.error);
  const d1 = await post('/api/deposit', C, { tx: '75Yo626uTMcfisoiyvU8YF5cXv83r8rWZKS2sSUcLq9u' }); ok('real NEAR tx not signed by wallet / not to treasury is refused', !d1.ok && /signed|treasury|not found/.test(d1.error || ''), d1.error);
  const wh = await post('/api/deposit/where', C, {}); ok('deposit destination only via wallet-scoped POST', wh.to && wh.to.endsWith('.near') || /not open/.test(wh.error || ''), wh.to || wh.error);
  ok('metrics never contain the treasury account', !JSON.stringify(M2).includes(wh.to || 'TREASURY_UNSET'));
  const ac = await post('/api/account', A, {}); ok('account: history + bonds view', ac.hist.length >= 4 && ac.bonds.length === 1 && ac.bonds[0].pct < 0.01);
  console.log(fails ? fails + ' FAILED' : 'ALL PASS'); process.exit(fails ? 1 : 0);
})();
