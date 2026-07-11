import { parseNeoFinderExport } from './parse'
import type { ParseResult } from '../types'

export interface WorkerRequest {
  id: number
  buffer: ArrayBuffer
  fileName: string
}

export type WorkerResponse =
  | { id: number; type: 'progress'; done: number; total: number }
  | { id: number; type: 'done'; result: ParseResult }
  | { id: number; type: 'error'; message: string }

const post = (msg: WorkerResponse) =>
  (self as unknown as { postMessage(v: unknown): void }).postMessage(msg)

self.onmessage = (e: MessageEvent) => {
  const { id, buffer, fileName } = e.data as WorkerRequest
  try {
    let lastSent = 0
    const result = parseNeoFinderExport(buffer, fileName, (done, total) => {
      const now = Date.now()
      if (now - lastSent > 100) {
        lastSent = now
        post({ id, type: 'progress', done, total })
      }
    })
    post({ id, type: 'done', result })
  } catch (err) {
    post({ id, type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
