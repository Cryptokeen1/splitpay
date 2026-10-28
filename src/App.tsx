import { useState } from 'react'
import { ConnectKitButton } from 'connectkit'
import { motion, useReducedMotion } from 'framer-motion'
import { ExternalLink, Home, Landmark, Send, Store } from 'lucide-react'
import { buildAddressExplorerUrl } from '@/onchain-facts'
import { ARC_ID, SPLITPAY_ADDRESS } from '@/splitpay'
import { IS_DEPLOYED, IS_MAINNET, NETWORK_LABEL } from '@/network'
import { MainnetSetup } from '@/components/MainnetSetup'
import { GasNotice } from '@/components/GasNotice'
import { HomeTab } from '@/components/HomeTab'
import { MerchantTab } from '@/components/MerchantTab'
import { PayTab } from '@/components/PayTab'
import { PayoutsTab } from '@/components/PayoutsTab'
import { ThemeToggle } from '@/components/ThemeToggle'

type Tab = 'home' | 'pay' | 'payouts' | 'merchant'

const TABS: { id: Tab; label: string; Icon: typeof Home }[] = [
  { id: 'home', label: 'Home', Icon: Home },
  { id: 'pay', label: 'Pay', Icon: Send },
  { id: 'payouts', label: 'Payouts', Icon: Landmark },
  { id: 'merchant', label: 'Merchant', Icon: Store },
]

function initialTab(): Tab {
  return new URLSearchParams(window.location.search).has('split') ? 'pay' : 'home'
}

export default function App() {
  const [tab, setTab] = useState<Tab>(initialTab)
  const reduce = useReducedMotion()

  return (
    <div className="min-h-dvh">
      <div className="mx-auto w-full max-w-xl px-4 pb-32 pt-6 space-y-6">
        <header className="flex items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-3xl font-bold">SplitPay</h1>
            <p className="text-sm text-[color:var(--muted)] text-pretty">One USDC payment, shared automatically.</p>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <ConnectKitButton />
          </div>
        </header>

        {IS_MAINNET && (
          <p role="status" className="rounded-2xl bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-900">
            Arc mainnet: transactions use real USDC and cannot be undone.
          </p>
        )}

        {IS_DEPLOYED && <nav className="glass fixed inset-x-0 bottom-0 z-40 mx-auto grid w-full max-w-xl grid-cols-4 gap-1 rounded-t-3xl px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2" aria-label="Sections">
          {TABS.map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              aria-current={tab === id ? 'page' : undefined}
              className={`flex min-h-[52px] flex-col items-center justify-center gap-0.5 rounded-2xl text-xs font-semibold transition-colors ${
                tab === id ? 'bg-[color:var(--accent)] text-[color:var(--on-accent)]' : 'text-[color:var(--muted)] hover:bg-white/60'
              }`}
            >
              <Icon size={18} />
              {label}
            </button>
          ))}
        </nav>}

        <GasNotice />

        {!IS_DEPLOYED && <MainnetSetup />}

        {IS_DEPLOYED && <motion.main
          key={tab}
          initial={reduce ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
        >
          {tab === 'home' && <HomeTab onOpenPayouts={() => setTab('payouts')} />}
          {tab === 'pay' && <PayTab />}
          {tab === 'payouts' && <PayoutsTab />}
          {tab === 'merchant' && <MerchantTab />}
        </motion.main>}

        <footer className="text-xs text-[color:var(--muted)] flex items-center gap-1.5">
          Contracts on {NETWORK_LABEL}
          {IS_DEPLOYED && <a
            className="inline-flex items-center gap-1 underline"
            href={buildAddressExplorerUrl(ARC_ID, SPLITPAY_ADDRESS)}
            target="_blank"
            rel="noopener noreferrer"
          >
            View <ExternalLink size={11} />
          </a>}
        </footer>
      </div>

    </div>
  )
}
