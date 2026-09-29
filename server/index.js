// NEAR OHM ($NOHM) — the reserve currency of NEAR. OHM-style (3,3): stake → sNOHM rebases every epoch, bond NEAR at a
//   discount for vesting NOHM, treasury of real NEAR. Dependency-free Node (http + fs + crypto).
//   Ledger runs off-chain; every NEAR on a desk arrived as a real transfer to TREASURY on NEAR mainnet, verified by RPC.
//   TREASURY is an env var only (never committed). ADMIN_KEY gates the payout queue. NOHM_MINT is the NEP-141 once live.
'use strict';
const http = require('http'); const fs = require('fs'); const path = require('path'); const { randomBytes } = require('crypto');

const PORT = process.env.PORT || 8228;
const ROOT = path.join(__dirname, '..');
const DATA_PATH = process.env.DATA_PATH || path.join(ROOT, 'data.json');
const TOKEN = 'NOHM';
const TREASURY = (process.env.TREASURY || '').toLowerCase();       // NEAR account id that receives deposits, e.g. treasury.near
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const NOHM_MINT = process.env.NOHM_MINT || '';                     // NEP-141 contract id once $NOHM is live (e.g. nohm.near or a Ref/Rhea launch)
const REBASE_SEC = +(process.env.REBASE_SEC || 28800);             // epoch = 8 hours, like OHM
const APY_TARGET = +(process.env.APY_TARGET || 12000);             // % — displayed and emitted
const TOTAL_SUPPLY = +(process.env.TOTAL_SUPPLY || 1e9);
const TOKEN_PRICE0 = +(process.env.TOKEN_PRICE || 0.01);           // $ per NOHM until a pool price is read
const MIN_DEPOSIT = +(process.env.MIN_DEPOSIT || 0.5);             // NEAR
const MIN_BOND = +(process.env.MIN_BOND || 0.5);                   // NEAR
const MIN_WITHDRAW = +(process.env.MIN_WITHDRAW || 0.5);           // NEAR
const REBASES_YR = 31557600 / REBASE_SEC;
const RATE = Math.pow(1 + APY_TARGET / 100, 1 / REBASES_YR) - 1;   // per-epoch reward rate
const BONDS = [
  { id: 'near5', name: 'NEAR', asset: 'NEAR', discount: 0.065, vestDays: 5, line: 'Bond NEAR, take 6.5% off the market price, vest over five days.' },
  { id: 'near14', name: 'NEAR · 14 day', asset: 'NEAR', discount: 0.12, vestDays: 14, line: 'Longer lock, deeper discount. 12% off, vests over fourteen days.' },
];
const YOCTO = 1e24;
const isWallet = (s) => { s = String(s || '').toLowerCase(); return s.length >= 2 && s.length <= 64 && /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(s); };
const isHash = (s) => /^[1-9A-HJ-NP-Za-km-z]{40,50}$/.test(String(s || ''));
const num = (v, max) => { const x = Math.floor((+v || 0) * 1e6) / 1e6; return x > 0 ? Math.min(x, max == null ? x : max) : 0; };
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const id8 = () => { let n = BigInt('0x' + randomBytes(6).toString('hex')), s = ''; while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; } return s; };

// ---------- state ----------
let db = { v: 1, index: 1, epoch: 0, lastRebase: Date.now(), totalAgons: 0, wallets: {}, txs: {}, queue: [], treasuryIn: { near: 0, n: 0 }, bonded: { near: 0, nohm: 0 }, feed: [] };
try { const old = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8')); if (old.v === 1) db = Object.assign(db, old); } catch (e) {}
let saveT = null; function save() { if (saveT) return; saveT = setTimeout(() => { saveT = null; try { fs.writeFileSync(DATA_PATH, JSON.stringify(db)); } catch (e) {} }, 800); }
function W(a) { return db.wallets[a] || (db.wallets[a] = { near: 0, nohm: 0, agons: 0, bonds: [], deposited: 0, hist: [] }); }
const hist = (w, e) => { w.hist.unshift({ ts: Date.now(), ...e }); if (w.hist.length > 100) w.hist.pop(); };
const feed = (e) => { db.feed.unshift({ ts: Date.now(), ...e }); if (db.feed.length > 60) db.feed.pop(); };

// ---------- rebase ----------
function rebase() { db.index *= (1 + RATE); db.epoch++; db.lastRebase += REBASE_SEC * 1000; if (db.lastRebase > Date.now()) db.lastRebase = Date.now(); save(); }
(function catchup() { const missed = Math.floor((Date.now() - db.lastRebase) / 1000 / REBASE_SEC); for (let i = 0; i < Math.min(missed, 10000); i++) rebase(); })();
setInterval(() => { if (Date.now() - db.lastRebase >= REBASE_SEC * 1000) rebase(); }, 1000);
function liveIndex() { const frac = (Date.now() - db.lastRebase) / 1000 / REBASE_SEC; return db.index * (1 + RATE * Math.max(0, Math.min(1, frac))); }
const stakedOf = (w, idx) => w.agons * (idx || liveIndex());
const totalStaked = (idx) => db.totalAgons * (idx || liveIndex());

// ---------- chain: NEAR mainnet RPC, real deposits to TREASURY ----------
const RPCS = (process.env.NEAR_RPCS || 'https://rpc.mainnet.near.org,https://rpc.mainnet.fastnear.com').split(',');
const CHAIN = { ok: false, height: 0, treasuryNear: 0, lastRead: 0 };
async function rpc(method, params) {
  let err; for (const u of RPCS) { try { const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), 9000);
    const r = await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: ac.signal }); clearTimeout(tm);
    const j = await r.json(); if (j.error) { const e = new Error((j.error.data && (j.error.data.name || JSON.stringify(j.error.data))) || j.error.message); e.rpc = true; throw e; } return j.result; } catch (e) { err = e; if (e.rpc) break; } }
  throw err || new Error('rpc');
}
async function pollChain() { try { const b = await rpc('block', { finality: 'final' }); CHAIN.height = b.header.height; if (TREASURY) { try { const a = await rpc('query', { request_type: 'view_account', finality: 'final', account_id: TREASURY }); CHAIN.treasuryNear = Number(BigInt(a.amount) / 10n ** 18n) / 1e6; } catch (e) { CHAIN.treasuryNear = 0; } } CHAIN.ok = true; CHAIN.lastRead = Date.now(); } catch (e) { CHAIN.ok = false; } }
setInterval(pollChain, 30000); pollChain();
async function accountExists(id) { try { await rpc('query', { request_type: 'view_account', finality: 'final', account_id: id }); return true; } catch (e) { return false; } }
async function creditDeposit(w, hash) {
  if (!TREASURY) throw 'deposits are not open yet';
  if (!isHash(hash)) throw 'paste the transaction hash';
  if (db.txs[hash]) throw 'already credited';
  let r; try { r = await rpc('EXPERIMENTAL_tx_status', { tx_hash: hash, sender_account_id: w, wait_until: 'FINAL' }); } catch (e) { throw /UNKNOWN_TRANSACTION|does not exist|not found/i.test(e.message) ? 'tx not found yet — try again in a few seconds (and make sure it was sent from ' + w + ')' : 'rpc: ' + e.message; }
  const tx = r.transaction || {}; const st = r.status || {};
  if (st.Failure || (r.final_execution_status && /NONE|INCLUDED$/.test(r.final_execution_status) && !('SuccessValue' in st))) throw 'tx failed or not final';
  if (!('SuccessValue' in st) && !('SuccessReceiptId' in st)) throw 'tx not final yet — try again in a few seconds';
  if ((tx.signer_id || '').toLowerCase() !== w) throw 'tx not signed by your account';
  if ((tx.receiver_id || '').toLowerCase() !== TREASURY) throw 'tx is not a transfer to the treasury';
  let yocto = 0n; for (const a of tx.actions || []) { if (a && a.Transfer && a.Transfer.deposit) yocto += BigInt(a.Transfer.deposit); }
  const amt = Number(yocto / 10n ** 18n) / 1e6;
  if (!(amt > 0)) throw 'no NEAR transferred to the treasury in this tx';
  if (amt < MIN_DEPOSIT) throw 'minimum deposit is ' + MIN_DEPOSIT + ' NEAR — this transfer (' + amt.toFixed(3) + ') is not credited';
  const u = W(w); u.near += amt; u.deposited += amt; db.txs[hash] = { w, amt, ts: Date.now() }; db.treasuryIn.near += amt; db.treasuryIn.n++; hist(u, { type: 'deposit', amt, asset: 'NEAR', tx: hash }); save();
  return { amt, tx: hash };
}
// find inbound transfers from w to TREASURY that are not credited yet (NearBlocks index), then verify each by RPC
async function scanDeposits(w) {
  if (!TREASURY) throw 'deposits are not open yet';
  const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), 9000);
  const r = await fetch('https://api.nearblocks.io/v1/account/' + encodeURIComponent(TREASURY) + '/txns?from=' + encodeURIComponent(w) + '&per_page=25', { headers: { accept: 'application/json' }, signal: ac.signal }); clearTimeout(tm);
  if (!r.ok) throw 'indexer busy — paste the transaction hash instead';
  const j = await r.json(); const out = [];
  for (const t of j.txns || []) { const h = t.transaction_hash; if (!h || db.txs[h]) continue; if ((t.predecessor_account_id || '').toLowerCase() !== w) continue; try { out.push(await creditDeposit(w, h)); } catch (e) {} }
  return out;
}

// ---------- prices: NEAR/USD from Yahoo (keyless); NOHM from DexScreener once the pool exists ----------
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128 Safari/537.36';
const PX = { near: 0, nearTs: 0, nohm: 0, nohmTs: 0, nohmSrc: 'launch' };
async function pollPrices() {
  try { const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), 9000); const r = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/NEAR-USD?range=1d&interval=15m', { headers: { accept: 'application/json', 'user-agent': UA }, signal: ac.signal }); clearTimeout(tm); if (r.ok) { const m = (await r.json()).chart.result[0].meta; if (+m.regularMarketPrice > 0) { PX.near = +m.regularMarketPrice; PX.nearTs = Date.now(); } } } catch (e) {}
  if (NOHM_MINT) { try { const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), 9000); const r = await fetch('https://api.dexscreener.com/latest/dex/search?q=' + encodeURIComponent(NOHM_MINT), { signal: ac.signal }); clearTimeout(tm); if (r.ok) { const j = await r.json(); const p = (j.pairs || []).filter((p) => p.chainId === 'near' && p.baseToken && p.baseToken.address === NOHM_MINT).sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0]; if (p && +p.priceUsd > 0) { PX.nohm = +p.priceUsd; PX.nohmTs = Date.now(); PX.nohmSrc = 'pool'; } } } catch (e) {} }
}
setInterval(pollPrices, 60000); pollPrices();
const nohmPrice = () => (PX.nohm > 0 && Date.now() - PX.nohmTs < 30 * 60e3) ? PX.nohm : TOKEN_PRICE0;
const nearUsd = () => PX.near || 0;

// ---------- views ----------
function metrics() {
  const idx = liveIndex(); const ts = totalStaked(idx); const price = nohmPrice(); const nu = nearUsd();
  const treasuryNear = TREASURY && CHAIN.ok ? Math.max(CHAIN.treasuryNear, db.treasuryIn.near) : db.treasuryIn.near;
  const treasuryUsd = treasuryNear * nu; const circ = TOTAL_SUPPLY;
  const rewardsPerDay = ts * (Math.pow(1 + RATE, 86400 / REBASE_SEC) - 1) * price; const runway = rewardsPerDay > 0 ? treasuryUsd / rewardsPerDay : 0;
  const lb = Object.entries(db.wallets).map(([a, w]) => ({ a, staked: w.agons * idx })).filter((x) => x.staked > 0.001).sort((x, y) => y.staked - x.staked).slice(0, 8).map((x) => ({ wallet: x.a.length > 20 ? x.a.slice(0, 8) + '…' + x.a.slice(-6) : x.a, staked: x.staked, share: ts > 0 ? x.staked / ts : 0 }));
  return { token: TOKEN, mint: NOHM_MINT, depositsOpen: !!TREASURY, chain: { ok: CHAIN.ok, height: CHAIN.height }, apy: APY_TARGET, rate: RATE, index: +idx.toFixed(6), epoch: db.epoch, rebaseSec: REBASE_SEC, nextRebaseIn: Math.max(0, REBASE_SEC - (Date.now() - db.lastRebase) / 1000),
    totalStaked: ts, circulating: circ, stakingRatio: ts / circ, stakers: Object.values(db.wallets).filter((w) => w.agons > 0).length,
    treasuryNear, treasuryUsd, deposits: db.treasuryIn, bonded: db.bonded, backingPerToken: treasuryUsd / circ, price, priceSrc: PX.nohmSrc, nearUsd: nu, marketCap: price * circ, runwayDays: runway,
    bonds: BONDS.map((b) => ({ id: b.id, name: b.name, asset: b.asset, discount: b.discount, vestDays: b.vestDays, line: b.line, priceUsd: price * (1 - b.discount), nohmPerNear: nu > 0 ? nu / (price * (1 - b.discount)) : 0, minBond: MIN_BOND })),
    leaderboard: lb, feed: db.feed.slice(0, 20), minDeposit: MIN_DEPOSIT, minWithdraw: MIN_WITHDRAW, t: Date.now() };
}
function account(addr) {
  const w = W(addr); const idx = liveIndex(); const now = Date.now();
  const bonds = w.bonds.filter((b) => !b.done).map((b) => { const pct = Math.max(0, Math.min(1, (now - b.start) / (b.end - b.start))); return { id: b.id, market: b.market, paid: b.paid, payout: b.payout, claimable: Math.max(0, b.payout * pct - b.claimed), pct, endsIn: Math.max(0, (b.end - now) / 1000) }; });
  return { wallet: addr, near: w.near, nohm: w.nohm, staked: stakedOf(w, idx), agons: w.agons, index: +idx.toFixed(6), nextReward: stakedOf(w, idx) * RATE, deposited: w.deposited, bonds, hist: w.hist.slice(0, 40), queue: db.queue.filter((q) => q.wallet === addr).slice(0, 10) };
}

// ---------- http ----------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.mp4': 'video/mp4', '.woff2': 'font/woff2' };
function serve(req, res) { let u = decodeURIComponent(req.url.split('?')[0]); if (u === '/') u = '/client/landing.html'; if (u === '/app' || u === '/app/') u = '/client/index.html'; if (u === '/docs' || u === '/docs/') u = '/client/docs.html'; const f = path.normalize(path.join(ROOT, u)); if (!f.startsWith(ROOT)) { res.writeHead(403); return res.end('no'); } fs.readFile(f, (e, b) => { if (e) { res.writeHead(404); return res.end('not found'); } res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); res.end(b); }); }
function json(res, c, o) { res.writeHead(c, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); }
function body(req) { return new Promise((r) => { let b = ''; req.on('data', (c) => { b += c; if (b.length > 1e4) req.destroy(); }); req.on('end', () => { try { r(JSON.parse(b || '{}')); } catch (e) { r({}); } }); }); }

http.createServer(async (req, res) => {
  const u = req.url.split('?')[0];
  if (req.method === 'GET') { if (u === '/api/config') return json(res, 200, { token: TOKEN, mint: NOHM_MINT, network: 'near', rebaseSec: REBASE_SEC, apy: APY_TARGET, depositsOpen: !!TREASURY }); if (u === '/api/metrics') return json(res, 200, metrics()); return serve(req, res); }
  if (req.method !== 'POST') { res.writeHead(405); return res.end(); }
  const d = await body(req);
  if (u === '/api/resolve') { const id = String(d.wallet || '').trim().toLowerCase(); if (!isWallet(id)) return json(res, 200, { error: 'that is not a NEAR account id' }); return json(res, 200, { ok: await accountExists(id), wallet: id }); }
  const addr = String(d.wallet || '').trim().toLowerCase(); if (!isWallet(addr)) return json(res, 200, { error: 'connect a NEAR account' });
  const w = W(addr); const idx = liveIndex();
  if (u === '/api/account') return json(res, 200, account(addr));
  if (u === '/api/deposit/where') { if (!TREASURY) return json(res, 200, { error: 'deposits are not open yet' }); return json(res, 200, { to: TREASURY, min: MIN_DEPOSIT }); }
  if (u === '/api/deposit') { try { const r = await creditDeposit(addr, String(d.tx || '').trim()); return json(res, 200, { ok: true, ...r, ...account(addr) }); } catch (e) { return json(res, 200, { error: String(e.message || e) }); } }
  if (u === '/api/deposit/scan') { try { const found = await scanDeposits(addr); return json(res, 200, { ok: true, found, ...account(addr) }); } catch (e) { return json(res, 200, { error: String(e.message || e) }); } }
  if (u === '/api/dev/faucet' && process.env.DEV_FAUCET === '1') { w.near += num(d.near) || 0; w.nohm += num(d.nohm) || 0; save(); return json(res, 200, { ok: true, ...account(addr) }); }   // LOCAL TESTING ONLY
  if (u === '/api/bond') {
    const m = BONDS.find((b) => b.id === d.market); if (!m) return json(res, 200, { error: 'pick a bond' });
    const amt = num(d.amount, w.near); if (amt < MIN_BOND) return json(res, 200, { error: 'minimum bond is ' + MIN_BOND + ' NEAR' + (w.near < MIN_BOND ? ' — deposit first' : '') });
    const nu = nearUsd(); if (!(nu > 0)) return json(res, 200, { error: 'NEAR price feed is warming up — try again in a moment' });
    const payout = amt * nu / (nohmPrice() * (1 - m.discount)); const now = Date.now();
    w.near -= amt; const b = { id: id8(), market: m.name, paid: amt, payout, start: now, end: now + m.vestDays * 86400000, claimed: 0, done: false }; w.bonds.push(b);
    db.bonded.near += amt; db.bonded.nohm += payout; hist(w, { type: 'bond', amt, asset: 'NEAR', nohm: payout, market: m.name }); feed({ type: 'bond', near: amt, nohm: payout, market: m.name, who: addr }); save();
    return json(res, 200, { ok: true, payout, bond: b.id, ...account(addr) });
  }
  if (u === '/api/claim') {
    const now = Date.now(); let claimed = 0; const autostake = !!d.autostake;
    for (const b of w.bonds) { if (b.done) continue; const pct = Math.max(0, Math.min(1, (now - b.start) / (b.end - b.start))); const c = b.payout * pct - b.claimed; if (c > 1e-9) { b.claimed += c; claimed += c; } if (pct >= 1) b.done = true; }
    if (claimed > 0) { if (autostake) { const ag = claimed / idx; w.agons += ag; db.totalAgons += ag; } else w.nohm += claimed; hist(w, { type: autostake ? 'claim+stake' : 'claim', amt: claimed, asset: 'NOHM' }); save(); }
    return json(res, 200, { ok: true, claimed, autostake, ...account(addr) });
  }
  if (u === '/api/stake') { const amt = num(d.amount, w.nohm); if (amt <= 0) return json(res, 200, { error: w.nohm > 0 ? 'enter an amount' : 'no NOHM on your desk — bond NEAR first' }); w.nohm -= amt; const ag = amt / idx; w.agons += ag; db.totalAgons += ag; hist(w, { type: 'stake', amt, asset: 'NOHM' }); feed({ type: 'stake', nohm: amt, who: addr }); save(); return json(res, 200, { ok: true, ...account(addr) }); }
  if (u === '/api/unstake') { const have = stakedOf(w, idx); const amt = num(d.amount, have); if (amt <= 0) return json(res, 200, { error: 'nothing staked' }); const ag = Math.min(w.agons, amt / idx); w.agons -= ag; db.totalAgons = Math.max(0, db.totalAgons - ag); w.nohm += amt; hist(w, { type: 'unstake', amt, asset: 'NOHM' }); save(); return json(res, 200, { ok: true, ...account(addr) }); }
  if (u === '/api/withdraw') {
    const asset = d.asset === 'NOHM' ? 'NOHM' : 'NEAR';
    if (asset === 'NOHM' && !NOHM_MINT) return json(res, 200, { error: 'on-chain NOHM withdrawals open when the token is live' });
    const x = asset === 'NEAR' ? num(d.amount, w.near) : num(d.amount, w.nohm); if (asset === 'NEAR' && x < MIN_WITHDRAW) return json(res, 200, { error: 'minimum withdrawal is ' + MIN_WITHDRAW + ' NEAR' }); if (x <= 0) return json(res, 200, { error: 'nothing to withdraw' });
    if (asset === 'NEAR') w.near -= x; else w.nohm -= x; const q = { id: id8(), wallet: addr, amt: x, asset, ts: Date.now(), status: 'queued', tx: null }; db.queue.unshift(q); if (db.queue.length > 500) db.queue.pop(); hist(w, { type: 'withdraw', amt: x, asset }); save(); return json(res, 200, { ok: true, queued: q, ...account(addr) });
  }
  if (u === '/api/admin/queue') { if (!ADMIN_KEY || d.key !== ADMIN_KEY) return json(res, 200, { error: 'no' }); return json(res, 200, { ok: true, queue: db.queue.slice(0, 100), deposits: Object.entries(db.txs).map(([tx, t]) => ({ tx, ...t })).slice(-50) }); }
  if (u === '/api/admin/paid') { if (!ADMIN_KEY || d.key !== ADMIN_KEY) return json(res, 200, { error: 'no' }); const q = db.queue.find((x) => x.id === d.id); if (!q) return json(res, 200, { error: 'no such item' }); q.status = 'paid'; q.tx = d.tx || null; q.paidTs = Date.now(); save(); return json(res, 200, { ok: true, q }); }
  json(res, 404, { error: 'unknown route' });
}).listen(PORT, () => console.log('NEAR OHM ($NOHM) · :' + PORT + ' · APY ' + APY_TARGET + '% · epoch ' + REBASE_SEC + 's' + (TREASURY ? '' : ' · TREASURY unset, deposits closed')));
