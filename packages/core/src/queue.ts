import type { JsonObject } from "./contract";

/**
 * The immutable FIFO event queue (ADR 0002 §4). Events are accepted once,
 * never mutated, and accounted by count AND serialized bytes so the
 * configured queue limits are enforceable in explicit units.
 */

export interface QueuedEvent {
  readonly eventId: string;
  readonly name: string;
  readonly properties?: JsonObject;
  /** Epoch milliseconds (runtime.now() at track time). */
  readonly timestamp: number;
  /** Active session ID at track time, when one exists. */
  readonly sessionId?: string;
  /** Pre-serialized body for byte accounting and delivery. */
  readonly serialized: string;
}

export interface EventQueueOptions {
  readonly maxEvents: number;
  readonly maxBytes: number;
}

export class EventQueue {
  private readonly items: QueuedEvent[] = [];
  private readonly maxEvents: number;
  private readonly maxBytes: number;

  constructor(options: EventQueueOptions) {
    this.maxEvents = options.maxEvents;
    this.maxBytes = options.maxBytes;
  }

  /** Number of queued events. */
  get size(): number {
    return this.items.length;
  }

  /** Total serialized bytes of queued events. */
  get bytes(): number {
    return this.items.reduce((sum, event) => sum + event.serialized.length, 0);
  }

  get isEmpty(): boolean {
    return this.items.length === 0;
  }

  /**
   * Append an event. Returns false (and does NOT enqueue) when the event
   * would exceed either configured limit — the caller reports
   * `queue-full`.
   */
  enqueue(event: QueuedEvent): boolean {
    if (this.items.length + 1 > this.maxEvents) return false;
    if (this.bytes + event.serialized.length > this.maxBytes) return false;
    this.items.push(event);
    return true;
  }

  /** Peek the next batch without removing it. */
  peekBatch(maxEvents: number, maxBytes: number): QueuedEvent[] {
    const batch: QueuedEvent[] = [];
    let bytes = 0;
    for (const event of this.items) {
      if (batch.length >= maxEvents) break;
      if (bytes + event.serialized.length > maxBytes) break;
      batch.push(event);
      bytes += event.serialized.length;
    }
    return batch;
  }

  /** Remove `count` events from the head (after a batch was delivered). */
  removeFirst(count: number): void {
    this.items.splice(0, count);
  }

  clear(): void {
    this.items.length = 0;
  }
}
