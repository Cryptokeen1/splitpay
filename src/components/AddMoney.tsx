import { useState } from 'react'
import { useAccount } from 'wagmi'
import { QRCodeSVG } from 'qrcode.react'
import { Check, Copy, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { IS_MAINNET, NETWORK_LABEL } from '@/network'
import { BuyUsdc } from './BuyUsdc'

/** Receive USDC into your wallet: show the address, a QR code and where testnet USDC comes from. */
export function AddMoney() {
  const { address } = useAccount()
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  if (!address) return null

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      toast.error('Could not copy. Select the address and copy it manually.')
    }
  }

  return (
    <section className="glass rounded-3xl p-5 space-y-3" aria-label="Add money">
      <button className="flex w-full items-center justify-between min-h-[44px]" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="flex items-center gap-2 font-display text-lg font-semibold">
          <Plus size={18} /> Add money
        </span>
        <span className="text-sm text-[color:var(--muted)]">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <div className="space-y-4">
          <BuyUsdc />
          <p className="text-sm text-[color:var(--muted)] text-pretty">
            Or have someone send USDC on {NETWORK_LABEL} to your wallet address. It shows up in your wallet balance right away. From there you can
            pay a split or lock funds in Payouts.
          </p>
          <div className="flex justify-center rounded-2xl qr-box p-4">
            <QRCodeSVG value={address} size={148} fgColor="#0f1b33" />
          </div>
          <div className="flex items-center gap-2">
            <input className="field font-mono text-xs" readOnly value={address} aria-label="Your wallet address" />
            <button className="btn-ghost inline-flex shrink-0 items-center gap-1.5" onClick={() => void copy()}>
              {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="text-xs text-[color:var(--muted)] text-pretty">
            {IS_MAINNET ? (
              <>Only send USDC on {NETWORK_LABEL} to this address. Sending other networks' tokens here can lose them.</>
            ) : (
              <>
                Need test USDC? Tap <span className="font-semibold">Get test USDC</span> in the Arc Studio sidebar. Only send USDC on{' '}
                {NETWORK_LABEL} to this address. Sending other networks' tokens here can lose them.
              </>
            )}
          </p>
        </div>
      )}
    </section>
  )
}
