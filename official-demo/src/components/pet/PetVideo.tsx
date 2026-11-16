import { useEffect, useRef } from 'react'
import { petAssetUrl, type PetActionMode, type PetCharacter } from './petAssets.js'

/** event 动作的近似时长（素材 manifest 约 1.9s），播完回到待机 */
const EVENT_DURATION_MS = 2000

/**
 * 桌宠动画：直接播放透明 animated GIF。
 * GIF 的 <img> 动画不受 iframe 视频自动播放策略/解码限制，最可靠——必定可见且在动。
 * loop 模式 GIF 自身循环；event 模式约 2s 后回调 onEnd 回到待机。
 */
export const PetVideo = ({
  character,
  action,
  mode,
  onEnd,
}: {
  character: PetCharacter
  action: string
  mode: PetActionMode
  onEnd: () => void
}) => {
  const endRef = useRef(onEnd)
  endRef.current = onEnd
  const gifSrc = petAssetUrl(character, action, 'gif')

  useEffect(() => {
    if (mode !== 'event') return
    const timer = setTimeout(() => endRef.current(), EVENT_DURATION_MS)
    return () => clearTimeout(timer)
  }, [mode, gifSrc])

  return <img draggable={false} alt="" src={gifSrc} />
}