import { useSyncExternalStore } from 'react'

export type Theme = 'light' | 'dark'

const KEY = 'splitpay.theme.v1'
const listeners = new Set<() => void>()

function initial(): Theme {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    /* storage unavailable: fall through to the system preference */
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

let current: Theme = initial()

function apply(theme: Theme) {
  document.documentElement.dataset.theme = theme
}
// Set before the first paint so there is no flash of the wrong theme.
apply(current)

export function setTheme(theme: Theme) {
  current = theme
  apply(theme)
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    /* the choice just will not persist */
  }
  listeners.forEach((l) => l())
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const theme = useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => current,
  )
  return [theme, setTheme]
}
