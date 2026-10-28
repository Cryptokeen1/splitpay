import { useState } from 'react'
import { parseAbi, stringToHex, type Abi, type Address, type Hex } from 'viem'
import { useAccount, usePublicClient, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { getUsdc } from '@/onchain-facts'
import { parseUsdc } from '@/onchain-money'
import { ARC_ID as NETWORK_ID, IS_MAINNET, NETWORK_LABEL, SPLITPAY_ADDRESS_VALUE, SPLITPAY_DEPLOY_BLOCK_VALUE } from '@/network'

export const ARC_ID = NETWORK_ID
export const SPLITPAY_ADDRESS = SPLITPAY_ADDRESS_VALUE
/** Block the contract was deployed in; event scans start here. */
export const SPLITPAY_DEPLOY_BLOCK = SPLITPAY_DEPLOY_BLOCK_VALUE
export const FEE_BPS = 20
/** On Arc, gas is paid in USDC from the same balance. Keep this much back when spending "max". */
export const GAS_RESERVE = parseUsdc('0.05')
/** Below this wallet balance a transaction is likely to fail for lack of gas. */
export const GAS_MIN = parseUsdc('0.02')

const usdcFact = getUsdc(ARC_ID)
if (!usdcFact) throw new Error(`USDC is not registered for ${NETWORK_LABEL}`)
export const USDC_ADDRESS = usdcFact.address as Address

export const splitPayAbi = parseAbi([
  'function createSplit(address[] recipients, uint16[] bps) returns (uint256 splitId)',
  'function updateSplit(uint256 splitId, address[] recipients, uint16[] bps)',
  'function pay(uint256 splitId, uint256 amount, uint32 expectedVersion, bytes32 paymentReference)',
  'function withdraw(address to)',
  'function getSplit(uint256 splitId) view returns (address owner, uint32 version, address[] recipients, uint16[] bps)',
  'function balanceOf(address account) view returns (uint256)',
  'function splitCount() view returns (uint256)',
  'event SplitCreated(uint256 indexed splitId, address indexed owner, uint32 version, address[] recipients, uint16[] bps)',
  'event PaymentReceived(uint256 indexed splitId, address indexed payer, uint32 version, uint256 amount, uint256 fee, bytes32 paymentReference)',
  'event Withdrawn(address indexed account, address to, uint256 amount)',
  'error ZeroAddress()',
  'error InvalidRecipientCount(uint256 count)',
  'error ArrayLengthMismatch()',
  'error DuplicateRecipient(address recipient)',
  'error ZeroShare(uint256 index)',
  'error InvalidBpsTotal(uint256 total)',
  'error UnknownSplit(uint256 splitId)',
  'error SplitVersionMismatch(uint32 expected, uint32 actual)',
  'error NotSplitOwner(uint256 splitId, address caller)',
  'error ZeroAmount()',
  'error NoBalance()',
  'error UnexpectedReceivedAmount(uint256 expected, uint256 received)',
]) satisfies Abi

export interface SplitView {
  id: bigint
  owner: Address
  version: number
  recipients: readonly Address[]
  bps: readonly number[]
}

export function shortAddr(a: string): string {
  return `${a.slice(0, 6)}...${a.slice(-4)}`
}

/** Encode a short text reference into bytes32; returns undefined when it does not fit. */
export function encodeReference(text: string): Hex | undefined {
  const trimmed = text.trim()
  if (!trimmed) return '0x0000000000000000000000000000000000000000000000000000000000000000'
  if (new TextEncoder().encode(trimmed).length > 32) return undefined
  return stringToHex(trimmed, { size: 32 })
}

export function parseTxError(error: unknown): string | null {
  const raw = error instanceof Error ? error.message : String(error)
  const msg = raw.toLowerCase()
  if (msg.includes('user rejected') || msg.includes('user denied')) return null
  if (raw.includes('Unauthorized')) return 'Your wallet is not allowed to do this.'
  if (raw.includes('DeadlineNotReached')) return 'The deadline has not passed yet.'
  if (raw.includes('EscrowNotFunded')) return 'This escrow has already been settled.'
  if (raw.includes('NothingToClaim')) return 'Nothing has unlocked yet.'
  if (raw.includes('AlreadyRevoked')) return 'This plan was already cancelled.'
  if (raw.includes('NotRevocable')) return 'This plan cannot be cancelled.'
  if (raw.includes('InvalidRecipient')) return 'The recipient cannot be empty or your own address.'
  if (raw.includes('InvalidArbiter')) return 'The arbiter must be a different address from you and the seller.'
  if (raw.includes('InvalidDeadline')) return 'The date must be at least one hour from now.'
  if (raw.includes('InvalidDuration')) return 'Durations must be at least one hour.'
  if (raw.includes('InvalidCliff')) return 'The cliff cannot be longer than the vesting period.'
  if (raw.includes('InvalidPeriods')) return 'Use between 1 and 520 payments, and an amount at least that many base units.'
  if (raw.includes('PlanMustEndInFuture')) return 'The plan must end in the future.'
  if (raw.includes('SplitVersionMismatch')) return 'The merchant changed this split after you opened it. Reload the page and review the new shares.'
  if (raw.includes('UnknownSplit')) return 'That split does not exist.'
  if (raw.includes('ZeroAmount')) return 'Enter an amount greater than zero.'
  if (raw.includes('NoBalance')) return 'There is nothing to withdraw yet.'
  if (raw.includes('NotSplitOwner')) return 'Only the split owner can edit it.'
  if (raw.includes('InvalidBpsTotal')) return 'Shares must add up to exactly 100%.'
  if (raw.includes('DuplicateRecipient')) return 'Each recipient address can only appear once.'
  if (raw.includes('InvalidRecipientCount')) return 'A split needs between 1 and 10 recipients.'
  if (raw.includes('ZeroAddress')) return 'An address cannot be empty or zero.'
  if (msg.includes('insufficient funds') || msg.includes('exceeds balance')) return IS_MAINNET ? 'Not enough USDC in your wallet.' : 'Not enough USDC. Use Get test USDC in the sidebar.'
  if (msg.includes('network') || msg.includes('timeout')) return 'Network issue. Check your connection and retry.'
  return 'The transaction failed. Please try again.'
}

interface WriteRequest {
  address: Address
  abi: Abi
  functionName: string
  args: readonly unknown[]
}

/** One write at a time: switches to the Arc network, submits, then tracks the real receipt. */
export function useChainTx() {
  const { chainId } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const { writeContractAsync, data: hash, isPending, reset } = useWriteContract()
  const receipt = useWaitForTransactionReceipt({ hash, chainId: ARC_ID })
  const [error, setError] = useState<string | null>(null)

  const send = async (req: WriteRequest): Promise<Hex | undefined> => {
    setError(null)
    try {
      if (chainId !== ARC_ID) await switchChainAsync({ chainId: ARC_ID })
      return await writeContractAsync({ ...req, chainId: ARC_ID })
    } catch (e) {
      setError(parseTxError(e))
      return undefined
    }
  }

  return {
    send,
    hash,
    error,
    isPending,
    isConfirming: Boolean(hash) && receipt.isLoading,
    isSuccess: receipt.isSuccess,
    receipt: receipt.data,
    reset: () => {
      setError(null)
      reset()
    },
  }
}

export function useSplitReader() {
  const client = usePublicClient({ chainId: ARC_ID })
  return async (id: bigint): Promise<SplitView> => {
    if (!client) throw new Error('No RPC client')
    const [owner, version, recipients, bps] = await client.readContract({
      address: SPLITPAY_ADDRESS,
      abi: splitPayAbi,
      functionName: 'getSplit',
      args: [id],
    })
    return { id, owner, version, recipients, bps }
  }
}
