import { useEffect, useState } from 'react'
import { erc20Abi, isAddress, type Address } from 'viem'
import { useAccount, useReadContract } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { CalendarClock, Handshake, Repeat, TrendingUp } from 'lucide-react'
import { formatUsdc, parseUsdc } from '@/onchain-money'
import {
  MIN_DURATION_SECONDS,
  UNITS,
  VAULT_ADDRESS,
  VAULT_FEE_BPS,
  inputToUnix,
  vaultAbi,
} from '@/payoutvault'
import { ARC_ID, GAS_RESERVE, USDC_ADDRESS, encodeReference, useChainTx } from '@/splitpay'
import { TxStatus } from './TxStatus'

type Mode = 'escrow' | 'vesting' | 'scheduled' | 'payroll'

const MODES: { id: Mode; label: string; hint: string; Icon: typeof Handshake }[] = [
  { id: 'escrow', label: 'Escrow', hint: 'Hold money until you approve', Icon: Handshake },
  { id: 'scheduled', label: 'Scheduled', hint: 'Unlock on a set date', Icon: CalendarClock },
  { id: 'vesting', label: 'Vesting', hint: 'Unlock gradually over time', Icon: TrendingUp },
  { id: 'payroll', label: 'Payroll', hint: 'Pay in equal steps', Icon: Repeat },
]

function Duration({
  label,
  value,
  unit,
  onValue,
  onUnit,
  hint,
}: {
  label: string
  value: string
  unit: string
  onValue: (v: string) => void
  onUnit: (u: string) => void
  hint?: string
}) {
  return (
    <div>
      <label className="block text-sm font-medium mb-1.5">{label}</label>
      <div className="flex gap-2">
        <input className="field tnum" inputMode="decimal" value={value} onChange={(e) => onValue(e.target.value)} aria-label={label} />
        <select className="field !w-auto" value={unit} onChange={(e) => onUnit(e.target.value)} aria-label={`${label} unit`}>
          {UNITS.map((u) => (
            <option key={u.id} value={u.id}>
              {u.label}
            </option>
          ))}
        </select>
      </div>
      {hint && <p className="mt-1 text-xs text-[color:var(--muted)]">{hint}</p>}
    </div>
  )
}

function toSeconds(value: string, unit: string): number | null {
  const n = Number(value)
  const u = UNITS.find((x) => x.id === unit)
  if (!u || !value.trim() || !Number.isFinite(n) || n < 0) return null
  return Math.floor(n * u.seconds)
}

export function PayoutCreate({ onCreated }: { onCreated: () => void }) {
  const { address, isConnected } = useAccount()
  const [mode, setMode] = useState<Mode>('escrow')
  const [who, setWho] = useState('')
  const [arbiter, setArbiter] = useState('')
  const [amountInput, setAmountInput] = useState('')
  const [refInput, setRefInput] = useState('')
  const [when, setWhen] = useState('')
  const [startNow, setStartNow] = useState(true)
  const [onDeadline, setOnDeadline] = useState<'release' | 'refund'>('refund')
  const [revocable, setRevocable] = useState(true)
  const [cliffV, setCliffV] = useState('0')
  const [cliffU, setCliffU] = useState('days')
  const [durV, setDurV] = useState('12')
  const [durU, setDurU] = useState('months')
  const [periodU, setPeriodU] = useState('weeks')
  const [periodV, setPeriodV] = useState('2')
  const [periods, setPeriods] = useState('6')
  const approveTx = useChainTx()
  const createTx = useChainTx()

  const allowance = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'allowance',
    args: address ? [address, VAULT_ADDRESS] : undefined,
    chainId: ARC_ID,
    query: { enabled: Boolean(address) },
  })
  const balance = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: ARC_ID,
    query: { enabled: Boolean(address) },
  })

  useEffect(() => {
    if (approveTx.isSuccess) void allowance.refetch()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approveTx.isSuccess])
  useEffect(() => {
    if (createTx.isSuccess) {
      void allowance.refetch()
      void balance.refetch()
      onCreated()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createTx.isSuccess])

  let amount: bigint | null = null
  try {
    amount = amountInput.trim() ? parseUsdc(amountInput.trim()) : null
  } catch {
    amount = null
  }
  const reference = encodeReference(refInput)
  const whoOk = isAddress(who) && who.toLowerCase() !== address?.toLowerCase()
  const arbiterOk = arbiter === '' || (isAddress(arbiter) && arbiter.toLowerCase() !== who.toLowerCase() && arbiter.toLowerCase() !== address?.toLowerCase())
  const whenUnix = inputToUnix(when)
  const nowSec = Math.floor(Date.now() / 1000)
  const startUnix = startNow ? nowSec : whenUnix
  const cliffS = toSeconds(cliffV, cliffU)
  const durS = toSeconds(durV, durU)
  const periodS = toSeconds(periodV, periodU)
  const periodsN = /^\d+$/.test(periods) ? Number(periods) : NaN

  // Mirror the contract's rules so the button only enables for requests that can succeed.
  let problem = ''
  if (amount === null || amount === 0n) problem = 'Enter an amount.'
  else if (!whoOk) problem = mode === 'escrow' ? 'Enter the seller address.' : 'Enter a recipient address that is not your own.'
  else if (!arbiterOk && mode === 'escrow') problem = 'The arbiter must be a different address from you and the seller.'
  else if (reference === undefined) problem = 'Reference must be 32 bytes or fewer.'
  else if (mode === 'escrow' && (whenUnix === null || whenUnix < nowSec + MIN_DURATION_SECONDS)) problem = 'Pick a deadline at least one hour from now.'
  else if (mode === 'scheduled' && (whenUnix === null || whenUnix < nowSec + MIN_DURATION_SECONDS)) problem = 'Pick an unlock date at least one hour from now.'
  else if (mode === 'vesting' && (durS === null || durS < MIN_DURATION_SECONDS)) problem = 'Vesting must last at least one hour.'
  else if (mode === 'vesting' && (cliffS === null || (durS !== null && cliffS > durS))) problem = 'The cliff cannot be longer than the vesting period.'
  else if (mode === 'vesting' && startUnix === null) problem = 'Pick a start date.'
  else if (mode === 'vesting' && startUnix !== null && durS !== null && startUnix + durS <= nowSec) problem = 'Vesting must end in the future.'
  else if (mode === 'payroll' && (periodS === null || periodS < MIN_DURATION_SECONDS)) problem = 'Each pay period must be at least one hour.'
  else if (mode === 'payroll' && (!Number.isFinite(periodsN) || periodsN < 1 || periodsN > 520)) problem = 'Use between 1 and 520 payments.'
  else if (mode === 'payroll' && startUnix === null) problem = 'Pick a start date.'
  else if (mode === 'payroll' && amount !== null && BigInt(periodsN) > amount) problem = 'Amount is too small for that many payments.'

  const walletBal = balance.data ?? 0n
  const spendable = walletBal > GAS_RESERVE ? walletBal - GAS_RESERVE : 0n
  const insufficient = amount !== null && amount > walletBal
  const leavesNoGas = amount !== null && !insufficient && amount > spendable
  const needsApproval = amount !== null && amount > 0n && (allowance.data ?? 0n) < amount
  const busy = approveTx.isPending || approveTx.isConfirming || createTx.isPending || createTx.isConfirming
  const canAct = !problem && !insufficient && !leavesNoGas && !busy

  const submit = () => {
    if (amount === null || reference === undefined) return
    if (needsApproval) {
      approveTx.reset()
      void approveTx.send({ address: USDC_ADDRESS, abi: erc20Abi, functionName: 'approve', args: [VAULT_ADDRESS, amount] })
      return
    }
    createTx.reset()
    const to = who as Address
    const common = { address: VAULT_ADDRESS, abi: vaultAbi } as const
    if (mode === 'escrow') {
      void createTx.send({
        ...common,
        functionName: 'createEscrow',
        args: [to, (arbiter || '0x0000000000000000000000000000000000000000'), amount, BigInt(whenUnix ?? 0), onDeadline === 'release', reference],
      })
    } else if (mode === 'scheduled') {
      void createTx.send({ ...common, functionName: 'createScheduled', args: [to, amount, BigInt(whenUnix ?? 0), revocable, reference] })
    } else if (mode === 'vesting') {
      void createTx.send({
        ...common,
        functionName: 'createVesting',
        args: [to, amount, BigInt(startUnix ?? 0), BigInt(cliffS ?? 0), BigInt(durS ?? 0), revocable, reference],
      })
    } else {
      void createTx.send({
        ...common,
        functionName: 'createPayroll',
        args: [to, amount, BigInt(startUnix ?? 0), BigInt(periodS ?? 0), periodsN, revocable, reference],
      })
    }
  }

  if (!isConnected) {
    return (
      <div className="glass rounded-3xl p-8 text-center space-y-4">
        <p className="font-display text-2xl font-semibold">Lock money with rules</p>
        <p className="text-[color:var(--muted)] text-pretty">Connect a wallet to create an escrow, vesting schedule or payroll.</p>
        <div className="flex justify-center">
          <ConnectKitButton />
        </div>
      </div>
    )
  }

  const perPayment = mode === 'payroll' && amount !== null && Number.isFinite(periodsN) && periodsN > 0 ? amount / BigInt(periodsN) : null
  const label = mode === 'escrow' ? 'Seller address' : 'Recipient address'

  return (
    <div className="glass rounded-3xl p-5 space-y-5">
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Payout type">
        {MODES.map(({ id, label: l, hint, Icon }) => (
          <button
            key={id}
            role="radio"
            aria-checked={mode === id}
            onClick={() => setMode(id)}
            className={`rounded-2xl border p-3 text-left min-h-[64px] transition-colors ${
              mode === id ? 'border-[color:var(--ink)] bg-white' : 'border-[color:var(--line)] bg-white/40 hover:bg-white/70'
            }`}
          >
            <Icon size={18} />
            <span className="mt-1 block text-sm font-semibold">{l}</span>
            <span className="block text-xs text-[color:var(--muted)]">{hint}</span>
          </button>
        ))}
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1.5" htmlFor="who">{label}</label>
          <input id="who" className="field font-mono text-sm" placeholder="0x..." value={who} onChange={(e) => setWho(e.target.value.trim())} spellCheck={false} />
        </div>

        {mode === 'escrow' && (
          <div>
            <label className="block text-sm font-medium mb-1.5" htmlFor="arb">
              Arbiter <span className="font-normal text-[color:var(--muted)]">(optional, can release or refund)</span>
            </label>
            <input id="arb" className="field font-mono text-sm" placeholder="0x..." value={arbiter} onChange={(e) => setArbiter(e.target.value.trim())} spellCheck={false} />
          </div>
        )}

        <div>
          <label className="block text-sm font-medium mb-1.5" htmlFor="amt">
            {mode === 'payroll' ? 'Total amount to lock' : 'Amount'}
          </label>
          <div className="flex items-center gap-2">
            <input id="amt" className="field tnum text-lg" inputMode="decimal" placeholder="0.00" value={amountInput} onChange={(e) => setAmountInput(e.target.value)} />
            <span className="text-sm font-medium text-[color:var(--muted)]">USDC</span>
          </div>
          <button type="button" className="mt-1.5 text-xs underline text-[color:var(--muted)] tnum" onClick={() => setAmountInput(formatUsdc(spendable))}>
            Balance: {formatUsdc(walletBal)} USDC (use max, keeps {formatUsdc(GAS_RESERVE)} for network fees)
          </button>
        </div>

        {(mode === 'escrow' || mode === 'scheduled') && (
          <div>
            <label className="block text-sm font-medium mb-1.5" htmlFor="when">
              {mode === 'escrow' ? 'Deadline' : 'Unlock date'}
            </label>
            <input id="when" type="datetime-local" className="field" value={when} onChange={(e) => setWhen(e.target.value)} />
          </div>
        )}

        {mode === 'escrow' && (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium mb-1">If nobody decides by the deadline</legend>
            {(
              [
                ['refund', 'Refund me'],
                ['release', 'Release to the seller'],
              ] as const
            ).map(([v, l]) => (
              <label key={v} className="flex items-center gap-2 text-sm min-h-[36px]">
                <input type="radio" name="ondeadline" checked={onDeadline === v} onChange={() => setOnDeadline(v)} /> {l}
              </label>
            ))}
          </fieldset>
        )}

        {(mode === 'vesting' || mode === 'payroll') && (
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm min-h-[36px]">
              <input type="checkbox" checked={startNow} onChange={(e) => setStartNow(e.target.checked)} /> Start now
            </label>
            {!startNow && <input type="datetime-local" className="field" value={when} onChange={(e) => setWhen(e.target.value)} aria-label="Start date" />}
          </div>
        )}

        {mode === 'vesting' && (
          <>
            <Duration label="Vests over" value={durV} unit={durU} onValue={setDurV} onUnit={setDurU} />
            <Duration label="Cliff" value={cliffV} unit={cliffU} onValue={setCliffV} onUnit={setCliffU} hint="Nothing can be claimed until the cliff passes. Use 0 for none." />
          </>
        )}

        {mode === 'payroll' && (
          <>
            <Duration label="Pay every" value={periodV} unit={periodU} onValue={setPeriodV} onUnit={setPeriodU} />
            <div>
              <label className="block text-sm font-medium mb-1.5" htmlFor="periods">Number of payments</label>
              <input id="periods" className="field tnum" inputMode="numeric" value={periods} onChange={(e) => setPeriods(e.target.value.replace(/\D/g, ''))} />
              {perPayment !== null && (
                <p className="mt-1 text-xs text-[color:var(--muted)] tnum">About {formatUsdc(perPayment)} USDC per payment, before the fee. The first payment unlocks after one full period.</p>
              )}
            </div>
          </>
        )}

        {mode !== 'escrow' && (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={revocable} onChange={(e) => setRevocable(e.target.checked)} />
            <span>
              I can cancel this plan
              <span className="block text-xs text-[color:var(--muted)]">
                Cancelling returns only what has not unlocked yet. Unlocked money stays claimable by the recipient. Turn this off to guarantee the recipient gets everything.
              </span>
            </span>
          </label>
        )}

        <div>
          <label className="block text-sm font-medium mb-1.5" htmlFor="pref">
            Reference <span className="font-normal text-[color:var(--muted)]">(optional)</span>
          </label>
          <input id="pref" className="field" placeholder="Contract 42, March payroll..." value={refInput} onChange={(e) => setRefInput(e.target.value)} />
        </div>
      </div>

      <p className="text-xs text-[color:var(--muted)] text-pretty">
        A flat {(VAULT_FEE_BPS / 100).toFixed(1)}% fee is taken only when money is paid out to the recipient. Refunds and cancelled amounts are fee-free.
      </p>

      <button className="btn-primary w-full" disabled={!canAct} onClick={submit}>
        {insufficient ? 'Not enough USDC' : leavesNoGas ? 'Keep some USDC for fees' : busy ? 'Working...' : needsApproval ? 'Step 1 of 2: Approve USDC' : 'Lock funds'}
      </button>
      {problem && amountInput !== '' && <p className="text-sm text-[color:var(--muted)]">{problem}</p>}
      <TxStatus tx={approveTx} doneText="USDC approved. Now lock the funds." />
      <TxStatus tx={createTx} doneText="Funds locked. Find it under My payouts." />
    </div>
  )
}
