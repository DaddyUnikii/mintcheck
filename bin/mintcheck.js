#!/usr/bin/env node
import { inspect } from '../src/check.js';
import { createRpc, CHAINS } from '../src/rpc.js';
import { formatEther } from '../src/abi.js';
import { selector } from '../src/keccak.js';

const HELP = `mintcheck - is this NFT mint free, open, and safe to try?

Usage
  mintcheck <contract> [options]
  mintcheck --selector "<signature>"

Options
  --chain <name>     ${Object.keys(CHAINS).join(' | ')} (default: bsc)
  --rpc <url>        custom RPC endpoint (overrides --chain)
  --wallet <addr>    check quote, free allowance and minted count for this wallet
  --qty <n>          quantity to price / simulate (default: 1)
  --simulate         dry-run the mint with eth_call from --wallet (value 0, nothing is sent)
  --json             machine-readable output
  -h, --help         show this help

Read-only: mintcheck never signs or sends a transaction.`;

function parse(argv) {
  const o = { chain: 'bsc', qty: 1 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => { if (argv[i + 1] === undefined) throw new Error(`${a} needs a value`); return argv[++i]; };
    if (a === '-h' || a === '--help') o.help = true;
    else if (a === '--json') o.json = true;
    else if (a === '--simulate') o.simulate = true;
    else if (a === '--chain') o.chain = next();
    else if (a === '--rpc') o.rpc = next();
    else if (a === '--wallet') o.wallet = next();
    else if (a === '--qty') o.qty = Number(next());
    else if (a === '--selector') o.selector = next();
    else if (a.startsWith('-')) throw new Error(`unknown option ${a}`);
    else o.contract = a;
  }
  return o;
}

const C = process.stdout.isTTY && !process.env.NO_COLOR
  ? { g: (s) => `\x1b[32m${s}\x1b[0m`, r: (s) => `\x1b[31m${s}\x1b[0m`, y: (s) => `\x1b[33m${s}\x1b[0m`, d: (s) => `\x1b[2m${s}\x1b[0m`, b: (s) => `\x1b[1m${s}\x1b[0m` }
  : { g: String, r: String, y: String, d: String, b: String };

const json = (v) => JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x), 2);

function render(r, chain) {
  const f = r.fields;
  const sym = chain?.symbol || 'native';
  const color = { FREE: C.g, PAID: C.y, SOLD_OUT: C.r, CLOSED: C.r, UNKNOWN: C.d }[r.verdict.status];
  const row = (k, v) => console.log(`  ${C.d(k.padEnd(14))}${v}`);
  console.log();
  console.log(`  ${C.b(f.name || 'Unnamed contract')}${f.symbol ? C.d(` (${f.symbol})`) : ''}  ${color(`[${r.verdict.status.replace('_', ' ')}]`)}`);
  console.log(`  ${C.d(r.contract)}${chain ? C.d(` · ${chain.name}`) : ''}${r.isProxy ? C.y(' · proxy') : ''}`);
  console.log();
  if (f.supply !== undefined) row('Minted', f.maxSupply ? `${f.supply} / ${f.maxSupply} (${(Number(f.supply * 10000n / f.maxSupply) / 100).toFixed(1)}%)` : `${f.supply}`);
  if (f.price !== undefined) row('Price', f.price === 0n ? C.g('free') : `${formatEther(f.price)} ${sym}`);
  if (f.quote !== undefined) row(`Quote x${r.qty}`, f.quote === 0n ? C.g('free for this wallet') : `${formatEther(f.quote)} ${sym}`);
  if (f.freePerWallet !== undefined) row('Free limit', `${f.freePerWallet}`);
  if (f.maxPerWallet !== undefined) row('Max/wallet', `${f.maxPerWallet}`);
  if (f.walletMinted !== undefined) row('You minted', `${f.walletMinted}`);
  if (f.open !== undefined) row('Mint open', f.open ? C.g('yes') : C.r('no'));
  if (f.paused !== undefined) row('Paused', f.paused ? C.r('yes') : 'no');
  if (f.agentOnly) row('Gate', C.y('agent-only (needs an agent ID)'));
  if (f.merkleRoot) row('Gate', C.y('allowlist (merkle root set)'));
  if (f.owner) row('Owner', C.d(f.owner));
  if (r.mintFunctions.length) row('Mint fn', r.mintFunctions.join(', '));
  if (r.simulation) row('Simulation', r.simulation.ok ? C.g(`${r.simulation.fn} would succeed`) : C.r(`${r.simulation.fn || 'mint'} reverts: ${r.simulation.reason}`));
  for (const flag of r.flags) row('Heads up', C.y(flag));
  console.log();
  console.log(`  ${C.d('Verdict:')} ${color(r.verdict.status.replace('_', ' '))} ${C.d('·')} ${r.verdict.reason}`);
  console.log();
}

async function main() {
  let o;
  try { o = parse(process.argv.slice(2)); } catch (e) { console.error(`error: ${e.message}\n\n${HELP}`); process.exit(2); }
  if (o.help) { console.log(HELP); return; }
  if (o.selector) { console.log(`0x${selector(o.selector)}  ${o.selector}`); return; }
  if (!o.contract || !/^0x[0-9a-fA-F]{40}$/.test(o.contract)) { console.error(`error: give a contract address\n\n${HELP}`); process.exit(2); }
  if (o.simulate && !o.wallet) { console.error('error: --simulate needs --wallet'); process.exit(2); }
  if (!Number.isInteger(o.qty) || o.qty < 1) { console.error('error: --qty must be a positive integer'); process.exit(2); }

  const chain = o.rpc ? null : CHAINS[o.chain];
  if (!o.rpc && !chain) { console.error(`error: unknown chain "${o.chain}"`); process.exit(2); }
  const rpc = createRpc(o.rpc || chain.rpc);

  try {
    const report = await inspect(rpc, o.contract, { wallet: o.wallet, qty: o.qty, simulate: o.simulate });
    if (o.json) console.log(json({ chain: chain?.name || o.rpc, ...report }));
    else render(report, chain);
  } catch (e) {
    console.error(`error: ${e.message}`);
    process.exit(1);
  }
}

main();
