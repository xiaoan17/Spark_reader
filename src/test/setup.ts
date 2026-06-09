function installStorage(name: "localStorage" | "sessionStorage") {
  if (typeof window === "undefined") {
    return
  }
  const existing = Object.getOwnPropertyDescriptor(window, name)
  if (
    existing &&
    "value" in existing &&
    existing.value &&
    typeof (existing.value as Storage).clear === "function"
  ) {
    return
  }
  if (existing && existing.configurable === false) {
    return
  }

  const store = new Map<string, string>()
  const storage: Storage = {
    get length() {
      return store.size
    },
    clear() {
      store.clear()
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null
    },
    removeItem(key: string) {
      store.delete(key)
    },
    setItem(key: string, value: string) {
      store.set(key, String(value))
    },
  }

  Object.defineProperty(window, name, {
    configurable: true,
    value: storage,
  })
}

installStorage("localStorage")
installStorage("sessionStorage")
