import { lazy, Suspense, useEffect, useState, type ComponentPropsWithoutRef } from "react"
import type { CalligraphProps } from "calligraph"
import { cn } from "@/lib/utils"

const LazyCalligraph = lazy(async () => {
  const module = await import("calligraph")
  return { default: module.Calligraph }
})

type AnimatedValueVariant = NonNullable<CalligraphProps["variant"]>
type AnimatedValueAnimation = NonNullable<CalligraphProps["animation"]>

type AnimatedValueProps = Omit<ComponentPropsWithoutRef<"span">, "children"> & {
  value: string | number
  variant?: AnimatedValueVariant
  animation?: AnimatedValueAnimation
  maxLength?: number
}

export function AnimatedValue({
  value,
  variant = "text",
  animation,
  maxLength = 40,
  className,
  ...props
}: AnimatedValueProps) {
  const text = String(value)
  const reduceMotion = usePrefersReducedMotion()
  const shouldAnimate = !reduceMotion && text.length > 0 && text.length <= maxLength

  if (!shouldAnimate) {
    return <PlainValue value={text} className={className} props={props} />
  }

  return (
    <Suspense fallback={<PlainValue value={text} className={className} props={props} />}>
      <LazyCalligraph
        as="span"
        autoSize={false}
        variant={variant}
        animation={animation}
        stagger={variant === "text" ? 0.012 : 0.018}
        drift={{ x: 8, y: 0 }}
        className={cn("inline-flex tabular-nums", className)}
        {...props}
      >
        {value}
      </LazyCalligraph>
    </Suspense>
  )
}

function PlainValue({
  value,
  className,
  props,
}: {
  value: string
  className?: string
  props: Omit<ComponentPropsWithoutRef<"span">, "children" | "className">
}) {
  return (
    <span className={className} {...props}>
      {value}
    </span>
  )
}

function usePrefersReducedMotion() {
  const [reduceMotion, setReduceMotion] = useState(() => prefersReducedMotion())

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return
    }
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)")
    const handleChange = () => setReduceMotion(mediaQuery.matches)
    handleChange()
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handleChange)
      return () => mediaQuery.removeEventListener("change", handleChange)
    }
    mediaQuery.addListener(handleChange)
    return () => mediaQuery.removeListener(handleChange)
  }, [])

  return reduceMotion
}

function prefersReducedMotion() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return true
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
}
