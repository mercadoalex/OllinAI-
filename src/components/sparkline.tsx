"use client"

import { useMemo } from "react"

interface SparklineProps {
  data: number[]
  color?: string
  width?: number
  height?: number
  className?: string
}

export function Sparkline({ 
  data, 
  color = "currentColor", 
  width = 100, 
  height = 32,
  className 
}: SparklineProps) {
  const path = useMemo(() => {
    if (data.length === 0) return ""
    
    const min = Math.min(...data)
    const max = Math.max(...data)
    const range = max - min || 1
    
    const points = data.map((value, index) => {
      const x = (index / (data.length - 1)) * width
      const y = height - ((value - min) / range) * (height - 4) - 2
      return `${x},${y}`
    })
    
    return `M ${points.join(" L ")}`
  }, [data, width, height])

  if (data.length === 0) {
    return (
      <div className={className} style={{ width, height }}>
        <svg width={width} height={height}>
          <line
            x1={0}
            y1={height / 2}
            x2={width}
            y2={height / 2}
            stroke={color}
            strokeWidth={1.5}
            strokeDasharray="4 2"
            opacity={0.3}
          />
        </svg>
      </div>
    )
  }

  return (
    <div className={className} style={{ width, height }}>
      <svg width={width} height={height}>
        <path
          d={path}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  )
}

// Generate deterministic sparkline data using a seed for consistent SSR/client rendering
export function generateSparklineData(points: number = 30, trend: "up" | "down" | "stable" = "stable", seed: number = 42): number[] {
  const data: number[] = []
  let value = 50
  
  // Simple seeded pseudo-random number generator (mulberry32)
  let state = seed
  const seededRandom = () => {
    state |= 0
    state = state + 0x6D2B79F5 | 0
    let t = Math.imul(state ^ state >>> 15, 1 | state)
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
    return ((t ^ t >>> 14) >>> 0) / 4294967296
  }
  
  for (let i = 0; i < points; i++) {
    // Add deterministic noise
    const noise = (seededRandom() - 0.5) * 10
    
    // Apply trend
    if (trend === "up") {
      value += seededRandom() * 2
    } else if (trend === "down") {
      value -= seededRandom() * 2
    }
    
    data.push(Math.max(0, value + noise))
  }
  
  return data
}
