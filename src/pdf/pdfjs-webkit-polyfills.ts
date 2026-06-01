type ReadableStreamIterator<T> = AsyncIterator<T, undefined> & AsyncIterable<T>

type ReadableStreamWithValues<T> = ReadableStream<T> & {
  values?: (options?: ReadableStreamIteratorOptions) => ReadableStreamIterator<T>
  [Symbol.asyncIterator]?: () => ReadableStreamIterator<T>
}

function readableStreamValues<T>(
  this: ReadableStream<T>,
  options?: ReadableStreamIteratorOptions,
): ReadableStreamIterator<T> {
  const reader = this.getReader()
  let closed = false

  const iterator: ReadableStreamIterator<T> = {
    async next(): Promise<IteratorResult<T, undefined>> {
      if (closed) {
        return { done: true, value: undefined }
      }
      const result = await reader.read()
      if (result.done) {
        closed = true
        reader.releaseLock()
        return { done: true, value: undefined }
      }
      return { done: false, value: result.value }
    },
    async return(): Promise<IteratorResult<T, undefined>> {
      if (!closed) {
        closed = true
        try {
          if (!options?.preventCancel) {
            await reader.cancel()
          }
        } finally {
          reader.releaseLock()
        }
      }
      return { done: true, value: undefined }
    },
    [Symbol.asyncIterator]() {
      return iterator
    },
  }

  return iterator
}

const readableStreamPrototype = globalThis.ReadableStream?.prototype as
  | ReadableStreamWithValues<unknown>
  | undefined

if (readableStreamPrototype) {
  if (typeof readableStreamPrototype.values !== "function") {
    Object.defineProperty(readableStreamPrototype, "values", {
      configurable: true,
      writable: true,
      value: readableStreamValues,
    })
  }

  if (typeof readableStreamPrototype[Symbol.asyncIterator] !== "function") {
    Object.defineProperty(readableStreamPrototype, Symbol.asyncIterator, {
      configurable: true,
      writable: true,
      value: readableStreamPrototype.values,
    })
  }
}

export {}
