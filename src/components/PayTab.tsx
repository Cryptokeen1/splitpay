import { useCallback, useEffect, useState } from 'react'
import { erc20Abi } from 'viem'
import { useAccount, usePublicClient, useReadContract } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { TokenUSDC } from '@web3icons/react'
import { useContacts } from '@/lib/contacts'
import { formatUsdc, parseUsdc } from '@/onchain-money'
import {
  ARC_ID,
  FEE_BPS,
  GAS_RESERVE,
  SPLITPAY_ADDRESS,
  USDC_ADDRESS,
  encodeReference,
  shortAddr,
  splitPayAbi,
  useChainTx,
  type SplitView,
} from '@/splitpay'
import { Donut, SHARE_COLORS } from './Donut'
import { TxStatus } from './TxStatus'

function initialSplitId(): string {
  const v = new URLSearchParams(window.location.search).get('split')
  return v && /^\d+$/.test(v) ? v : ''
}

export function PayTab() {
  const { address, isConnected } = useAccount()
  const client = usePublicClient({ chainId: ARC_ID })
  const [idInput, setIdInput] = useState(initialSplitId)
  const [split, setSplit] = useState<SplitView | null>(null)
  const [loadError, setLoadError] = useState('')
  const [loading, setLoading] = useState(false)
  const [amountInput, setAmountInput] = useState('')
  const [refInput, setRefInput] = useState('')
  const contacts = useContacts()
  const approveTx = useChainTx()
  const payTx = useChainTx()

  const loadSplit = useCallback(async () => {
    if (!client || !/^\d+$/.test(idInput)) {
      setSplit(null)
      setLoadError('')
      return
    }
    setLoading(true)
    setLoadError('')
    try {
      const id = BigInt(idInput)
      const [owner, version, recipients, bps] = await client.readContract({
        address: SPLITPAY_ADDRESS,
        abi: splitPayAbi,
        functionName: 'getSplit',
        args: [id],
      })
      setSplit({ id, owner, version, recipients, bps })
    } catch {
      setSplit(null)
      setLoadError('No split found with that number.')
    } finally {
      setLoading(false)
    }
  }, [client, idInput])

  useEffect(() => {
    const t = setTimeout(() => void loadSplit(), 250)
    return () => clearTimeout(t)
  }, [loadSplit])

  // A failed payment may mean the split changed; reload so the payer reviews the current shares.
  useEffect(() => {
    if (payTx.error) void loadSplit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payTx.error])

  const balance = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: ARC_ID,
    query: { enabled: Boolean(address) },
  })
  const allowance = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'allowance',
    args: address ? [address, SPLITPAY_ADDRESS] : undefined,
    chainId: ARC_ID,
    query: { enabled: Boolean(address) },
  })

  useEffect(() => {
    if (approveTx.isSuccess) void allowance.refetch()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approveTx.isSuccess])
  useEffect(() => {
    if (payTx.isSuccess) {
      void balance.refetch()
      void allowance.refetch()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payTx.isSuccess])

  let amount: bigint | null = null
  try {
    amount = amountInput.trim() ? parseUsdc(amountInput.trim()) : null
  } catch {
    amount = null
  }
  const reference = encodeReference(refInput)
  const refTooLong = reference === undefined

  const walletBalance = balance.data ?? 0n
  const approved = allowance.data ?? 0n
  const needsApproval = amount !== null && amount > 0n && approved < amount
  const spendable = walletBalance > GAS_RESERVE ? walletBalance - GAS_RESERVE : 0n
  const insufficient = amount !== null && amount > walletBalance
  const leavesNoGas = amount !== null && !insufficient && amount > spendable

  const fee = amount !== null ? (amount * BigInt(FEE_BPS)) / 10000n : 0n
  const net = amount !== null ? amount - fee : 0n
  const shares =
    split && amount !== null
      ? split.bps.map((b) => (net * BigInt(b)) / 10000n)
      : []
  if (shares.length > 0) {
    shares[0] += net - shares.reduce((a, b) => a + b, 0n)
  }

  const busy = approveTx.isPending || approveTx.isConfirming || payTx.isPending || payTx.isConfirming
  const canAct = Boolean(split) && amount !== null && amount > 0n && !insufficient && !leavesNoGas && !refTooLong && !busy

  const onPrimary = () => {
    if (!split || amount === null || reference === undefined) return
    if (needsApproval) {
      approveTx.reset()
      void approveTx.send({ address: USDC_ADDRESS, abi: erc20Abi, functionName: 'approve', args: [SPLITPAY_ADDRESS, amount] })
      return
    }
    payTx.reset()
    void payTx.send({
      address: SPLITPAY_ADDRESS,
      abi: splitPayAbi,
      functionName: 'pay',
      args: [split.id, amount, split.version, reference],
    })
  }

  return (
    <div className="space-y-5">
      <div className="glass rounded-3xl p-5 space-y-3">
        <label className="block text-sm font-medium" htmlFor="split-id">
          Split number
        </label>
        <input
          id="split-id"
          className="field tnum"
          inputMode="numeric"
          placeholder="e.g. 1"
          value={idInput}
          onChange={(e) => setIdInput(e.target.value.replace(/\D/g, ''))}
        />
        {!split && !loading && (
          <p className="text-xs text-[color:var(--muted)] text-pretty">
            Ask the merchant for their payment link (it fills this in for you) or their split number. Merchants find it under
            Merchant, Your splits.
          </p>
        )}
        {loading && <p className="text-sm text-[color:var(--muted)]">Looking up split...</p>}
        {loadError && <p className="text-sm text-red-700">{loadError}</p>}
        {split && (
          <div className="flex items-center gap-4 pt-2">
            <Donut bps={split.bps}>
              <span className="font-display text-xs font-semibold leading-tight">
                Split
                <span className="block text-base">#{split.id.toString()}</span>
              </span>
            </Donut>
            <ul className="min-w-0 flex-1 space-y-1.5">
              {split.recipients.map((r, i) => (
                <li key={r} className="flex items-center gap-2 text-sm">
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: SHARE_COLORS[i % SHARE_COLORS.length] }} />
                  <span className="min-w-0 flex-1 truncate">{contacts.label(r)}</span>
                  <span className="tnum text-right font-medium">
                    {(split.bps[i] / 100).toFixed(2)}%
                    {shares[i] !== undefined && amount !== null && amount > 0n && (
                      <span className="block text-xs font-normal text-[color:var(--muted)]">{formatUsdc(shares[i])} USDC</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="glass rounded-3xl p-6 space-y-5">
        <div>
          <label className="block text-sm font-medium mb-2" htmlFor="amount">
            Amount to pay
          </label>
          <div className="flex items-center gap-3 rounded-2xl bg-white/70 border border-[color:var(--line)] px-4">
            <TokenUSDC variant="branded" size={28} />
            <input
              id="amount"
              className="w-full bg-transparent py-4 text-3xl font-display font-semibold tnum outline-none"
              inputMode="decimal"
              placeholder="0.00"
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
            />
            <span className="text-sm font-medium text-[color:var(--muted)]">USDC</span>
          </div>
          {isConnected && (
            <button
              type="button"
              className="mt-2 text-sm text-[color:var(--muted)] underline tnum"
              onClick={() => setAmountInput(formatUsdc(spendable))}
            >
              Balance: {formatUsdc(walletBalance)} USDC (use max, keeps {formatUsdc(GAS_RESERVE)} for network fees)
            </button>
          )}
          {amountInput.trim() !== '' && amount === null && (
            <p className="mt-2 text-sm text-red-700">Enter a valid amount with up to 6 decimals.</p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium mb-2" htmlFor="ref">
            Reference <span className="text-[color:var(--muted)] font-normal">(optional, e.g. invoice number)</span>
          </label>
          <input id="ref" className="field" value={refInput} onChange={(e) => setRefInput(e.target.value)} placeholder="INV-1042" />
          {refTooLong && <p className="mt-2 text-sm text-red-700">Reference must be 32 bytes or fewer.</p>}
        </div>

        {amount !== null && amount > 0n && (
          <dl className="rounded-2xl bg-white/60 p-4 text-sm space-y-1.5 tnum">
            <div className="flex justify-between">
              <dt className="text-[color:var(--muted)]">Protocol fee ({(FEE_BPS / 100).toFixed(1)}%)</dt>
              <dd>{formatUsdc(fee)} USDC</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[color:var(--muted)]">Shared among recipients</dt>
              <dd>{formatUsdc(net)} USDC</dd>
            </div>
          </dl>
        )}

        {!isConnected ? (
          <div className="flex justify-center">
            <ConnectKitButton />
          </div>
        ) : (
          <button className="btn-primary w-full" disabled={!canAct} onClick={onPrimary}>
            {insufficient
              ? 'Not enough USDC'
              : leavesNoGas
                ? 'Keep some USDC for fees'
                : busy
                ? 'Working...'
                : needsApproval
                  ? 'Step 1 of 2: Approve USDC'
                  : needsApproval === false && amount !== null && amount > 0n && approved >= amount && approveTx.isSuccess
                    ? 'Step 2 of 2: Pay'
                    : 'Pay'}
          </button>
        )}

        <TxStatus tx={approveTx} doneText="USDC approved. Now confirm the payment." />
        <TxStatus tx={payTx} doneText="Payment sent. Recipients can now withdraw their share." />
        <p className="text-xs text-[color:var(--muted)] text-pretty">
          You approve exactly the amount you pay. The shares shown are locked in by the split version you reviewed, so the
          payment fails if the merchant changes the split first.
        </p>
      </div>
    </div>
  )
}
