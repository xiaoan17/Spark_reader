import { convertFileSrc } from "@tauri-apps/api/core"
import { isTauriRuntime } from "@/core/library-api"

export function markdownImageSrc(src?: string | null) {
  if (!src) {
    return ""
  }
  const trimmed = src.trim()
  if (!trimmed) {
    return ""
  }
  if (!isTauriRuntime()) {
    return src
  }
  const localPath = localImagePathFromSrc(trimmed)
  return localPath ? convertFileSrc(localPath) : src
}

export function localImagePathFromSrc(src: string) {
  if (src.startsWith("file://")) {
    return fileUrlToPath(src)
  }
  if (isAbsoluteLocalPath(src)) {
    return src
  }
  return ""
}

function fileUrlToPath(src: string) {
  try {
    return decodeURIComponent(new URL(src).pathname)
  } catch {
    return src.replace(/^file:\/\//, "")
  }
}

function isAbsoluteLocalPath(src: string) {
  if (src.startsWith("/")) {
    return true
  }
  return /^[A-Za-z]:[\\/]/.test(src)
}
