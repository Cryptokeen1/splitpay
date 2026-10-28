import { useQuery } from '@tanstack/react-query'
import { getAbiItem } from 'viem'
import { useAccount, usePublicClient } from 'wagmi'
import { scanEvent } from '@/lib/logScan'
import { ARC_ID } from '@/splitpay'
import {
  VAULT_ADDRESS,
  VAULT_DEPLOY_BLOCK,
  decodeRef,
  vaultAbi,
  type EscrowView,
  type PlanView,
} from '@/payoutvault'

const escrowEvent = getAbiItem({ abi: vaultAbi, name: 'EscrowCreated' })
const planEvent = getAbiItem({ abi: vaultAbi, name: 'PlanCreated' })

/** Escrows and plans the connected wallet is involved in, with live onchain state. */
export function usePayoutData(refreshKey: number) {
  const { address } = useAccount()
  const client = usePublicClient({ chainId: ARC_ID })

  return useQuery({
    queryKey: ['payouts', address, refreshKey],
    enabled: Boolean(client && address),
    refetchInterval: 30000,
    queryFn: async (): Promise<{ escrows: EscrowView[]; plans: PlanView[] }> => {
      if (!client || !address) return { escrows: [], plans: [] }
      const me = address.toLowerCase()
      const [escrowLogs, planLogs] = await Promise.all([
        scanEvent(client, VAULT_ADDRESS, escrowEvent, VAULT_DEPLOY_BLOCK),
        scanEvent(client, VAULT_ADDRESS, planEvent, VAULT_DEPLOY_BLOCK),
      ])

      const involves = (args: Record<string, unknown>, keys: string[]) => keys.some((k) => String(args[k]).toLowerCase() === me)
      const mineEscrows = escrowLogs.filter((l) => involves(l.args, ['payer', 'seller', 'arbiter']))
      const minePlans = planLogs.filter((l) => involves(l.args, ['funder', 'recipient']))

      const escrows = await Promise.all(
        mineEscrows.map(async (l): Promise<EscrowView> => {
          const id = l.args.id as bigint
          const e = await client.readContract({ address: VAULT_ADDRESS, abi: vaultAbi, functionName: 'getEscrow', args: [id] })
          return {
            id,
            payer: e.payer,
            seller: e.seller,
            arbiter: e.arbiter,
            amount: e.amount,
            deadline: Number(e.deadline),
            releaseOnDeadline: e.releaseOnDeadline,
            status: e.status,
            note: decodeRef(l.args.paymentReference as `0x${string}`),
          }
        }),
      )

      const plans = await Promise.all(
        minePlans.map(async (l): Promise<PlanView> => {
          const id = l.args.id as bigint
          const [p, vested, releasable] = await Promise.all([
            client.readContract({ address: VAULT_ADDRESS, abi: vaultAbi, functionName: 'getPlan', args: [id] }),
            client.readContract({ address: VAULT_ADDRESS, abi: vaultAbi, functionName: 'vestedAmount', args: [id] }),
            client.readContract({ address: VAULT_ADDRESS, abi: vaultAbi, functionName: 'releasable', args: [id] }),
          ])
          return {
            id,
            kind: p.kind,
            funder: p.funder,
            recipient: p.recipient,
            total: p.total,
            claimed: p.claimed,
            start: Number(p.start),
            cliff: Number(p.cliff),
            duration: Number(p.duration),
            periods: p.periods,
            revocable: p.revocable,
            revokedAt: Number(p.revokedAt),
            vested,
            releasable,
            note: decodeRef(l.args.paymentReference as `0x${string}`),
          }
        }),
      )

      escrows.sort((a, b) => (a.id < b.id ? 1 : -1))
      plans.sort((a, b) => (a.id < b.id ? 1 : -1))
      return { escrows, plans }
    },
  })
}
