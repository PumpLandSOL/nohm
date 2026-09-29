'use strict';
const $ = (id) => document.getElementById(id);
const api = (u, b) => fetch(u, b ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) } : undefined).then((r) => r.json());
const c = (n, d = 0) => (n == null || !isFinite(n)) ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
const usd = (n) => (n == null || !isFinite(n)) ? '—' : '$' + (n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : n.toFixed(2));
const tok = (n) => (n == null || !isFinite(n)) ? '—' : n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? c(n) : c(n, 2);
const ago = (ts) => { const s = Math.max(0, (Date.now() - ts) / 1000); return s < 60 ? Math.floor(s) + 's' : s < 3600 ? Math.floor(s / 60) + 'm' : s < 86400 ? Math.floor(s / 3600) + 'h' : Math.floor(s / 86400) + 'd'; };
const isW = (s) => { s = s || ''; return s.length >= 2 && s.length <= 64 && /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(s); };
const short = (a) => a.length > 22 ? a.slice(0, 10) + '…' + a.slice(-8) : a;
function toast(m, err) { const t = $('toast'); t.textContent = m; t.className = 'toast on' + (err ? ' err' : ''); clearTimeout(toast._t); toast._t = setTimeout(() => t.className = 'toast', 2800); }

let M = null, A = null, t0 = 0, stakeMode = 'stake', wMode = 'NEAR', where = null;
let wallet = localStorage.getItem('nohm_w') || '';

// ---------- wallet: NEAR account id ----------
function setConnected() { $('connect').textContent = wallet ? short(wallet) : 'Connect NEAR'; $('k-w').textContent = wallet || 'not connected'; }
$('connect').onclick = () => { if (wallet) { wallet = ''; localStorage.removeItem('nohm_w'); A = null; where = null; setConnected(); renderAccount(); toast('disconnected'); } else $('wm').classList.add('on'); };
$('wm').onclick = (e) => { if (e.target.id === 'wm') $('wm').classList.remove('on'); };
$('wm-go').onclick = async () => { const v = $('wm-in').value.trim().toLowerCase(); $('wm-err').style.display = 'none'; if (!isW(v)) { $('wm-err').textContent = 'that is not a NEAR account id (like yourname.near)'; $('wm-err').style.display = 'block'; return; }
  const r = await api('/api/resolve', { wallet: v }); if (r.error) { $('wm-err').textContent = r.error; $('wm-err').style.display = 'block'; return; } if (!r.ok) { $('wm-err').textContent = 'no such account on NEAR mainnet'; $('wm-err').style.display = 'block'; return; }
  wallet = r.wallet; localStorage.setItem('nohm_w', wallet); $('wm').classList.remove('on'); setConnected(); toast('connected · ' + short(wallet)); await loadAccount(); };
$('wm-in').onkeydown = (e) => { if (e.key === 'Enter') $('wm-go').click(); };
const needWallet = () => { if (!wallet) { $('wm').classList.add('on'); return true; } return false; };

// ---------- router ----------
function go(v) { document.querySelectorAll('.view').forEach((s) => s.classList.toggle('on', s.dataset.view === v)); document.querySelectorAll('nav.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.view === v)); history.replaceState(null, '', v === 'dash' ? '/app' : '/app#' + v); window.scrollTo(0, 0); }
document.querySelectorAll('nav.tabs button').forEach((b) => b.onclick = () => go(b.dataset.view));
document.querySelectorAll('[data-go]').forEach((b) => b.onclick = (e) => { e.preventDefault(); go(b.dataset.go); });

// ---------- metrics ----------
async function loadMetrics() { try { M = await api('/api/metrics'); t0 = performance.now(); } catch (e) { return; } renderMetrics(); renderBonds(); calc(); }
function renderMetrics() {
  if (!M) return;
  $('m-apy').textContent = c(M.apy) + '%'; $('m-idx').textContent = M.index.toFixed(5); $('m-ep').textContent = M.epoch; $('m-rate').textContent = (M.rate * 100).toFixed(4);
  $('m-tre').textContent = c(M.treasuryNear, 2) + ' Ⓝ'; $('m-treu').textContent = usd(M.treasuryUsd) + ' · NEAR ' + (M.nearUsd ? '$' + M.nearUsd.toFixed(2) : '—');
  $('m-back').textContent = '$' + M.backingPerToken.toFixed(6); $('m-px').textContent = 'NOHM $' + M.price.toFixed(4) + (M.priceSrc === 'pool' ? ' · pool' : ' · launch');
  $('live').textContent = (M.chain.ok ? 'NEAR ' + c(M.chain.height) : 'NEAR —') + (M.depositsOpen ? ' · deposits open' : '');
  $('d-staked').textContent = tok(M.totalStaked) + ' sNOHM'; $('d-ratio').textContent = M.stakingRatio > 0 && M.stakingRatio < 1e-5 ? '<0.001%' : (M.stakingRatio * 100).toFixed(3) + '%'; $('d-stakers').textContent = M.stakers; $('d-bonded').textContent = c(M.bonded.near, 3) + ' NEAR'; $('d-bnohm').textContent = tok(M.bonded.nohm) + ' NOHM'; $('d-mc').textContent = usd(M.marketCap); $('d-run').textContent = M.runwayDays >= 365 ? (M.runwayDays / 365).toFixed(1) + ' yr' : M.runwayDays > 0 ? Math.round(M.runwayDays) + ' days' : M.totalStaked > 0 ? '— (treasury empty)' : '∞ (nothing staked)'; $('d-h').textContent = M.chain.ok ? c(M.chain.height) : '—';
  $('lb').innerHTML = M.leaderboard.length ? M.leaderboard.map((b, i) => `<div class="row"><span>${i + 1}. ${b.wallet}</span><b>${tok(b.staked)} sNOHM · ${(b.share * 100).toFixed(1)}%</b></div>`).join('') : '<p style="font-size:13px;color:var(--sub)">Nobody staked yet. First (3,3) takes the top spot.</p>';
  $('feed').innerHTML = M.feed.length ? M.feed.map((e) => `<div class="r"><span>${ago(e.ts)}</span><span>${e.type === 'bond' ? `<b>${short(e.who)}</b> bonded ${c(e.near, 2)} NEAR → ${tok(e.nohm)} NOHM (${e.market})` : e.type === 'stake' ? `<b>${short(e.who)}</b> staked ${tok(e.nohm)} NOHM (3,3)` : e.type}</span></div>`).join('') : '<div class="r"><span>—</span><span>quiet tape</span></div>';
  const roi = (days) => Math.pow(1 + M.rate, days * 86400 / M.rebaseSec) - 1; $('r5').textContent = '+' + (roi(5) * 100).toFixed(2) + '%'; $('r30').textContent = '+' + (roi(30) * 100).toFixed(1) + '%'; $('r365').textContent = '+' + c(M.apy) + '%';
  $('k-min').textContent = M.minDeposit; $('k-open').textContent = M.depositsOpen ? 'open' : 'opening soon';
  if (M.mint) $('mq').textContent = '$NOHM live · ' + M.mint + ' · (3,3) · stake nohm · bond near · rebase every 8 hours · ';
}
function renderBonds() { if (!M) return; $('bonds').innerHTML = M.bonds.map((b) => `<div class="bond"><div class="d">${(b.discount * 100).toFixed(1)}%</div><h3 class="u" style="font-size:15px">${b.name}</h3><p>${b.line}</p><div class="row" style="margin-top:10px"><span>bond price</span><b>$${b.priceUsd.toFixed(4)}</b></div><div class="row"><span>market price</span><b>$${M.price.toFixed(4)}</b></div><div class="row"><span>you get</span><b>${b.nohmPerNear ? c(b.nohmPerNear, 1) : '—'} NOHM / NEAR</b></div><div class="row"><span>vesting</span><b>${b.vestDays} days</b></div><div class="field"><input id="b-${b.id}" type="number" placeholder="min ${b.minBond}" min="0"><span class="unit">NEAR</span></div><button class="btn ink wide" data-bond="${b.id}">Bond NEAR</button></div>`).join('');
  $('bonds').querySelectorAll('[data-bond]').forEach((btn) => btn.onclick = () => doBond(btn.dataset.bond)); }
async function doBond(id) { if (needWallet()) return; const v = +$('b-' + id).value; if (!v) return toast('enter an amount', true); const r = await api('/api/bond', { wallet, market: id, amount: v }); if (r.error) return toast(r.error, true); A = r; renderAccount(); loadMetrics(); $('b-' + id).value = ''; toast('bonded · ' + tok(r.payout) + ' NOHM vesting'); }

// ---------- account ----------
async function loadAccount() { if (!wallet) { A = null; renderAccount(); return; } A = await api('/api/account', { wallet }); if (A.error) { toast(A.error, true); A = null; } if (M && M.depositsOpen && !where) { const w = await api('/api/deposit/where', { wallet }); if (!w.error) where = w; } renderAccount(); }
function renderAccount() {
  const a = A; $('y-staked').textContent = a ? c(a.staked, 4) + ' sNOHM' : '—'; $('y-next').textContent = a ? '+' + c(a.nextReward, 4) + ' NOHM' : '—'; $('y-nohm').textContent = a ? tok(a.nohm) + ' NOHM' : '—'; $('y-near').textContent = a ? c(a.near, 3) + ' NEAR' : '—';
  $('s-bal').textContent = a ? tok(a.nohm) + ' NOHM' : '—'; $('s-st').textContent = a ? c(a.staked, 4) + ' sNOHM' : '—'; $('s-nx').textContent = a ? '+' + c(a.nextReward, 4) + ' NOHM' : '—';
  $('k-near').textContent = a ? c(a.near, 3) : '—'; $('k-nohm').textContent = a ? tok(a.nohm) : '—'; $('k-dep').textContent = a ? c(a.deposited, 3) + ' NEAR' : '—'; $('k-st').textContent = a ? c(a.staked, 4) + ' sNOHM' : '—';
  $('k-to').textContent = where ? where.to : (wallet ? (M && !M.depositsOpen ? 'opening soon' : '—') : 'connect to reveal'); $('k-wallet').href = 'https://app.mynearwallet.com/send-money' + (where ? '/' + where.to : '');
  $('k-hist').innerHTML = a && a.hist.length ? a.hist.map((h) => `<div class="r"><span>${ago(h.ts)}</span><span>${h.type}${h.market ? ' · ' + h.market : ''} · ${h.asset === 'NOHM' ? tok(h.amt) + ' NOHM' : c(h.amt, 3) + ' NEAR'}${h.nohm ? ' → ' + tok(h.nohm) + ' NOHM' : ''}</span></div>`).join('') : '<div class="r"><span>—</span><span>nothing yet</span></div>';
  $('w-q').innerHTML = a && a.queue.length ? a.queue.map((q) => `<div class="row"><span>withdraw ${q.asset === 'NOHM' ? tok(q.amt) + ' NOHM' : c(q.amt, 3) + ' NEAR'} · ${q.id}</span><b>${q.status === 'paid' ? 'paid' + (q.tx ? ' · ' + q.tx.slice(0, 8) + '…' : '') : 'queued'}</b></div>`).join('') : '';
  $('ybonds').innerHTML = a && a.bonds.length ? a.bonds.map((b) => `<div class="row" style="display:block"><div style="display:flex;justify-content:space-between"><span>${b.market} · paid ${c(b.paid, 3)} NEAR</span><b>${tok(b.payout)} NOHM</b></div><div class="prog"><i style="width:${(b.pct * 100).toFixed(1)}%"></i></div><div style="display:flex;justify-content:space-between;font-size:12.5px"><span>${(b.pct * 100).toFixed(1)}% vested · ${b.endsIn > 86400 ? Math.ceil(b.endsIn / 86400) + ' days left' : Math.ceil(b.endsIn / 3600) + ' h left'}</span><span class="up">${tok(b.claimable)} claimable</span></div></div>`).join('') + `<div style="display:flex;gap:10px;margin-top:14px"><button class="btn" id="cl">Claim</button><button class="btn ink" id="cls">Claim &amp; stake (3,3)</button></div>` : '<p style="font-size:13px;color:var(--sub)">' + (a ? 'No active bonds.' : 'Connect to see your bonds.') + '</p>';
  const cl = $('cl'), cls = $('cls'); if (cl) cl.onclick = () => doClaim(false); if (cls) cls.onclick = () => doClaim(true);
}
async function doClaim(auto) { const r = await api('/api/claim', { wallet, autostake: auto }); if (r.error) return toast(r.error, true); A = r; renderAccount(); loadMetrics(); toast(auto ? 'claimed & staked ' + tok(r.claimed) + ' NOHM' : 'claimed ' + tok(r.claimed) + ' NOHM'); }

// ---------- stake ----------
$('sg-s').onclick = () => { stakeMode = 'stake'; $('sg-s').classList.add('on'); $('sg-u').classList.remove('on'); $('s-go').textContent = 'Stake'; $('s-unit').textContent = 'NOHM'; };
$('sg-u').onclick = () => { stakeMode = 'unstake'; $('sg-u').classList.add('on'); $('sg-s').classList.remove('on'); $('s-go').textContent = 'Unstake'; $('s-unit').textContent = 'sNOHM'; };
$('s-mx').onclick = () => { if (!A) return; $('s-in').value = (stakeMode === 'stake' ? A.nohm : A.staked).toFixed(4); };
$('s-go').onclick = async () => { if (needWallet()) return; const v = +$('s-in').value; if (!v) return toast('enter an amount', true); const r = await api('/api/' + stakeMode, { wallet, amount: v }); if (r.error) return toast(r.error, true); A = r; renderAccount(); loadMetrics(); $('s-in').value = ''; toast((stakeMode === 'stake' ? 'staked ' : 'unstaked ') + tok(v) + ' NOHM' + (stakeMode === 'stake' ? ' (3,3)' : '')); };

// ---------- desk ----------
$('k-copy').onclick = () => { if (!where) return toast(wallet ? 'deposits are not open yet' : 'connect first', true); navigator.clipboard.writeText(where.to); toast('treasury account copied'); };
$('k-scan').onclick = async () => { if (needWallet()) return; toast('looking for your transfer on NEAR…'); const r = await api('/api/deposit/scan', { wallet }); if (r.error) return toast(r.error, true); A = r; renderAccount(); toast(r.found.length ? 'credited ' + r.found.map((f) => c(f.amt, 3)).join(' + ') + ' NEAR' : 'no new transfer found yet — give it a few seconds or paste the hash', !r.found.length); };
$('k-credit').onclick = async () => { if (needWallet()) return; const r = await api('/api/deposit', { wallet, tx: $('k-tx').value.trim() }); if (r.error) return toast(r.error, true); A = r; renderAccount(); $('k-tx').value = ''; toast('credited ' + c(r.amt, 3) + ' NEAR'); };
$('w-near').onclick = () => { wMode = 'NEAR'; $('w-near').classList.add('on'); $('w-nohm').classList.remove('on'); $('w-unit').textContent = 'NEAR'; };
$('w-nohm').onclick = () => { wMode = 'NOHM'; $('w-nohm').classList.add('on'); $('w-near').classList.remove('on'); $('w-unit').textContent = 'NOHM'; };
$('w-mx').onclick = () => { if (A) $('w-in').value = wMode === 'NEAR' ? A.near : A.nohm; };
$('w-go').onclick = async () => { if (needWallet()) return; const r = await api('/api/withdraw', { wallet, asset: wMode, amount: +$('w-in').value }); if (r.error) return toast(r.error, true); A = r; renderAccount(); $('w-in').value = ''; toast('withdrawal queued'); };

// ---------- calc + ticker ----------
function calc() { if (!M) return; const amt = +$('c-amt').value || 0, days = +$('c-days').value; $('c-dl').textContent = days; const out = amt * Math.pow(1 + M.rate, days * 86400 / M.rebaseSec); $('c-out').textContent = tok(out) + ' NOHM (' + (out / (amt || 1)).toFixed(2) + '×)'; $('c-usd').textContent = usd(out * M.price); }
$('c-amt').oninput = calc; $('c-days').oninput = calc;
setInterval(() => { if (!M) return; const s = Math.max(0, M.nextRebaseIn - (performance.now() - t0) / 1000); $('m-cd').textContent = Math.floor(s / 3600) + 'h ' + String(Math.floor(s % 3600 / 60)).padStart(2, '0') + 'm ' + String(Math.floor(s % 60)).padStart(2, '0') + 's'; const frac = 1 - s / M.rebaseSec; const li = M.index * (1 + M.rate * frac); $('s-idx').textContent = li.toFixed(6); }, 1000);

// ---------- boot ----------
(async function () { setConnected(); await loadMetrics(); await loadAccount(); const h = (location.hash || '').slice(1); if (['stake', 'bond', 'desk'].includes(h)) go(h); setInterval(loadMetrics, 8000); setInterval(() => { if (wallet) loadAccount(); }, 12000); })();
