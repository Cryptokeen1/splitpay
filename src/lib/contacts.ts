import { useCallback, useEffect, useState } from 'react'
import { useAccount } from 'wagmi'
import { shortAddr } from '@/splitpay'

const KEY = 'splitpay.contacts.v1'
const EVENT = 'splitpay:contacts'

type Book = Record<string, string>

function read(): Book {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Book) : {}
  } catch {
    return {}
  }
}

/** Device-local nicknames for addresses, so people see "Studio" instead of 0x12ab...90ef. */
export function useContacts() {
  const { address } = useAccount()
  const [book, setBook] = useState<Book>(read)

  useEffect(() => {
    const sync = () => setBook(read())
    window.addEventListener(EVENT, sync)
    return () => window.removeEventListener(EVENT, sync)
  }, [])

  const save = useCallback((entries: Record<string, string>) => {
    const next = { ...read() }
    for (const [addr, name] of Object.entries(entries)) {
      const key = addr.toLowerCase()
      const clean = name.trim().slice(0, 24)
      if (clean) next[key] = clean
      else delete next[key]
    }
    try {
      localStorage.setItem(KEY, JSON.stringify(next))
    } catch {
      return
    }
    window.dispatchEvent(new Event(EVENT))
  }, [])

  const label = useCallback(
    (addr: string): string => {
      if (address && addr.toLowerCase() === address.toLowerCase()) return 'You'
      return book[addr.toLowerCase()] ?? shortAddr(addr)
    },
    [book, address],
  )

  const nickname = useCallback((addr: string): string => book[addr.toLowerCase()] ?? '', [book])

  return { label, nickname, save }
}
