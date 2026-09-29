# NEAR OHM ($NOHM) — the reserve currency of NEAR

OHM-style (3,3) reserve protocol on NEAR. Stake NOHM → sNOHM rebases every 8-hour epoch. Bond NEAR at 6.5% (5-day) or 12% (14-day) discount for vesting NOHM. Treasury is a NEAR account funded by bonds; its balance is read on-chain. Dependency-free Node.

`npm start` (port 8228). Pages: `/` landing, `/app`, `/docs`. Local dev with faucet: `node _studio/dev.js`. Tests: `_studio/e2e.cjs` on a fresh `DATA_PATH` with `TREASURY` set (23 checks, hits NEAR mainnet RPC).

Deposits are real NEAR transfers to `TREASURY`, verified with `EXPERIMENTAL_tx_status` (signer = your account, receiver = treasury, final, plain Transfer). The NearBlocks index is used only to find hashes; RPC is the source of truth. Withdrawals are a queue paid by hand (`/api/admin/queue`, `/api/admin/paid` with `ADMIN_KEY`).

Env: `TREASURY` (NEAR account id, required for deposits), `ADMIN_KEY`, `DATA_PATH`, `NOHM_MINT` (NEP-141 id once live; enables DexScreener price + NOHM withdrawals), `REBASE_SEC` (28800), `APY_TARGET` (12000), `TOKEN_PRICE` (0.01), `MIN_DEPOSIT`/`MIN_BOND`/`MIN_WITHDRAW` (0.5 NEAR), `NEAR_RPCS`.
