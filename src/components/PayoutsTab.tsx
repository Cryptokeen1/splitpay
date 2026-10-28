import { useEffect, useState } from 'react'
import { useAccount, useReadContract } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { formatUsdc } from '@/onchain-money'
import { VAULT_ADDRESS, vaultAbi } from '@/payoutvault'
import { usePayoutData } from '@/lib/usePayoutData'
import { ARC_ID, useChainTx } from '@/splitpay'
import { PayoutCreate } from './PayoutCreate'
import { EscrowCard, PlanCard } from './PayoutList'
import { TxStatus } from './TxStatus'

type View = 'mine' | 'create'

function CreditedBalance({ refreshKey, onWithdrawn }: { refreshKey: number; onWithdrawn: () => void }) {
  const { address } = useAccount()
  const tx = useChainTx()
  const bal = useReadContract({
    address: VAULT_ADDRESS,
    abi: vaultAbi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: ARC_ID,
    query: { enabled: Boolean(address), refetchInterval: 20000 },
  })

  useEffect(() => {
    void bal.refetch()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey])
  useEffect(() => {
    if (tx.isSuccess) {
      void bal.refetch()
      onWithdrawn()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tx.isSuccess])

  const amount = bal.data ?? 0n
  if (amount === 0n && !tx.isSuccess) return null
  return (
    <div className="rounded-3xl p-5 text-white space-y-3" style={{ background: 'linear-gradient(145deg,#0f1b33,#2c3f66)' }}>
      <p className="text-sm text-white/70">Credited to you from escrows, refunds and cancelled plans</p>
      <p className="font-display text-4xl font-semibold tnum">{formatUsdc(amount)} <span className="text-lg text-white/60">USDC</span></p>
      <button
        className="min-h-[48px] w-full rounded-2xl hero-btn font-semibold disabled:opacity-50"
        disabled={amount === 0n || tx.isPending || tx.isConfirming || !address}
        onClick={() => {
          tx.reset()
          if (address) void tx.send({ address: VAULT_ADDRESS, abi: vaultAbi, functionName: 'withdraw', args: [address] })
        }}
      >
        {tx.isPending || tx.isConfirming ? 'Working...' : 'Withdraw to my wallet'}
      </button>
      <TxStatus tx={tx} doneText="Withdrawal complete." />
    </div>
  )
}

export function PayoutsTab() {
  const { isConnected } = useAccount()
  const [view, setView] = useState<View>('mine')
  const [tick, setTick] = useState(0)
  const data = usePayoutData(tick)
  const bump = () => setTick((t) => t + 1)

  const escrows = data.data?.escrows ?? []
  const plans = data.data?.plans ?? []

  return (
    <div className="space-y-5">
      <div className="glass rounded-2xl p-1 grid grid-cols-2 gap-1" role="tablist" aria-label="Payouts">
        {(
          [
            ['mine', 'My payouts'],
            ['create', 'Create'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={view === id}
            onClick={() => setView(id)}
            className={`min-h-[44px] rounded-xl text-sm font-semibold ${view === id ? 'bg-white shadow-sm' : 'text-[color:var(--muted)]'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {view === 'create' && (
        <PayoutCreate
          onCreated={() => {
            bump()
            setView('mine')
          }}
        />
      )}

      {view === 'mine' && (
        <div className="space-y-5">
          {!isConnected ? (
            <div className="glass rounded-3xl p-8 text-center space-y-4">
              <p className="font-display text-2xl font-semibold">Escrow, vesting and payroll</p>
              <p className="text-[color:var(--muted)] text-pretty">Connect your wallet to see payouts you sent or are owed.</p>
              <div className="flex justify-center">
                <ConnectKitButton />
              </div>
            </div>
          ) : (
            <>
              <CreditedBalance refreshKey={tick} onWithdrawn={bump} />
              {data.isLoading && <p className="text-sm text-[color:var(--muted)]">Loading your payouts...</p>}
              {data.isError && (
                <p className="text-sm text-[color:var(--muted)]">
                  Could not load payouts. <button className="underline" onClick={() => void data.refetch()}>Retry</button>
                </p>
              )}
              {!data.isLoading && !data.isError && escrows.length === 0 && plans.length === 0 && (
                <div className="glass rounded-3xl p-6 text-center space-y-3">
                  <p className="font-display text-lg font-semibold">Nothing here yet</p>
                  <p className="text-sm text-[color:var(--muted)] text-pretty">
                    Lock money in an escrow, schedule a payout, set up vesting or run payroll. Plans where you are the sender or the recipient show up here.
                  </p>
                  <button className="btn-primary" onClick={() => setView('create')}>Create a payout</button>
                </div>
              )}
              {plans.map((p) => (
                <PlanCard key={`p${p.id}`} p={p} onChanged={bump} />
              ))}
              {escrows.map((e) => (
                <EscrowCard key={`e${e.id}`} e={e} onChanged={bump} />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}
