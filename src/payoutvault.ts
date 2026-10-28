import { hexToString, parseAbi, type Address, type Hex } from 'viem'
import { VAULT_ADDRESS_VALUE, VAULT_DEPLOY_BLOCK_VALUE } from '@/network'

export const VAULT_ADDRESS = VAULT_ADDRESS_VALUE
/** Block the vault was deployed in; event scans start here. */
export const VAULT_DEPLOY_BLOCK = VAULT_DEPLOY_BLOCK_VALUE
export const VAULT_FEE_BPS = 20
export const MIN_DURATION_SECONDS = 3600

export const vaultAbi = parseAbi([
  'function createEscrow(address seller, address arbiter, uint256 amount, uint64 deadline, bool releaseOnDeadline, bytes32 paymentReference) returns (uint256 id)',
  'function release(uint256 id)',
  'function refund(uint256 id)',
  'function settleAfterDeadline(uint256 id)',
  'function createVesting(address recipient, uint256 amount, uint64 start, uint64 cliffDuration, uint64 duration, bool revocable, bytes32 paymentReference) returns (uint256 id)',
  'function createScheduled(address recipient, uint256 amount, uint64 unlockTime, bool revocable, bytes32 paymentReference) returns (uint256 id)',
  'function createPayroll(address recipient, uint256 amount, uint64 start, uint64 periodLength, uint32 periods, bool revocable, bytes32 paymentReference) returns (uint256 id)',
  'function claim(uint256 id, address to)',
  'function revoke(uint256 id)',
  'function withdraw(address to)',
  'function balanceOf(address account) view returns (uint256)',
  'function getEscrow(uint256 id) view returns ((address payer, address seller, address arbiter, uint256 amount, uint64 deadline, bool releaseOnDeadline, uint8 status))',
  'function getPlan(uint256 id) view returns ((uint8 kind, address funder, address recipient, uint256 total, uint256 claimed, uint64 start, uint64 cliff, uint64 duration, uint32 periods, bool revocable, uint64 revokedAt))',
  'function vestedAmount(uint256 id) view returns (uint256)',
  'function releasable(uint256 id) view returns (uint256)',
  'event EscrowCreated(uint256 indexed id, address indexed payer, address indexed seller, address arbiter, uint256 amount, uint64 deadline, bool releaseOnDeadline, bytes32 paymentReference)',
  'event PlanCreated(uint256 indexed id, uint8 kind, address indexed funder, address indexed recipient, uint256 total, uint64 start, uint64 cliff, uint64 duration, uint32 periods, bool revocable, bytes32 paymentReference)',
  'error Unauthorized(address caller)',
  'error DeadlineNotReached(uint64 deadline, uint256 currentTimestamp)',
  'error EscrowNotFunded(uint256 id)',
  'error NotRevocable(uint256 id)',
  'error AlreadyRevoked(uint256 id, uint64 revokedAt)',
  'error NothingToClaim(uint256 id)',
  'error NoBalance(address account)',
  'error InvalidRecipient(address recipient)',
  'error InvalidArbiter(address arbiter)',
  'error InvalidDeadline(uint64 supplied, uint256 minimum)',
  'error InvalidDuration(uint64 supplied, uint256 minimum)',
  'error InvalidCliff(uint64 supplied, uint64 maximum)',
  'error InvalidPeriods(uint32 supplied, uint32 maximum, uint256 amount)',
  'error PlanMustEndInFuture(uint64 end, uint256 currentTimestamp)',
  'error ZeroAmount(uint256 supplied)',
])

export const ESCROW_STATUS = ['None', 'Funded', 'Released', 'Refunded'] as const
export const PLAN_KINDS = ['Vesting', 'Scheduled', 'Payroll'] as const

export interface EscrowView {
  id: bigint
  payer: Address
  seller: Address
  arbiter: Address
  amount: bigint
  deadline: number
  releaseOnDeadline: boolean
  status: number
  note: string
}

export interface PlanView {
  id: bigint
  kind: number
  funder: Address
  recipient: Address
  total: bigint
  claimed: bigint
  start: number
  cliff: number
  duration: number
  periods: number
  revocable: boolean
  revokedAt: number
  vested: bigint
  releasable: bigint
  note: string
}

export function decodeRef(ref: Hex): string {
  try {
    return hexToString(ref, { size: 32 }).replace(/\0+$/g, '').trim()
  } catch {
    return ''
  }
}

export function fmtDate(unix: number): string {
  return new Date(unix * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

/** Convert a datetime-local input value to unix seconds, or null when empty or invalid. */
export function inputToUnix(value: string): number | null {
  if (!value) return null
  const t = new Date(value).getTime()
  return Number.isFinite(t) ? Math.floor(t / 1000) : null
}

export const UNITS = [
  { id: 'hours', label: 'hours', seconds: 3600 },
  { id: 'days', label: 'days', seconds: 86400 },
  { id: 'weeks', label: 'weeks', seconds: 604800 },
  { id: 'months', label: 'months (30 days)', seconds: 2592000 },
] as const

/** Mirrors the contract's vesting math so amounts can tick up live between reads. */
export function vestedAt(plan: PlanView, now: number): bigint {
  const t = plan.revokedAt !== 0 ? plan.revokedAt : now
  if (t < plan.cliff || t < plan.start) return 0n
  if (plan.kind === 1) return plan.total
  const elapsed = t - plan.start
  if (elapsed >= plan.duration) return plan.total
  if (plan.kind === 0) return (plan.total * BigInt(elapsed)) / BigInt(plan.duration)
  const periodLength = Math.floor(plan.duration / plan.periods)
  const steps = Math.floor(elapsed / periodLength)
  return (plan.total / BigInt(plan.periods)) * BigInt(steps)
}

export function nextUnlock(plan: PlanView, now: number): number | null {
  if (plan.revokedAt !== 0) return null
  if (vestedAt(plan, now) >= plan.total) return null
  if (plan.kind === 1) return plan.start
  if (plan.kind === 2) {
    const step = Math.floor(plan.duration / plan.periods)
    const done = now < plan.start ? 0 : Math.floor((now - plan.start) / step)
    return plan.start + step * (done + 1)
  }
  return now < plan.cliff ? plan.cliff : null
}
