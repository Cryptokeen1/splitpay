import { useCallback, useEffect, useState } from 'react'
import { getAbiItem, type Address } from 'viem'
import { useAccount, usePublicClient } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { Check, Copy, Pencil, QrCode } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { toast } from 'sonner'
import { useContacts } from '@/lib/contacts'
import { scanEvent } from '@/lib/logScan'
import { getShareBase } from '@/lib/share'
import {
  ARC_ID,
  FEE_BPS,
  SPLITPAY_ADDRESS,
  SPLITPAY_DEPLOY_BLOCK,
  shortAddr,
  splitPayAbi,
  useChainTx,
  type SplitView,
} from '@/splitpay'
import { Donut, SHARE_COLORS } from './Donut'
import { SplitEditor } from './SplitEditor'
import { TxStatus } from './TxStatus'

const createdEvent = getAbiItem({ abi: splitPayAbi, name: 'SplitCreated' })

function SplitCard({ split, base, onChanged }: { split: SplitView; base: string; onChanged: () => void }) {
  const tx = useChainTx()
  const [editing, setEditing] = useState(false)
  const [copied, setCopied] = useState(false)
  const [showQr, setShowQr] = useState(false)
  const contacts = useContacts()
  const link = base ? `${base}/?split=${split.id}` : ''

  useEffect(() => {
    if (tx.isSuccess) {
      setEditing(false)
      onChanged()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tx.isSuccess])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      toast.error('Could not copy. Select the link and copy it manually.')
    }
  }

  return (
    <div className="glass rounded-3xl p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-display text-xl font-semibold">Split #{split.id.toString()}</p>
          <p className="text-xs text-[color:var(--muted)]">Split number {split.id.toString()}. Customers can type it in Pay, or use your link.</p>
          <p className="text-sm text-[color:var(--muted)]">
            Version {split.version} · {split.recipients.length} recipient{split.recipients.length === 1 ? '' : 's'}
          </p>
        </div>
        <button className="btn-ghost inline-flex items-center gap-1.5" onClick={() => setEditing((v) => !v)}>
          <Pencil size={14} /> {editing ? 'Close' : 'Edit'}
        </button>
      </div>

      {editing ? (
        <div className="space-y-3">
          <p className="text-sm text-[color:var(--muted)]">
            Changes apply to future payments only. Money already earned stays with the previous recipients.
          </p>
          <SplitEditor
            initial={{ recipients: split.recipients, bps: split.bps }}
            submitLabel="Save changes"
            busy={tx.isPending || tx.isConfirming}
            onCancel={() => setEditing(false)}
            onSubmit={(recipients, bps) =>
              void tx.send({
                address: SPLITPAY_ADDRESS,
                abi: splitPayAbi,
                functionName: 'updateSplit',
                args: [split.id, recipients, bps],
              })
            }
          />
          <TxStatus tx={tx} doneText="Split updated." />
        </div>
      ) : (
        <div className="flex items-center gap-4">
          <Donut bps={split.bps}>
            <span className="font-display text-sm font-semibold leading-tight">
              {split.recipients.length}
              <span className="block text-[10px] font-normal text-[color:var(--muted)]">ways</span>
            </span>
          </Donut>
          <ul className="min-w-0 flex-1 space-y-1.5">
            {split.recipients.map((r, i) => (
              <li key={r} className="flex items-center gap-2 text-sm">
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: SHARE_COLORS[i % SHARE_COLORS.length] }} />
                <span className="min-w-0 flex-1 truncate">{contacts.label(r)}</span>
                <span className="tnum font-medium">{(split.bps[i] / 100).toFixed(2)}%</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex items-center gap-2">
        <input className="field text-sm font-mono" readOnly value={link} aria-label="Payment link" />
        <button className="btn-ghost inline-flex items-center gap-1.5 shrink-0" disabled={!link} onClick={() => void copy()}>
          {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy link'}
        </button>
        <button
          className="btn-ghost !px-3 shrink-0"
          aria-label="Show QR code"
          aria-pressed={showQr}
          disabled={!link}
          onClick={() => setShowQr((v) => !v)}
        >
          <QrCode size={16} />
        </button>
      </div>
      {showQr && link && (
        <div className="flex flex-col items-center gap-2 rounded-2xl qr-box p-4">
          <QRCodeSVG value={link} size={168} fgColor="#0f1b33" />
          <p className="text-xs text-[color:var(--muted)]">Scan to pay split #{split.id.toString()}</p>
        </div>
      )}
    </div>
  )
}

export function MerchantTab() {
  const { address, isConnected } = useAccount()
  const client = usePublicClient({ chainId: ARC_ID })
  const [splits, setSplits] = useState<SplitView[]>([])
  const [loading, setLoading] = useState(false)
  const [base, setBase] = useState('')
  const createTx = useChainTx()

  useEffect(() => {
    void getShareBase().then(setBase)
  }, [])

  const load = useCallback(async () => {
    if (!client || !address) return
    setLoading(true)
    try {
      const all = await scanEvent(client, SPLITPAY_ADDRESS, createdEvent, SPLITPAY_DEPLOY_BLOCK)
      const logs = all.filter((l) => String(l.args.owner).toLowerCase() === address.toLowerCase())
      const views = await Promise.all(
        logs.map(async (l) => {
          const id = l.args.splitId as bigint
          const [owner, version, recipients, bps] = await client.readContract({
            address: SPLITPAY_ADDRESS,
            abi: splitPayAbi,
            functionName: 'getSplit',
            args: [id],
          })
          return { id, owner, version, recipients, bps } satisfies SplitView
        }),
      )
      setSplits(views.sort((a, b) => (a.id < b.id ? 1 : -1)))
    } catch {
      toast.error('Could not load your splits. Please retry.')
    } finally {
      setLoading(false)
    }
  }, [client, address])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (createTx.isSuccess) void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createTx.isSuccess])

  if (!isConnected) {
    return (
      <div className="glass rounded-3xl p-8 text-center space-y-4">
        <p className="font-display text-2xl font-semibold">Set up how you get paid</p>
        <p className="text-[color:var(--muted)] text-pretty">
          Connect a wallet to create a split and get a payment link you can share with customers.
        </p>
        <div className="flex justify-center">
          <ConnectKitButton />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="glass rounded-3xl p-5 space-y-4">
        <div>
          <p className="font-display text-xl font-semibold">Create a split</p>
          <p className="text-sm text-[color:var(--muted)] text-pretty">
            Choose who receives each payment and what share they get. A {(FEE_BPS / 100).toFixed(1)}% protocol fee is taken
            from every payment before it is divided. Labels are saved on this device only.
          </p>
        </div>
        <SplitEditor
          key={createTx.isSuccess ? String(createTx.hash) : 'new'}
          defaultAddress={address}
          submitLabel="Create split"
          busy={createTx.isPending || createTx.isConfirming}
          onSubmit={(recipients, bps) =>
            void createTx.send({
              address: SPLITPAY_ADDRESS,
              abi: splitPayAbi,
              functionName: 'createSplit',
              args: [recipients, bps],
            })
          }
        />
        <TxStatus tx={createTx} doneText="Split created. Your payment link is below." />
      </div>

      <div className="space-y-4">
        <p className="font-display text-lg font-semibold">Your splits</p>
        {loading && splits.length === 0 && <p className="text-sm text-[color:var(--muted)]">Loading your splits...</p>}
        {!loading && splits.length === 0 && (
          <p className="text-sm text-[color:var(--muted)]">You have not created a split yet.</p>
        )}
        {splits.map((s) => (
          <SplitCard key={s.id.toString()} split={s} base={base} onChanged={() => void load()} />
        ))}
      </div>
    </div>
  )
}
