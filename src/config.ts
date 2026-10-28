/**
 * wagmi configuration
 * Built with Arc Studio — https://studio.arc.io
 */

import { createConfig, fallback, http } from 'wagmi'
import { mainnet } from 'wagmi/chains'
import { arc, arcTestnet } from 'viem/chains'
import { injected } from 'wagmi/connectors'
import { requireChain } from './onchain-facts'
import { registerChain } from './tracing'

// Pre-register chain RPC URLs so trace events show correct chain names immediately
registerChain(arcTestnet.id, arcTestnet.rpcUrls.default.http[0])
registerChain(arc.id, requireChain(arc.id).rpcUrls[0])

// Arc's public RPCs rate-limit and occasionally stall. Time out early, retry, and fall back to a second provider.
const arcTransport = (chain: typeof arc | typeof arcTestnet) =>
  fallback(
    [...new Set([...requireChain(chain.id).rpcUrls, ...chain.rpcUrls.default.http])].map((url) =>
      http(url, { timeout: 15_000, retryCount: 2, retryDelay: 600 }),
    ),
  )

export const config = createConfig({
  chains: [arcTestnet, arc, mainnet], // Ethereum mainnet is needed for ENS resolution
  connectors: [injected()],
  transports: {
    [arcTestnet.id]: arcTransport(arcTestnet),
    [arc.id]: arcTransport(arc),
    [mainnet.id]: http(), // ENS resolution uses mainnet
  },
})
