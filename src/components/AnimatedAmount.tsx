import { useEffect, useRef, useState } from 'react'
import { animate, useReducedMotion } from 'framer-motion'
import { USDC_DECIMALS } from '@/onchain-facts'
import { formatUnitsFixed } from '@/onchain-money'

/** Rolls a USDC amount (6-decimal base units) toward its new value. Falls back to a plain value with reduced motion. */
export function AnimatedAmount({ raw }: { raw: bigint }) {
  const reduce = useReducedMotion()
  const [shown, setShown] = useState(Number(raw))
  const last = useRef(Number(raw))

  useEffect(() => {
    const target = Number(raw)
    if (reduce) {
      last.current = target
      return
    }
    const controls = animate(last.current, target, {
      duration: 0.7,
      ease: 'easeOut',
      onUpdate: (v) => {
        last.current = v
        setShown(v)
      },
    })
    return () => controls.stop()
  }, [raw, reduce])

  const value = reduce ? raw : BigInt(Math.round(shown))
  const [whole, frac] = formatUnitsFixed(value, USDC_DECIMALS, 2).split('.')
  return (
    <span className="tnum">
      {whole}
      <span className="text-[0.55em] opacity-60">.{frac}</span>
    </span>
  )
}
