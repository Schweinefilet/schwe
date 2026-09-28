import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Text } from '@react-three/drei'
import { WORD } from '../config.js'
import { rig } from '../core/rig.js'

// Beat 6 placeholder: flat text that fades in at the alignment viewpoint.
export default function AlignmentWord() {
  const ref = useRef()

  useFrame(() => {
    const t = ref.current
    if (!t) return
    t.visible = rig.word > 0.001
    t.fillOpacity = rig.word
  })

  return (
    <Text ref={ref} position={WORD.pos} fontSize={WORD.fontSize} anchorX="center" anchorY="middle" color="#ffffff">
      {WORD.text}
    </Text>
  )
}
