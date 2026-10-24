import { selector } from './keccak.js';
import {
  encodeAddress, encodeUint, decodeUint, decodeBool, decodeAddress, decodeString,
  bytecodeSelectors, strip0x,
} from './abi.js';

// Common names for the same idea across mint contracts. First one that answers wins.
export const PROBES = {
  name: { sigs: ['name()'], type: 'string' },
  symbol: { sigs: ['symbol()'], type: 'string' },
  supply: { sigs: ['totalSupply()', 'totalMinted()'], type: 'uint' },
  maxSupply: { sigs: ['MAX_SUPPLY()', 'maxSupply()', 'MAX_TOKENS()', 'collectionSize()', 'cap()'], type: 'uint' },
  price: { sigs: ['price()', 'mintPrice()', 'cost()', 'PRICE()', 'MINT_PRICE()', 'publicPrice()', 'publicSalePrice()'], type: 'uint' },
  maxPerWallet: { sigs: ['MAX_PER_WALLET()', 'maxPerWallet()', 'maxMintPerWallet()', 'MAX_MINT_PER_WALLET()', 'maxPerAddress()', 'walletLimit()'], type: 'uint' },
  freePerWallet: { sigs: ['MAX_FREE()', 'FREE_PER_WALLET()', 'freePerWallet()', 'maxFreePerWallet()', 'FREE_MINTS()'], type: 'uint' },
  open: { sigs: ['mintOpen()', 'saleActive()', 'isMintActive()', 'publicSaleActive()', 'mintActive()', 'saleIsActive()', 'isPublicSaleActive()', 'publicMintOpen()'], type: 'bool' },
  paused: { sigs: ['paused()'], type: 'bool' },
  owner: { sigs: ['owner()'], type: 'address' },
  agentOnly: { sigs: ['agentOnly()'], type: 'bool' },
  merkleRoot: { sigs: ['merkleRoot()', 'allowlistRoot()', 'whitelistRoot()'], type: 'uint' },
};

export const WALLET_PROBES = {
  walletMinted: { sigs: ['mintedBy(address)', 'numberMinted(address)', 'mintedPerWallet(address)', 'mintCount(address)', 'minted(address)'], type: 'uint' },
};

// Candidate mint entry points, in the order we try to simulate them.
export const MINT_SIGS = ['mint(uint256)', 'mint()', 'freeMint()', 'freeMint(uint256)', 'publicMint(uint256)', 'publicMint()', 'claim()', 'mint(address,uint256)'];

// Admin powers worth knowing about before you mint.
export const ADMIN_FLAGS = {
  'setPrice(uint256)': 'owner can change the price',
  'setMintPrice(uint256)': 'owner can change the price',
  'setCost(uint256)': 'owner can change the price',
  'setMaxSupply(uint256)': 'owner can change max supply',
  'pause()': 'owner can pause minting',
  'setMintOpen(bool)': 'owner can open/close minting',
  'setBaseURI(string)': 'owner can change metadata',
  'reveal()': 'unrevealed: art/tiers are set at reveal',
};

const decoders = { uint: decodeUint, bool: decodeBool, address: decodeAddress, string: decodeString };

function encodeArgs(sig, { wallet, qty }) {
  const types = sig.slice(sig.indexOf('(') + 1, -1).split(',').filter(Boolean);
  return types.map((t) => (t === 'address' ? encodeAddress(wallet) : encodeUint(qty))).join('');
}

/**
 * Reads a mint contract and returns a plain report object.
 * rpc: { getCode(to), call(to, data, from), send(method, params) }
 */
export async function inspect(rpc, contract, { wallet, qty = 1, simulate = false } = {}) {
  const code = await rpc.getCode(contract);
  if (!code || strip0x(code).length === 0) throw new Error('no contract code at this address');

  const present = bytecodeSelectors(code);
  const known = [...Object.values(PROBES), ...Object.values(WALLET_PROBES)].flatMap((p) => p.sigs);
  // Proxies keep their logic elsewhere, so the selectors will not show up: then just try everything.
  const isProxy = !known.some((s) => present.has(selector(s)));
  const has = (sig) => isProxy || present.has(selector(sig));

  const report = { contract, wallet: wallet || null, qty, isProxy, fields: {}, sources: {}, flags: [], mintFunctions: [] };

  async function probe(key, { sigs, type }, ctx) {
    for (const sig of sigs) {
      if (!has(sig)) continue;
      const data = '0x' + selector(sig) + encodeArgs(sig, ctx);
      const res = await rpc.call(contract, data);
      const v = res && res !== '0x' ? decoders[type](res) : null;
      if (v !== null) {
        report.fields[key] = v;
        report.sources[key] = sig;
        return;
      }
    }
  }

  await Promise.all(Object.entries(PROBES).map(([k, p]) => probe(k, p, { wallet, qty })));
  if (wallet) {
    await Promise.all(Object.entries(WALLET_PROBES).map(([k, p]) => probe(k, p, { wallet, qty })));
    if (has('quote(address,uint256)')) {
      const res = await rpc.call(contract, '0x' + selector('quote(address,uint256)') + encodeAddress(wallet) + encodeUint(qty));
      const v = decodeUint(res);
      if (v !== null) { report.fields.quote = v; report.sources.quote = 'quote(address,uint256)'; }
    }
  }

  for (const [sig, msg] of Object.entries(ADMIN_FLAGS)) if (!isProxy && present.has(selector(sig))) report.flags.push(msg);
  report.flags = [...new Set(report.flags)];
  report.mintFunctions = MINT_SIGS.filter((s) => !isProxy && present.has(selector(s)));

  if (simulate && wallet) report.simulation = await simulateMint(rpc, contract, report, { wallet, qty });
  report.verdict = verdict(report.fields);
  return report;
}

/** Dry-runs the mint with eth_call (value = 0). Nothing is signed or sent. */
export async function simulateMint(rpc, contract, report, { wallet, qty }) {
  const sigs = report.mintFunctions.length ? report.mintFunctions : MINT_SIGS;
  for (const sig of sigs) {
    const data = '0x' + selector(sig) + encodeArgs(sig, { wallet, qty });
    try {
      await rpc.send('eth_call', [{ from: wallet, to: contract, data, value: '0x0' }, 'latest']);
      return { fn: sig, ok: true };
    } catch (e) {
      if (report.mintFunctions.length) return { fn: sig, ok: false, reason: revertReason(e) };
    }
  }
  return { fn: null, ok: false, reason: 'no known mint function answered' };
}

// Custom errors mint contracts commonly use, so a revert reads as words instead of hex.
export const KNOWN_ERRORS = [
  'WrongPayment()', 'InsufficientPayment()', 'IncorrectPayment()', 'InvalidPayment()', 'NotEnoughEther()',
  'MintClosed()', 'MintNotActive()', 'SaleNotActive()', 'MintNotOpen()', 'Paused()', 'EnforcedPause()',
  'SoldOut()', 'MaxSupplyReached()', 'ExceedsMaxSupply()', 'MaxPerWallet()', 'ExceedsMaxPerWallet()',
  'WalletLimitReached()', 'AlreadyMinted()', 'AlreadyClaimed()', 'NotAgent()', 'NotAllowlisted()',
  'NotWhitelisted()', 'InvalidProof()', 'InvalidQuantity()', 'ZeroQuantity()',
];
const ERROR_BY_SELECTOR = Object.fromEntries(KNOWN_ERRORS.map((e) => [selector(e), e]));

export function revertReason(err) {
  const data = strip0x(typeof err?.data === 'string' ? err.data : err?.data?.data || '');
  if (data.startsWith('08c379a0')) return decodeString(data.slice(8)) || 'reverted';
  if (data.length >= 8) return ERROR_BY_SELECTOR[data.slice(0, 8)] || `custom error 0x${data.slice(0, 8)}`;
  return (err?.message || 'reverted').replace(/^execution reverted:?\s*/i, '') || 'reverted';
}

/** Turns the raw fields into one word plus a short reason. */
export function verdict(f) {
  if (f.maxSupply !== undefined && f.supply !== undefined && f.maxSupply > 0n && f.supply >= f.maxSupply)
    return { status: 'SOLD_OUT', reason: 'supply reached max supply' };
  if (f.open === false) return { status: 'CLOSED', reason: 'mint is not open' };
  if (f.paused === true) return { status: 'CLOSED', reason: 'contract is paused' };
  if (f.quote !== undefined) return f.quote === 0n
    ? { status: 'FREE', reason: 'quote for this wallet is 0' }
    : { status: 'PAID', reason: 'quote for this wallet', cost: f.quote };
  if (f.freePerWallet !== undefined && f.walletMinted !== undefined && f.walletMinted < f.freePerWallet)
    return { status: 'FREE', reason: `free allowance left (${f.freePerWallet - f.walletMinted})` };
  if (f.price !== undefined) return f.price === 0n
    ? { status: 'FREE', reason: 'price is 0' }
    : { status: 'PAID', reason: 'price per token', cost: f.price };
  return { status: 'UNKNOWN', reason: 'no price function found; try --wallet and --simulate' };
}
