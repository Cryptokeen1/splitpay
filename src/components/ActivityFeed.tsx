import { useQuery } from '@tanstack/react-query'
import { getAbiItem, hexToString, type Hex } from 'viem'
import { useAccount, usePublicClient } from 'wagmi'
import { ArrowDownLeft, ArrowUpRight, Landmark } from 'lucide-react'
import { buildTxExplorerUrl } from '@/onchain-facts'
import { formatUsdc } from '@/onchain-money'
import { scanEvent } from '@/lib/logScan'
import { ARC_ID, SPLITPAY_ADDRESS, SPLITPAY_DEPLOY_BLOCK, splitPayAbi } from '@/splitpay'

type Kind = 'received' | 'paid' | 'withdrawn'

interface Item {
  key: string
  kind: Kind
  amount: bigint
  splitId?: bigint
  note: string
  hash: Hex
  block: bigint
  index: number
  time?: number
}

const createdEvent = getAbiItem({ abi: splitPayAbi, name: 'SplitCreated' })
const paymentEvent = getAbiItem({ abi: splitPayAbi, name: 'PaymentReceived' })
const withdrawnEvent = getAbiItem({ abi: splitPayAbi, name: 'Withdrawn' })

function readRef(ref: Hex): string {
  try {
    return hexToString(ref, { size: 32 }).replace(/\0+$/g, '').trim()
  } catch {
    return ''
  }
}

function ago(ts?: number): string {
  if (!ts) return ''
  const s = Math.max(0, Math.floor(Date.now() / 1000 - ts))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return `${Math.floor(s / 86400)} d ago`
}

const META: Record<Kind, { title: string; sign: string; Icon: typeof ArrowDownLeft; tone: string }> = {
  received: { title: 'Paid into your split', sign: '+', Icon: ArrowDownLeft, tone: 'text-emerald-700 bg-emerald-50' },
  paid: { title: 'Payment sent', sign: '-', Icon: ArrowUpRight, tone: 'text-[color:var(--ink)] bg-white/80' },
  withdrawn: { title: 'Withdrawal', sign: '-', Icon: Landmark, tone: 'text-[color:var(--ink)] bg-white/80' },
}

export function ActivityFeed({ refreshKey }: { refreshKey: number }) {
  const { address } = useAccount()
  const client = usePublicClient({ chainId: ARC_ID })
  const query = useQuery({
    queryKey: ['activity', address, refreshKey],
    enabled: Boolean(client && address),
    refetchInterval: 30000,
    queryFn: async (): Promise<Item[]> => {
      if (!client || !address) return []
      const me = address.toLowerCase()
      const [created, payments, withdrawals] = await Promise.all([
        scanEvent(client, SPLITPAY_ADDRESS, createdEvent, SPLITPAY_DEPLOY_BLOCK),
        scanEvent(client, SPLITPAY_ADDRESS, paymentEvent, SPLITPAY_DEPLOY_BLOCK),
        scanEvent(client, SPLITPAY_ADDRESS, withdrawnEvent, SPLITPAY_DEPLOY_BLOCK),
      ])
      const ownedIds = new Set(created.filter((l) => String(l.args.owner).toLowerCase() === me).map((l) => String(l.args.splitId)))
      const paid = payments.filter((l) => String(l.args.payer).toLowerCase() === me)
      const received = payments.filter((l) => ownedIds.has(String(l.args.splitId)))
      const withdrawn = withdrawals.filter((l) => String(l.args.account).toLowerCase() === me)

      const all: Item[] = []
      const seen = new Set<string>()
      for (const l of received) {
        const id = `${l.transactionHash}-${l.logIndex}`
        seen.add(id)
        // A payment you made to your own split is shown once, as received.
        all.push({
          key: `r-${id}`,
          kind: 'received',
          amount: (l.args.amount as bigint) - (l.args.fee as bigint),
          splitId: l.args.splitId as bigint,
          note: readRef(l.args.paymentReference as Hex),
          hash: l.transactionHash,
          block: l.blockNumber,
          index: l.logIndex,
        })
      }
      for (const l of paid) {
        const id = `${l.transactionHash}-${l.logIndex}`
        if (seen.has(id)) continue
        all.push({
          key: `p-${id}`,
          kind: 'paid',
          amount: l.args.amount as bigint,
          splitId: l.args.splitId as bigint,
          note: readRef(l.args.paymentReference as Hex),
          hash: l.transactionHash,
          block: l.blockNumber,
          index: l.logIndex,
        })
      }
      for (const l of withdrawn) {
        all.push({
          key: `w-${l.transactionHash}-${l.logIndex}`,
          kind: 'withdrawn',
          amount: l.args.amount as bigint,
          note: '',
          hash: l.transactionHash,
          block: l.blockNumber,
          index: l.logIndex,
        })
      }
      all.sort((a, b) => (a.block === b.block ? b.index - a.index : a.block < b.block ? 1 : -1))
      const top = all.slice(0, 12)

      const blocks = [...new Set(top.map((t) => t.block))]
      const stamps = new Map<bigint, number>()
      await Promise.all(
        blocks.map(async (b) => {
          try {
            const blk = await client.getBlock({ blockNumber: b })
            stamps.set(b, Number(blk.timestamp))
          } catch {
            /* time is decorative; skip on failure */
          }
        }),
      )
      return top.map((t) => ({ ...t, time: stamps.get(t.block) }))
    },
  })
  const items = query.data ?? []
  const state: 'idle' | 'loading' | 'error' = query.isError ? 'error' : query.isFetching && items.length === 0 ? 'loading' : 'idle'
  const load = () => void query.refetch()

  return (
    <section className="glass rounded-3xl p-5 space-y-3" aria-label="Activity">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold">Activity</h2>
        {state === 'loading' && <span className="text-xs text-[color:var(--muted)]">Updating...</span>}
      </div>
      {state === 'error' && (
        <p className="text-sm text-[color:var(--muted)]">
          Could not load activity. <button className="underline" onClick={load}>Retry</button>
        </p>
      )}
      {state !== 'error' && items.length === 0 && state !== 'loading' && (
        <p className="text-sm text-[color:var(--muted)] text-pretty">
          Nothing yet. Payments to your splits, payments you send and withdrawals will show up here.
        </p>
      )}
      <ul className="divide-y divide-[color:var(--line)]">
        {items.map((it) => {
          const m = META[it.kind]
          return (
            <li key={it.key}>
              <a
                className="flex items-center gap-3 py-3 min-h-[56px]"
                href={buildTxExplorerUrl(ARC_ID, it.hash)}
                target="_blank"
                rel="noopener noreferrer"
              >
                <span className={`grid size-10 place-items-center rounded-full ${m.tone}`}>
                  <m.Icon size={18} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium truncate">
                    {m.title}
                    {it.splitId !== undefined ? ` · Split #${it.splitId}` : ''}
                  </span>
                  <span className="block text-xs text-[color:var(--muted)] truncate">
                    {[it.note, ago(it.time)].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span className={`tnum text-sm font-semibold ${it.kind === 'received' ? 'text-emerald-700' : ''}`}>
                  {m.sign}
                  {formatUsdc(it.amount)}
                </span>
              </a>
            </li>
          )
        })}
      </ul>
      <p className="text-xs text-[color:var(--muted)]">
        Amounts paid into your splits are shown after the 0.2% protocol fee.
      </p>
    </section>
  )
}
