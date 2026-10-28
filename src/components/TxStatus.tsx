import { Check, ExternalLink, Loader2 } from 'lucide-react'
import { buildTxExplorerUrl } from '@/onchain-facts'
import { ARC_ID, type useChainTx } from '@/splitpay'

type Tx = ReturnType<typeof useChainTx>

export function TxStatus({ tx, doneText }: { tx: Tx; doneText: string }) {
  if (tx.error) {
    return (
      <p role="alert" className="text-sm text-red-700 bg-red-50 rounded-xl px-3 py-2">
        {tx.error}
      </p>
    )
  }
  if (tx.isPending) {
    return (
      <p className="flex items-center gap-2 text-sm text-[color:var(--muted)]">
        <Loader2 size={16} className="animate-spin" /> Confirm in your wallet...
      </p>
    )
  }
  if (tx.isConfirming) {
    return (
      <p className="flex items-center gap-2 text-sm text-[color:var(--muted)]">
        <Loader2 size={16} className="animate-spin" /> Waiting for confirmation...
      </p>
    )
  }
  if (tx.isSuccess && tx.hash) {
    return (
      <p className="flex flex-wrap items-center gap-2 text-sm text-emerald-700 bg-emerald-50 rounded-xl px-3 py-2">
        <Check size={16} /> {doneText}
        <a
          className="inline-flex items-center gap-1 underline"
          href={buildTxExplorerUrl(ARC_ID, tx.hash)}
          target="_blank"
          rel="noopener noreferrer"
        >
          View transaction <ExternalLink size={12} />
        </a>
      </p>
    )
  }
  return null
}
