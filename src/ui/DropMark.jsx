import { useId } from 'react'

// The site's mark: the favicon's drop (public/favicon.svg), a frozen raindrop as a ball lens. Dark water,
// the street's warm glow seen upside down at its top, a cool rim, one specular point. Set above the name
// on the loader.
export default function DropMark({ className = 'drop-mark' }) {
  const id = useId()
  return (
    <svg className={className} viewBox="4 4 56 56" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id={`${id}b`} cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#0b0f14" />
          <stop offset="0.78" stopColor="#121820" />
          <stop offset="0.93" stopColor="#8fa3b8" />
          <stop offset="1" stopColor="#d7e2ee" />
        </radialGradient>
        <radialGradient id={`${id}g`} cx="50%" cy="28%" r="42%">
          <stop offset="0" stopColor="#ffb877" stopOpacity="0.9" />
          <stop offset="0.6" stopColor="#ff9a55" stopOpacity="0.25" />
          <stop offset="1" stopColor="#ff9a55" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="32" cy="32" r="26" fill={`url(#${id}b)`} />
      <circle cx="32" cy="32" r="24" fill={`url(#${id}g)`} />
      <circle cx="23" cy="42" r="3.2" fill="#fff" fillOpacity="0.85" />
    </svg>
  )
}
