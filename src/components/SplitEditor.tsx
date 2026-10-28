import { useState } from 'react'
import { isAddress, type Address } from 'viem'
import { Plus, Trash2 } from 'lucide-react'
import { useContacts } from '@/lib/contacts'

interface Row {
  name: string
  addr: string
  pct: string
}

const MAX_RECIPIENTS = 10
const PCT_RE = /^\d{1,3}(\.\d{1,2})?$/

function bpsToPct(bps: number): string {
  return (bps / 100).toString()
}

export function SplitEditor({
  initial,
  submitLabel,
  busy,
  defaultAddress,
  onSubmit,
  onCancel,
}: {
  initial?: { recipients: readonly Address[]; bps: readonly number[] }
  submitLabel: string
  busy: boolean
  defaultAddress?: Address
  onSubmit: (recipients: Address[], bps: number[]) => void
  onCancel?: () => void
}) {
  const contacts = useContacts()
  const [rows, setRows] = useState<Row[]>(
    initial
      ? initial.recipients.map((r, i) => ({ name: contacts.nickname(r), addr: r, pct: bpsToPct(initial.bps[i]) }))
      : [
          { name: '', addr: defaultAddress ?? '', pct: '' },
          { name: '', addr: '', pct: '' },
        ],
  )

  const update = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))

  const splitEvenly = () => {
    const n = rows.length
    const base = Math.floor(10000 / n)
    const first = 10000 - base * (n - 1)
    setRows((rs) => rs.map((r, i) => ({ ...r, pct: bpsToPct(i === 0 ? first : base) })))
  }

  const parsed = rows.map((r) => ({
    addrOk: isAddress(r.addr),
    bps: PCT_RE.test(r.pct) ? Math.round(Number(r.pct) * 100) : NaN,
  }))
  const lowered = rows.map((r) => r.addr.toLowerCase())
  const duplicate = lowered.some((a, i) => a !== '' && lowered.indexOf(a) !== i)
  const allValid = parsed.every((p) => p.addrOk && Number.isFinite(p.bps) && p.bps > 0)
  const total = parsed.reduce((sum, p) => sum + (Number.isFinite(p.bps) ? p.bps : 0), 0)
  const totalOk = total === 10000
  const canSubmit = !busy && allValid && totalOk && !duplicate && rows.length >= 1

  let hint = ''
  if (duplicate) hint = 'Each address can only appear once.'
  else if (!allValid) hint = 'Enter a valid address and a percentage above 0 for every row.'
  else if (!totalOk) hint = `Shares add up to ${(total / 100).toFixed(2)}%. They must total 100%.`

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault()
        if (!canSubmit) return
        contacts.save(Object.fromEntries(rows.map((r) => [r.addr, r.name])))
        onSubmit(
          rows.map((r) => r.addr as Address),
          parsed.map((p) => p.bps),
        )
      }}
    >
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex flex-wrap gap-2 items-center">
            <input
              className="field sm:!w-32 shrink-0"
              placeholder="Label (optional)"
              aria-label={`Recipient ${i + 1} label`}
              maxLength={24}
              value={r.name}
              onChange={(e) => update(i, { name: e.target.value })}
            />
            <input
              className="field font-mono text-sm flex-1 min-w-[12rem]"
              placeholder="0x recipient address"
              aria-label={`Recipient ${i + 1} address`}
              value={r.addr}
              onChange={(e) => update(i, { addr: e.target.value.trim() })}
              spellCheck={false}
            />
            <div className="relative w-28 shrink-0">
              <input
                className="field tnum pr-7 text-right"
                placeholder="0"
                inputMode="decimal"
                aria-label={`Recipient ${i + 1} percentage`}
                value={r.pct}
                onChange={(e) => update(i, { pct: e.target.value.trim() })}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-[color:var(--muted)]">%</span>
            </div>
            <button
              type="button"
              className="btn-ghost !px-3 shrink-0"
              aria-label={`Remove recipient ${i + 1}`}
              disabled={rows.length <= 1}
              onClick={() => setRows((rs) => rs.filter((_, idx) => idx !== i))}
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn-ghost inline-flex items-center gap-1.5"
          disabled={rows.length >= MAX_RECIPIENTS}
          onClick={() => setRows((rs) => [...rs, { name: '', addr: '', pct: '' }])}
        >
          <Plus size={16} /> Add recipient
        </button>
        <button type="button" className="btn-ghost" onClick={splitEvenly}>
          Split evenly
        </button>
        <span className={`ml-auto text-sm tnum ${totalOk ? 'text-emerald-700' : 'text-[color:var(--muted)]'}`}>
          Total {(total / 100).toFixed(2)}%
        </span>
      </div>

      {hint && <p className="text-sm text-[color:var(--muted)]">{hint}</p>}

      <div className="flex gap-2 pt-1">
        <button type="submit" className="btn-primary" disabled={!canSubmit}>
          {busy ? 'Working...' : submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="btn-ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  )
}
