import { erc20Abi } from 'viem'
import { useAccount, useReadContract } from 'wagmi'
import { Fuel } from 'lucide-react'
import { formatUsdc } from '@/onchain-money'
import { IS_MAINNET } from '@/network'
import { ARC_ID, GAS_MIN, USDC_ADDRESS } from '@/splitpay'

/**
 * On Arc, network fees are paid in USDC from the same balance you spend. A wallet with
 * no USDC cannot send any transaction, including withdrawing money it is owed.
 */
export function GasNotice() {
  const { address, isConnected } = useAccount()
  const balance = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: ARC_ID,
    query: { enabled: Boolean(address), refetchInterval: 20000 },
  })

  if (!isConnected || balance.data === undefined || balance.data >= GAS_MIN) return null
  return (
    <div role="status" className="flex gap-3 rounded-2xl bg-amber-50 p-4 text-amber-900">
      <Fuel size={18} className="mt-0.5 shrink-0" />
      <p className="text-sm text-pretty">
        <span className="font-semibold">Your wallet has {formatUsdc(balance.data)} USDC.</span> Network fees on Arc are paid in USDC,
        so you need a little to do anything, even withdrawing money you are owed.{' '}
        {IS_MAINNET ? (
          'Add some USDC to your wallet to continue.'
        ) : (
          <>
            Tap <span className="font-semibold">Get test USDC</span> in the sidebar to top up.
          </>
        )}
      </p>
    </div>
  )
}
