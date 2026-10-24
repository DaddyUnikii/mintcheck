import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keccak256, selector } from '../src/keccak.js';
import { decodeString, decodeUint, decodeBool, formatEther, bytecodeSelectors, encodeAddress } from '../src/abi.js';
import { inspect, verdict, revertReason } from '../src/check.js';

const W = '0x5f37b2286c06CD6956eE9558d0ee3eC79f3F2b9e';
const u = (n) => BigInt(n).toString(16).padStart(64, '0');
const str = (s) => u(32) + u(s.length) + Buffer.from(s).toString('hex').padEnd(64, '0');

// Fake bytecode: a PUSH4 for every selector we want the contract to "have".
const fakeCode = (sigs) => '0x' + sigs.map((s) => '63' + selector(s)).join('') + '00';

function mockRpc(sigs, answers, { mintRevert } = {}) {
  const bySel = Object.fromEntries(Object.entries(answers).map(([k, v]) => [selector(k), v]));
  return {
    getCode: async () => fakeCode(sigs),
    call: async (_to, data) => {
      const v = bySel[data.slice(2, 10)];
      return v === undefined ? null : '0x' + v;
    },
    send: async (method, [tx]) => {
      if (method !== 'eth_call') throw new Error('unexpected');
      if (mintRevert) { const e = new Error('execution reverted'); e.data = mintRevert; throw e; }
      return '0x';
    },
  };
}

test('keccak256 matches known vectors', () => {
  assert.equal(keccak256(''), 'c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470');
  assert.equal(selector('transfer(address,uint256)'), 'a9059cbb');
  assert.equal(selector('mint(uint256)'), 'a0712d68');
  assert.equal(selector('balanceOf( address )'), '70a08231');
});

test('abi decoding', () => {
  assert.equal(decodeString(str('FACEID.AI')), 'FACEID.AI');
  assert.equal(decodeUint(u(2800)), 2800n);
  assert.equal(decodeBool(u(1)), true);
  assert.equal(decodeUint('0x'), null);
  assert.equal(formatEther(1300000000000000n), '0.0013');
  assert.equal(formatEther(0n), '0');
  assert.equal(formatEther(2500000000000000000n), '2.5');
  assert.throws(() => encodeAddress('0x123'));
});

test('bytecodeSelectors skips PUSH data', () => {
  // PUSH32 whose data contains 63deadbeef must not be read as a selector.
  const code = '0x7f' + '63deadbeef'.padEnd(64, '0') + '63a0712d68';
  assert.deepEqual([...bytecodeSelectors(code)], ['a0712d68']);
});

test('verdict logic', () => {
  assert.equal(verdict({ supply: 100n, maxSupply: 100n, price: 0n }).status, 'SOLD_OUT');
  assert.equal(verdict({ open: false, price: 0n }).status, 'CLOSED');
  assert.equal(verdict({ paused: true }).status, 'CLOSED');
  assert.equal(verdict({ quote: 0n, price: 5n }).status, 'FREE');
  assert.equal(verdict({ price: 5n }).status, 'PAID');
  assert.equal(verdict({ freePerWallet: 1n, walletMinted: 0n, price: 5n }).status, 'FREE');
  assert.equal(verdict({}).status, 'UNKNOWN');
});

test('inspect reads a free agent-gated mint', async () => {
  const sigs = ['name()', 'totalSupply()', 'MAX_SUPPLY()', 'price()', 'mintOpen()', 'agentOnly()', 'mintedBy(address)', 'quote(address,uint256)', 'mint(uint256)', 'setPrice(uint256)'];
  const rpc = mockRpc(sigs, {
    'name()': str('FACEID.AI'), 'totalSupply()': u(33), 'MAX_SUPPLY()': u(2800), 'price()': u(1300000000000000n),
    'mintOpen()': u(1), 'agentOnly()': u(1), 'mintedBy(address)': u(0), 'quote(address,uint256)': u(0),
  });
  const r = await inspect(rpc, '0x' + '1'.repeat(40), { wallet: W, simulate: true });
  assert.equal(r.fields.name, 'FACEID.AI');
  assert.equal(r.fields.maxSupply, 2800n);
  assert.equal(r.verdict.status, 'FREE');
  assert.deepEqual(r.mintFunctions, ['mint(uint256)']);
  assert.ok(r.flags.includes('owner can change the price'));
  assert.deepEqual(r.simulation, { fn: 'mint(uint256)', ok: true });
});

test('inspect reports a decoded revert on simulate', async () => {
  const rpc = mockRpc(['price()', 'mint(uint256)'], { 'price()': u(10n ** 15n) }, { mintRevert: '0x' + selector('WrongPayment()') });
  const r = await inspect(rpc, '0x' + '2'.repeat(40), { wallet: W, simulate: true });
  assert.equal(r.verdict.status, 'PAID');
  assert.equal(r.simulation.reason, 'WrongPayment()');
});

test('revertReason decodes Error(string)', () => {
  const data = '0x08c379a0' + str('Mint closed');
  assert.equal(revertReason({ data }), 'Mint closed');
  assert.equal(revertReason({ data: '0x12345678' }), 'custom error 0x12345678');
});

test('inspect rejects addresses with no code', async () => {
  const rpc = { getCode: async () => '0x', call: async () => null, send: async () => null };
  await assert.rejects(inspect(rpc, '0x' + '3'.repeat(40)), /no contract code/);
});
