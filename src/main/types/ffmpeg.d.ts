declare module 'ffmpeg-static' {
  const path: string
  export default path
}

declare module 'ffprobe-static' {
  const info: { path: string }
  export default info
}
