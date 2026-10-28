import { useEffect, useState } from 'react'
import { useAccount } from 'wagmi'
import { formatUsdc } from '@/onchain-money'
import { useContacts } from '@/lib/contacts'
import {
  ESCROW_STATUS,
  PLAN_KINDS,
  VAULT_ADDRESS,
  VAULT_FEE_BPS,
  fmtDate,
  nextUnlock,
  vestedAt,
  vaultAbi,
  type EscrowView,
  type PlanView,
} from '@/payoutvault'
import { useChainTx } from '@/splitpay'
import { TxStatus } from './TxStatus'

const ZERO = '0x0000000000000000000000000000000000000000'

function Badge({ children, tone }: { children: React.ReactNode; tone: 'neutral' | 'good' | 'warn' }) {
  const cls = tone === 'good' ? 'bg-emerald-50 text-emerald-700' : tone === 'warn' ? 'bg-amber-50 text-amber-800' : 'bg-white/80 text-[color:var(--muted)]'
  return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${cls}`}>{children}</span>
}

export function EscrowCard({ e, onChanged }: { e: EscrowView; onChanged: () => void }) {
  const { address } = useAccount()
  const contacts = useContacts()
  const tx = useChainTx()
  const me = address?.toLowerCase()
  const isPayer = e.payer.toLowerCase() === me
  const isSeller = e.seller.toLowerCase() === me
  const isArbiter = e.arbiter.toLowerCase() === me
  const funded = e.status === 1
  const now = Math.floor(Date.now() / 1000)
  const pastDeadline = now >= e.deadline

  useEffect(() => {
    if (tx.isSuccess) onChanged()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tx.isSuccess])

  const act = (fn: 'release' | 'refund' | 'settleAfterDeadline') => {
    tx.reset()
    void tx.send({ address: VAULT_ADDRESS, abi: vaultAbi, functionName: fn, args: [e.id] })
  }
  const busy = tx.isPending || tx.isConfirming
  const fee = (e.amount * BigInt(VAULT_FEE_BPS)) / 10000n

  return (
    <div className="glass rounded-3xl p-5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-display text-xl font-semibold">Escrow #{e.id.toString()}</p>
          {e.note && <p className="text-sm text-[color:var(--muted)]">{e.note}</p>}
        </div>
        <Badge tone={e.status === 2 ? 'good' : funded ? 'warn' : 'neutral'}>{funded ? 'Holding funds' : ESCROW_STATUS[e.status]}</Badge>
      </div>
      <p className="font-display text-3xl font-semibold tnum">{formatUsdc(e.amount)} <span className="text-base text-[color:var(--muted)]">USDC</span></p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-[color:var(--muted)]">Payer</dt><dd className="truncate">{contacts.label(e.payer)}</dd>
        <dt className="text-[color:var(--muted)]">Seller</dt><dd className="truncate">{contacts.label(e.seller)}</dd>
        {e.arbiter !== ZERO && (<><dt className="text-[color:var(--muted)]">Arbiter</dt><dd className="truncate">{contacts.label(e.arbiter)}</dd></>)}
        <dt className="text-[color:var(--muted)]">Deadline</dt><dd>{fmtDate(e.deadline)}</dd>
        <dt className="text-[color:var(--muted)]">If undecided</dt><dd>{e.releaseOnDeadline ? 'Releases to the seller' : 'Refunds the payer'}</dd>
      </dl>

      {funded && (
        <div className="flex flex-wrap gap-2 pt-1">
          {(isPayer || isArbiter) && (
            <button className="btn-primary" disabled={busy} onClick={() => act('release')}>
              Release to seller
            </button>
          )}
          {(isSeller || isArbiter) && (
            <button className="btn-ghost" disabled={busy} onClick={() => act('refund')}>
              Refund payer
            </button>
          )}
          {pastDeadline && (
            <button className="btn-ghost" disabled={busy} onClick={() => act('settleAfterDeadline')}>
              Settle now ({e.releaseOnDeadline ? 'release' : 'refund'})
            </button>
          )}
        </div>
      )}
      {funded && (isPayer || isArbiter) && (
        <p className="text-xs text-[color:var(--muted)] tnum">Seller receives {formatUsdc(e.amount - fee)} USDC after the {(VAULT_FEE_BPS / 100).toFixed(1)}% fee.</p>
      )}
      <TxStatus tx={tx} doneText="Done. Credited balances can be withdrawn above." />
    </div>
  )
}

export function PlanCard({ p, onChanged }: { p: PlanView; onChanged: () => void }) {
  const { address } = useAccount()
  const contacts = useContacts()
  const tx = useChainTx()
  const [confirmCancel, setConfirmCancel] = useState(false)
  const me = address?.toLowerCase()
  const isRecipient = p.recipient.toLowerCase() === me
  const isFunder = p.funder.toLowerCase() === me
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000)
    return () => clearInterval(t)
  }, [])
  const revoked = p.revokedAt !== 0
  const vested = vestedAt(p, now)
  const releasable = vested > p.claimed ? vested - p.claimed : 0n
  const pct = p.total === 0n ? 0 : Number((vested * 10000n) / p.total) / 100
  const claimedPct = p.total === 0n ? 0 : Number((p.claimed * 10000n) / p.total) / 100
  const next = nextUnlock(p, now)
  const fee = (releasable * BigInt(VAULT_FEE_BPS)) / 10000n
  const busy = tx.isPending || tx.isConfirming
  const done = !revoked && p.claimed === p.total

  useEffect(() => {
    if (tx.isSuccess) onChanged()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tx.isSuccess])

  return (
    <div className="glass rounded-3xl p-5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-display text-xl font-semibold">
            {PLAN_KINDS[p.kind]} #{p.id.toString()}
          </p>
          {p.note && <p className="text-sm text-[color:var(--muted)]">{p.note}</p>}
        </div>
        <Badge tone={done ? 'good' : revoked ? 'warn' : 'neutral'}>{done ? 'Complete' : revoked ? 'Cancelled' : 'Active'}</Badge>
      </div>

      <div>
        <p className="font-display text-3xl font-semibold tnum">
          {formatUsdc(p.total)} <span className="text-base text-[color:var(--muted)]">USDC</span>
        </p>
        <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-[color:var(--line)]" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Unlocked">
          <div className="relative h-full">
            <div className="absolute inset-y-0 left-0 rounded-full bg-[#7f9ccb]" style={{ width: `${pct}%` }} />
            <div className="absolute inset-y-0 left-0 rounded-full bg-[color:var(--ink)]" style={{ width: `${claimedPct}%` }} />
          </div>
        </div>
        <p className="mt-1.5 flex justify-between text-xs text-[color:var(--muted)] tnum">
          <span>Claimed {formatUsdc(p.claimed)}</span>
          <span>Unlocked {formatUsdc(vested)}</span>
        </p>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-[color:var(--muted)]">From</dt><dd className="truncate">{contacts.label(p.funder)}</dd>
        <dt className="text-[color:var(--muted)]">To</dt><dd className="truncate">{contacts.label(p.recipient)}</dd>
        {next !== null && (<><dt className="text-[color:var(--muted)]">Next unlock</dt><dd>{fmtDate(next)}</dd></>)}
        <dt className="text-[color:var(--muted)]">Cancellable</dt><dd>{p.revocable ? (revoked ? 'Cancelled' : 'Yes, by the sender') : 'No'}</dd>
      </dl>

      <div className="flex flex-wrap gap-2 pt-1">
        {isRecipient && (
          <button
            className="btn-primary"
            disabled={busy || releasable === 0n || !address}
            onClick={() => {
              tx.reset()
              if (address) void tx.send({ address: VAULT_ADDRESS, abi: vaultAbi, functionName: 'claim', args: [p.id, address] })
            }}
          >
            {releasable === 0n ? 'Nothing to claim yet' : `Claim ${formatUsdc(releasable - fee)} USDC`}
          </button>
        )}
        {isFunder && p.revocable && !revoked && !done && !confirmCancel && (
          <button className="btn-ghost" disabled={busy} onClick={() => setConfirmCancel(true)}>
            Cancel plan
          </button>
        )}
        {isFunder && confirmCancel && !revoked && (
          <div className="w-full space-y-2 rounded-2xl bg-white/70 p-3">
            <p className="text-sm text-pretty">Unlocked money stays with the recipient. The rest returns to you as a withdrawable balance.</p>
            <div className="flex gap-2">
              <button
                className="btn-primary"
                disabled={busy}
                onClick={() => {
                  tx.reset()
                  setConfirmCancel(false)
                  void tx.send({ address: VAULT_ADDRESS, abi: vaultAbi, functionName: 'revoke', args: [p.id] })
                }}
              >
                Yes, cancel
              </button>
              <button className="btn-ghost" onClick={() => setConfirmCancel(false)}>Keep plan</button>
            </div>
          </div>
        )}
      </div>
      {isRecipient && releasable > 0n && (
        <p className="text-xs text-[color:var(--muted)] tnum">After the {(VAULT_FEE_BPS / 100).toFixed(1)}% fee ({formatUsdc(fee)} USDC). Sent to your wallet.</p>
      )}
      <TxStatus tx={tx} doneText="Done." />
    </div>
  )
}
