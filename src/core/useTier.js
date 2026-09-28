import { useEffect, useState } from 'react'
import { onTierChange, quality } from './quality.js'

// Re-renders the component when the quality tier drops at runtime.
export function useTier() {
  const [name, setName] = useState(quality.name)
  useEffect(() => onTierChange(setName), [])
  return name
}
