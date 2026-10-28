import { useEffect, useRef, useState } from 'react'
import { useAccount, useSignMessage } from 'wagmi'
import { CreditCard, Loader2, X } from 'lucide-react'
import { appUserIdFor, buildAuthMessage, nowSeconds } from '@/lib/onrampAuth'
import { IS_MAINNET } from '@/network'

type Widget = { close: () => void }
type Phase = 'idle' | 'signing' | 'loading' | 'open' | 'done' | 'error'

const WIDGET_BASE_URL = import.meta.env.VITE_ONRAMP_WIDGET_BASE_URL
const IS_SANDBOX = !WIDGET_BASE_URL || WIDGET_BASE_URL.includes('sandbox')

/** Buy USDC with a card or bank transfer using Circle's hosted onramp widget, delivered to your connected wallet. */
export function BuyUsdc() {
  const { address } = useAccount()
  const { signMessageAsync } = useSignMessage()
  const containerRef = useRef<HTMLDivElement>(null)
  const widgetRef = useRef<Widget | null>(null)
  const remints = useRef(0)
  const [phase, setPhase] = useState<Phase>('idle')
  const [message, setMessage] = useState('')

  const stop = () => {
    widgetRef.current?.close()
    widgetRef.current = null
  }
  useEffect(() => stop, [])

  // On mainnet the checkout needs a production key and business verification; hide it while it is still in test mode.
  if (!address || (IS_MAINNET && IS_SANDBOX)) return null

  const start = async () => {
    stop()
    setMessage('')
    try {
      setPhase('signing')
      const text = buildAuthMessage(address, nowSeconds())
      const signature = await signMessageAsync({ message: text })

      setPhase('loading')
      const { AppKit } = await import('@circle-fin/app-kit')
      const kit = new AppKit({ onramp: { widgetBaseUrl: WIDGET_BASE_URL } })
      const session = await kit.onramp.fetchSession({
        url: '/api/onramp/sessions',
        headers: { 'x-auth-message': encodeURIComponent(text), 'x-auth-signature': signature },
        body: { appUserId: appUserIdFor(address), destinationAddress: address, assets: { tokens: ['USDC'] } },
      })

      const container = containerRef.current
      if (!container) return
      setPhase('open')
      widgetRef.current = kit.onramp.mountIframe({
        session,
        container,
        onInitializationSuccess: () => {
          remints.current = 0
        },
        onDepositSubmitted: () => {
          setMessage('Purchase submitted. Funds arrive in your wallet once the payment settles.')
          setPhase('done')
        },
        onDepositNotCompleted: ({ code }) => {
          if (code === 'CANCELED_BY_CUSTOMER') setPhase('idle')
          else {
            setMessage('The purchase did not complete. You have not been charged.')
            setPhase('error')
          }
        },
        // Fires for timeouts and invalid sessions; retry once so a misconfiguration cannot loop.
        onSessionExpired: () => {
          if (remints.current++ > 0) {
            setMessage('Could not start the purchase. Please try again.')
            setPhase('error')
            return
          }
          void start()
        },
      })
    } catch (e) {
      const text = e instanceof Error ? e.message.toLowerCase() : ''
      if (text.includes('user rejected') || text.includes('user denied')) {
        setPhase('idle')
        return
      }
      setMessage('Could not open the purchase window. Please try again.')
      setPhase('error')
    }
  }

  const busy = phase === 'signing' || phase === 'loading'

  return (
    <div className="space-y-3 rounded-2xl bg-white/60 p-4">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-white">
          <CreditCard size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Buy USDC with a card or bank transfer</p>
          <p className="text-xs text-[color:var(--muted)] text-pretty">
            Opens Circle's secure checkout. You confirm with a free signature, never a payment from your wallet.
          </p>
        </div>
      </div>

      {IS_SANDBOX && (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900 text-pretty">
          Test mode: no real money moves. Test purchases may be delivered on Ethereum rather than Arc Testnet, so they will not always show
          in your Arc balance.
        </p>
      )}

      {phase !== 'open' ? (
        <button className="btn-primary w-full inline-flex items-center justify-center gap-2" disabled={busy} onClick={() => void start()}>
          {busy && <Loader2 size={16} className="animate-spin" />}
          {phase === 'signing' ? 'Confirm in your wallet...' : phase === 'loading' ? 'Opening checkout...' : 'Buy USDC'}
        </button>
      ) : (
        <button
          className="btn-ghost inline-flex items-center gap-1.5"
          onClick={() => {
            stop()
            setPhase('idle')
          }}
        >
          <X size={14} /> Close checkout
        </button>
      )}

      {message && (
        <p role="status" className={`text-sm ${phase === 'error' ? 'text-red-700' : 'text-emerald-700'}`}>
          {message}
        </p>
      )}
      <div ref={containerRef} className={phase === 'open' ? 'w-full overflow-hidden rounded-2xl' : 'hidden'} style={{ height: phase === 'open' ? 720 : 0 }} />
    </div>
  )
}
