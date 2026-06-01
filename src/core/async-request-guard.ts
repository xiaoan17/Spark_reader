export function createRequestGuard(initialVersion = 0) {
  let version = initialVersion

  return {
    start() {
      version += 1
      return version
    },
    stop() {
      version += 1
      return version
    },
    isCurrent(candidate: number) {
      return candidate === version
    },
    current() {
      return version
    },
  }
}
