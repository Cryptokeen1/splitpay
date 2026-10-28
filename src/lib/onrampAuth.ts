import { keccak256, stringToHex } from 'viem'

/** Shared by the browser (to sign) and the server (to verify). No secrets here. */
export const AUTH_MAX_AGE_SECONDS = 300

/** Opaque, stable id for a wallet. Circle maps it to its own record, so it must never change for a wallet. */
export function appUserIdFor(address: string): string {
  return keccak256(stringToHex(`splitpay-user:${address.toLowerCase()}`))
}

export function buildAuthMessage(address: string, issuedAt: number): string {
  return `SplitPay wants to open the USDC onramp for your wallet.\nWallet: ${address}\nIssued: ${issuedAt}`
}

export function parseAuthMessage(message: string): { address: string; issued: number } | null {
  const m = /^SplitPay wants to open the USDC onramp for your wallet\.\nWallet: (0x[0-9a-fA-F]{40})\nIssued: (\d{1,12})$/.exec(message)
  return m ? { address: m[1], issued: Number(m[2]) } : null
}

export const nowSeconds = (): number => Math.floor(Date.now() / 1000)
