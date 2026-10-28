import { isAddress, type Address } from 'viem'
import { arc, arcTestnet } from 'viem/chains'
import { requireChain } from '@/onchain-facts'

/**
 * Which Arc network the app talks to. Testnet is the default.
 * Set VITE_ARC_NETWORK=mainnet only after you have deployed the contracts yourself
 * and filled in the four mainnet deployment variables below.
 */
export const IS_MAINNET = import.meta.env.VITE_ARC_NETWORK === 'mainnet'
export const ARC_CHAIN = IS_MAINNET ? arc : arcTestnet
export const ARC_ID = ARC_CHAIN.id
export const NETWORK_LABEL = requireChain(ARC_ID).name

const ZERO: Address = '0x0000000000000000000000000000000000000000'

function envAddress(value: string | undefined): Address | undefined {
  return value && isAddress(value) ? value : undefined
}

function envBlock(value: string | undefined): bigint | undefined {
  return value && /^\d+$/.test(value.trim()) ? BigInt(value.trim()) : undefined
}

const env = import.meta.env

const deployment = IS_MAINNET
  ? {
      splitPay: envAddress(env.VITE_SPLITPAY_ADDRESS),
      splitPayBlock: envBlock(env.VITE_SPLITPAY_DEPLOY_BLOCK),
      vault: envAddress(env.VITE_PAYOUT_VAULT_ADDRESS),
      vaultBlock: envBlock(env.VITE_PAYOUT_VAULT_DEPLOY_BLOCK),
    }
  : {
      splitPay: '0x42c7cc566ccbba542c4ef8ed66ad468cad22626b' as Address,
      splitPayBlock: 0x421f5c0n as bigint | undefined,
      vault: '0xfd4767731c41b2069eac5b87208a0f4e42d436d3' as Address,
      vaultBlock: 0x4220f1bn as bigint | undefined,
    }

/** False on mainnet until every deployment variable is set. The app then shows setup steps instead of the tabs. */
export const IS_DEPLOYED = Boolean(deployment.splitPay && deployment.splitPayBlock !== undefined && deployment.vault && deployment.vaultBlock !== undefined)

export const SPLITPAY_ADDRESS_VALUE: Address = deployment.splitPay ?? ZERO
export const SPLITPAY_DEPLOY_BLOCK_VALUE: bigint = deployment.splitPayBlock ?? 0n
export const VAULT_ADDRESS_VALUE: Address = deployment.vault ?? ZERO
export const VAULT_DEPLOY_BLOCK_VALUE: bigint = deployment.vaultBlock ?? 0n
