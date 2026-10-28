import { TriangleAlert } from 'lucide-react'

const VARS = [
  'VITE_ARC_NETWORK=mainnet',
  'VITE_SPLITPAY_ADDRESS=0x...',
  'VITE_SPLITPAY_DEPLOY_BLOCK=...',
  'VITE_PAYOUT_VAULT_ADDRESS=0x...',
  'VITE_PAYOUT_VAULT_DEPLOY_BLOCK=...',
]

/** Shown on mainnet until the two contracts have been deployed by you and their details are configured. */
export function MainnetSetup() {
  return (
    <section className="glass rounded-3xl p-6 space-y-4" aria-label="Mainnet setup">
      <div className="flex items-start gap-3">
        <TriangleAlert className="mt-1 shrink-0" size={20} />
        <div>
          <h2 className="font-display text-xl font-semibold">Contracts are not deployed on Arc mainnet yet</h2>
          <p className="text-sm text-[color:var(--muted)] text-pretty">
            Mainnet uses real USDC and cannot be undone. You deploy the two contracts from your own wallet, then tell the app where they are.
            The full checklist is in <span className="font-mono">docs/mainnet-deploy.md</span>.
          </p>
        </div>
      </div>
      <ol className="list-decimal space-y-1.5 pl-5 text-sm text-pretty">
        <li>Get an independent professional review of both contracts.</li>
        <li>Deploy SplitPay and PayoutVault to Arc mainnet from your own wallet.</li>
        <li>Note each contract address and the block it was deployed in.</li>
        <li>Add these values to <span className="font-mono">.env</span> and restart the app:</li>
      </ol>
      <pre className="overflow-x-auto rounded-2xl bg-white/60 p-4 text-xs leading-relaxed">{VARS.join('\n')}</pre>
      <p className="text-xs text-[color:var(--muted)]">To go back to the test network, remove <span className="font-mono">VITE_ARC_NETWORK</span> and restart.</p>
    </section>
  )
}
