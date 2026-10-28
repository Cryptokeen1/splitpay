import type { AbiEvent, Address, Hex, PublicClient } from 'viem'

/** The RPC rejects eth_getLogs ranges above ~5,000 blocks, so history is read in small windows. */
const WINDOW = 3000n
const CONCURRENCY = 3
const RETRIES = 4
/** Re-read the newest blocks on every refresh so a reorg cannot leave a stale or missing event. */
const REORG_OVERLAP = 25n

export interface ScannedLog {
  args: Record<string, unknown>
  transactionHash: Hex
  blockNumber: bigint
  logIndex: number
}

interface Cache {
  upTo: bigint
  logs: ScannedLog[]
}

const memory = new Map<string, Cache>()
const inflight = new Map<string, Promise<ScannedLog[]>>()

const BIG = '__big:'

function save(key: string, cache: Cache) {
  try {
    localStorage.setItem(
      key,
      JSON.stringify({ upTo: cache.upTo, logs: cache.logs }, (_, v: unknown) => (typeof v === 'bigint' ? `${BIG}${v}` : v)),
    )
  } catch {
    /* storage is only a speed-up */
  }
}

function load(key: string): Cache | undefined {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return undefined
    const parsed = JSON.parse(raw, (_, v: unknown) => (typeof v === 'string' && v.startsWith(BIG) ? BigInt(v.slice(BIG.length)) : v)) as Cache
    return typeof parsed.upTo === 'bigint' && Array.isArray(parsed.logs) ? parsed : undefined
  } catch {
    return undefined
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function fetchChunk(client: PublicClient, address: Address, event: AbiEvent, from: bigint, to: bigint): Promise<ScannedLog[]> {
  for (let attempt = 1; ; attempt++) {
    try {
      const logs = await client.getLogs({ address, event, fromBlock: from, toBlock: to })
      return logs.map((l) => ({
        args: ((l as { args?: unknown }).args ?? {}) as Record<string, unknown>,
        transactionHash: l.transactionHash,
        blockNumber: l.blockNumber ?? 0n,
        logIndex: l.logIndex ?? 0,
      }))
    } catch (e) {
      if (attempt >= RETRIES) throw e
      await sleep(600 * attempt)
    }
  }
}

async function scan(client: PublicClient, address: Address, event: AbiEvent, deployBlock: bigint): Promise<ScannedLog[]> {
  const key = `splitpay.logs.v2.${address.toLowerCase()}.${event.name}`
  const cached = memory.get(key) ?? load(key)
  const latest = await client.getBlockNumber()
  const start = cached ? (cached.upTo > REORG_OVERLAP ? cached.upTo - REORG_OVERLAP : 0n) : deployBlock
  const from0 = start > deployBlock ? start : deployBlock

  const windows: [bigint, bigint][] = []
  for (let f = from0; f <= latest; f += WINDOW) {
    windows.push([f, f + WINDOW - 1n < latest ? f + WINDOW - 1n : latest])
  }

  const results: ScannedLog[][] = new Array<ScannedLog[]>(windows.length)
  let next = 0
  const worker = async () => {
    while (next < windows.length) {
      const i = next++
      results[i] = await fetchChunk(client, address, event, windows[i][0], windows[i][1])
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, windows.length) }, worker))

  const fresh = results.flat()
  const keep = (cached?.logs ?? []).filter((l) => l.blockNumber < from0)
  const seen = new Set<string>()
  const merged = [...keep, ...fresh]
    .filter((l) => {
      const id = `${l.transactionHash}-${l.logIndex}`
      if (seen.has(id)) return false
      seen.add(id)
      return true
    })
    .sort((a, b) => (a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1))

  const next_: Cache = { upTo: latest, logs: merged }
  memory.set(key, next_)
  save(key, next_)
  return merged
}

/**
 * All logs of one event since `deployBlock`, read in RPC-sized windows. Results are cached
 * (memory and localStorage), so later calls only read the blocks added since the last call.
 */
export function scanEvent(client: PublicClient, address: Address, event: AbiEvent, deployBlock: bigint): Promise<ScannedLog[]> {
  const key = `${address.toLowerCase()}.${event.name}`
  const running = inflight.get(key)
  if (running) return running
  const p = scan(client, address, event, deployBlock).finally(() => inflight.delete(key))
  inflight.set(key, p)
  return p
}
