// JSON-RPC client using the global fetch (Node 18+).
export const CHAINS = {
  bsc: { id: 56, name: 'BNB Smart Chain', symbol: 'BNB', rpc: 'https://bsc-rpc.publicnode.com' },
  eth: { id: 1, name: 'Ethereum', symbol: 'ETH', rpc: 'https://ethereum-rpc.publicnode.com' },
  base: { id: 8453, name: 'Base', symbol: 'ETH', rpc: 'https://base-rpc.publicnode.com' },
  arb: { id: 42161, name: 'Arbitrum One', symbol: 'ETH', rpc: 'https://arbitrum-one-rpc.publicnode.com' },
  polygon: { id: 137, name: 'Polygon', symbol: 'POL', rpc: 'https://polygon-bor-rpc.publicnode.com' },
};

export function createRpc(url, { fetchImpl = globalThis.fetch, timeoutMs = 15000 } = {}) {
  let id = 0;
  async function send(method, params) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
        signal: ctrl.signal,
      });
      const body = await res.json();
      if (body.error) {
        const err = new Error(body.error.message || 'rpc error');
        err.data = body.error.data;
        throw err;
      }
      return body.result;
    } finally {
      clearTimeout(t);
    }
  }
  return {
    send,
    getCode: (to) => send('eth_getCode', [to, 'latest']),
    /** eth_call that resolves to null instead of throwing on revert. */
    call: async (to, data, from) => {
      try {
        return await send('eth_call', [{ to, data, ...(from ? { from } : {}) }, 'latest']);
      } catch {
        return null;
      }
    },
  };
}
