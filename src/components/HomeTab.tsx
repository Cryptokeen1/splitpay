import { useEffect, useState } from 'react'
import { erc20Abi, isAddress } from 'viem'
import type { Address } from 'viem'
import { useAccount, useReadContract } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { TokenUSDC } from '@web3icons/react'
import { LockKeyhole, ShieldCheck, Zap } from 'lucide-react'
import { formatUsdc } from '@/onchain-money'
import { usePayoutData } from '@/lib/usePayoutData'
import { VAULT_ADDRESS, vaultAbi, vestedAt } from '@/payoutvault'
import { ARC_ID, FEE_BPS, SPLITPAY_ADDRESS, USDC_ADDRESS, splitPayAbi, useChainTx } from '@/splitpay'
import { buildAddressExplorerUrl } from '@/onchain-facts'
import { ActivityFeed } from './ActivityFeed'
import { AddMoney } from './AddMoney'
import { AnimatedAmount } from './AnimatedAmount'
import { TxStatus } from './TxStatus'

function TrustCard() {
  const rows = [
    { Icon: LockKeyhole, title: 'Your money stays yours', text: 'No one can pause, freeze or redirect your withdrawals. The contract has no admin.' },
    { Icon: Zap, title: 'One flat fee', text: `${(FEE_BPS / 100).toFixed(1)}% of each payment, shown before you pay. No spreads, no hidden conversions.` },
    { Icon: ShieldCheck, title: 'Rules cannot change', text: 'The contract is fixed. Only split owners can edit their own split, and only for future payments.' },
  ]
  return (
    <section className="glass rounded-3xl p-5 space-y-4" aria-label="How your money is protected">
      <h2 className="font-display text-lg font-semibold">Built on self-custody</h2>
      <ul className="space-y-3">
        {rows.map(({ Icon, title, text }) => (
          <li key={title} className="flex gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-white/80">
              <Icon size={16} />
            </span>
            <span>
              <span className="block text-sm font-semibold">{title}</span>
              <span className="block text-sm text-[color:var(--muted)] text-pretty">{text}</span>
            </span>
          </li>
        ))}
      </ul>
      <a
        className="text-sm underline text-[color:var(--muted)]"
        href={buildAddressExplorerUrl(ARC_ID, SPLITPAY_ADDRESS)}
        target="_blank"
        rel="noopener noreferrer"
      >
        Read the contract on the explorer
      </a>
    </section>
  )
}

export function HomeTab({ onOpenPayouts }: { onOpenPayouts: () => void }) {
  const { address, isConnected } = useAccount()
  const tx = useChainTx()
  const [custom, setCustom] = useState(false)
  const [dest, setDest] = useState('')
  const [open, setOpen] = useState(false)
  const [tick, setTick] = useState(0)

  const pending = useReadContract({
    address: SPLITPAY_ADDRESS,
    abi: splitPayAbi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: ARC_ID,
    query: { enabled: Boolean(address), refetchInterval: 15000 },
  })
  const wallet = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: ARC_ID,
    query: { enabled: Boolean(address), refetchInterval: 15000 },
  })

  const payouts = usePayoutData(0)
  const nowSec = Math.floor(Date.now() / 1000)
  const claimable = (payouts.data?.plans ?? []).reduce(
    (sum, p) => (address && p.recipient.toLowerCase() === address.toLowerCase() ? sum + Math.max(0, Number(vestedAt(p, nowSec) - p.claimed)) : sum),
    0,
  )
  const vaultBal = useReadContract({
    address: VAULT_ADDRESS,
    abi: vaultAbi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: ARC_ID,
    query: { enabled: Boolean(address), refetchInterval: 15000 },
  })

  useEffect(() => {
    if (tx.isSuccess) {
      void pending.refetch()
      void wallet.refetch()
      setTick((t) => t + 1)
      setOpen(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tx.isSuccess])

  if (!isConnected || !address) {
    return (
      <div className="space-y-5">
        <div className="rounded-[2rem] p-8 text-white space-y-5" style={{ background: 'linear-gradient(145deg,#0f1b33,#2c3f66)' }}>
          <p className="font-display text-3xl font-semibold text-balance">Get paid once. Everyone gets their share.</p>
          <p className="text-white/70 text-pretty">
            Create a split, share one link, and every USDC payment is divided automatically between the people you choose.
          </p>
          <div className="[&_button]:!min-h-[48px]">
            <ConnectKitButton label="Connect wallet" />
          </div>
        </div>
        <TrustCard />
      </div>
    )
  }

  const amount = pending.data ?? 0n
  const target = custom ? dest : address
  const targetOk = isAddress(target)
  const busy = tx.isPending || tx.isConfirming
  const canWithdraw = amount > 0n && targetOk && !busy

  return (
    <div className="space-y-5">
      <section
        className="rounded-[2rem] p-6 text-white space-y-5"
        style={{ background: 'linear-gradient(145deg,#0f1b33,#2c3f66)' }}
        aria-label="Balance"
      >
        <div>
          <p className="text-sm text-white/70">Ready to withdraw from splits</p>
          <p className="mt-1 flex items-center gap-3 font-display text-5xl font-semibold">
            <TokenUSDC variant="branded" size={36} />
            {pending.isLoading ? <span className="tnum">...</span> : <AnimatedAmount raw={amount} />}
          </p>
          <p className="mt-2 text-sm text-white/60 tnum">Wallet balance: {formatUsdc(wallet.data ?? 0n)} USDC</p>
        </div>

        {!open ? (
          <button
            className="min-h-[48px] w-full rounded-2xl hero-btn font-semibold disabled:opacity-50"
            disabled={amount === 0n}
            onClick={() => {
              tx.reset()
              setOpen(true)
            }}
          >
            {amount === 0n ? 'Nothing to withdraw yet' : 'Withdraw'}
          </button>
        ) : (
          <div className="rounded-2xl bg-white/10 p-4 space-y-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={custom} onChange={(e) => setCustom(e.target.checked)} />
              Send to a different address
            </label>
            {custom && (
              <input
                className="field font-mono text-sm"
                placeholder="0x destination address"
                value={dest}
                onChange={(e) => setDest(e.target.value.trim())}
                spellCheck={false}
                aria-label="Destination address"
              />
            )}
            {custom && dest !== '' && !targetOk && <p className="text-sm text-red-200">Enter a valid address.</p>}
            <div className="flex gap-2">
              <button
                className="min-h-[48px] flex-1 rounded-2xl hero-btn font-semibold disabled:opacity-50"
                disabled={!canWithdraw}
                onClick={() =>
                  void tx.send({
                    address: SPLITPAY_ADDRESS,
                    abi: splitPayAbi,
                    functionName: 'withdraw',
                    args: [target],
                  })
                }
              >
                {busy ? 'Working...' : `Withdraw ${formatUsdc(amount)} USDC`}
              </button>
              <button className="min-h-[48px] px-4 rounded-2xl border border-white/30" onClick={() => setOpen(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>

      {((vaultBal.data ?? 0n) > 0n || claimable > 0) && (
        <button className="glass w-full rounded-2xl p-4 text-left min-h-[56px]" onClick={onOpenPayouts}>
          <span className="block text-sm font-semibold tnum">
            {(vaultBal.data ?? 0n) > 0n && `${formatUsdc(vaultBal.data ?? 0n)} USDC credited to you`}
            {(vaultBal.data ?? 0n) > 0n && claimable > 0 && ' and '}
            {claimable > 0 && `${formatUsdc(BigInt(claimable))} USDC unlocked to claim`}
          </span>
          <span className="block text-xs text-[color:var(--muted)]">In Payouts, from escrows, vesting, scheduled payouts or payroll. Tap to withdraw or claim.</span>
        </button>
      )}
      <TxStatus tx={tx} doneText="Withdrawal complete." />
      <AddMoney />
      <ActivityFeed refreshKey={tick} />
      <TrustCard />
    </div>
  )
}
