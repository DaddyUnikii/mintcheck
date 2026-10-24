// Tiny ABI helpers: just enough to encode simple calls and decode common return types.
export const strip0x = (h) => (h.startsWith('0x') ? h.slice(2) : h);

export function encodeAddress(addr) {
  const a = strip0x(addr).toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(a)) throw new Error(`invalid address: ${addr}`);
  return a.padStart(64, '0');
}

export const encodeUint = (n) => BigInt(n).toString(16).padStart(64, '0');

/** Returns the result as a BigInt, or null when the call returned nothing. */
export function decodeUint(hex) {
  const h = strip0x(hex || '');
  if (h.length < 64) return null;
  return BigInt('0x' + h.slice(0, 64));
}

export function decodeBool(hex) {
  const n = decodeUint(hex);
  return n === null ? null : n !== 0n;
}

export function decodeAddress(hex) {
  const h = strip0x(hex || '');
  if (h.length < 64) return null;
  return '0x' + h.slice(24, 64);
}

/** Decodes a dynamic `string` return value (also tolerates old bytes32 names). */
export function decodeString(hex) {
  const h = strip0x(hex || '');
  if (h.length < 64) return null;
  if (h.length >= 128) {
    const off = Number(BigInt('0x' + h.slice(0, 64))) * 2;
    if (off + 64 <= h.length) {
      const len = Number(BigInt('0x' + h.slice(off, off + 64)));
      const body = h.slice(off + 64, off + 64 + len * 2);
      if (body.length === len * 2) return Buffer.from(body, 'hex').toString('utf8');
    }
  }
  return Buffer.from(h.slice(0, 64), 'hex').toString('utf8').replace(/\0+$/, '') || null;
}

/** Formats wei as a decimal string with up to 6 decimals, e.g. 1300000000000000n -> "0.0013". */
export function formatEther(wei) {
  const neg = wei < 0n;
  const v = neg ? -wei : wei;
  const whole = v / 10n ** 18n;
  const frac = (v % 10n ** 18n).toString().padStart(18, '0').slice(0, 6).replace(/0+$/, '');
  return (neg ? '-' : '') + whole.toString() + (frac ? '.' + frac : '');
}

/** Extracts the 4-byte selectors a contract's bytecode pushes (PUSH4 operands). */
export function bytecodeSelectors(code) {
  const h = strip0x(code || '').toLowerCase();
  const out = new Set();
  for (let i = 0; i < h.length; ) {
    const op = parseInt(h.slice(i, i + 2), 16);
    if (op === 0x63) out.add(h.slice(i + 2, i + 10));
    i += 2;
    if (op >= 0x60 && op <= 0x7f) i += (op - 0x5f) * 2; // skip PUSH data
  }
  return out;
}
