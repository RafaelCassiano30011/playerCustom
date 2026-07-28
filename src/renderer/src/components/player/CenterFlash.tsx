import { useEffect, useState } from 'react'

interface FlashEvent {
  message: string
  token: number
}

let listener: ((event: FlashEvent) => void) | null = null
let token = 0

/** API imperativa simples: qualquer lugar pode chamar `flashCenter("...")`. */
export function flashCenter(message: string): void {
  token += 1
  listener?.({ message, token })
}

export function CenterFlash(): JSX.Element | null {
  const [event, setEvent] = useState<FlashEvent | null>(null)

  useEffect(() => {
    listener = setEvent
    return () => {
      listener = null
    }
  }, [])

  useEffect(() => {
    if (!event) return
    const timer = setTimeout(() => setEvent(null), 650)
    return () => clearTimeout(timer)
  }, [event])

  if (!event) return null
  return (
    <div className="center-flash" key={event.token}>
      {event.message}
    </div>
  )
}
