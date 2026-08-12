import type { JsonObject } from "./contract";

/**
 * The immutable FIFO event queue (ADR 0002 §4). Events are accepted once,
 * never mutated, and accounted by count AND encoded UTF-8 bytes so the
 * configured queue limits are enforceable in explicit units.
 */

/** UTF-8 encoded byte length of a string (no platform globals). */
export function utf8Length(value: string): number {
  let bytes = 0;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

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
  /** Max serialized bytes for a SINGLE event (the queue cannot accept more). */
  readonly maxEventBytes?: number;
}

export class EventQueue {
  private readonly items: QueuedEvent[] = [];
  private readonly maxEvents: number;
  private readonly maxBytes: number;

  private readonly maxEventBytes: number;

  constructor(options: EventQueueOptions) {
    this.maxEvents = options.maxEvents;
    this.maxBytes = options.maxBytes;
    this.maxEventBytes = options.maxEventBytes ?? Number.POSITIVE_INFINITY;
  }

  /** Number of queued events. */
  get size(): number {
    return this.items.length;
  }

  /** Total encoded bytes of queued events. */
  get bytes(): number {
    return this.items.reduce((sum, event) => sum + utf8Length(event.serialized), 0);
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
    if (utf8Length(event.serialized) > this.maxEventBytes) return false;
    if (this.bytes + utf8Length(event.serialized) > this.maxBytes) return false;
    this.items.push(event);
    return true;
  }

  /**
   * Peek the next batch without removing it. The head event is ALWAYS
   * included — an event larger than maxBytes delivers alone rather than
   * wedging the queue forever.
   */
  peekBatch(maxEvents: number, maxBytes: number): QueuedEvent[] {
    const batch: QueuedEvent[] = [];
    let bytes = 0;
    for (const event of this.items) {
      if (batch.length >= maxEvents) break;
      const encoded = utf8Length(event.serialized);
      if (batch.length > 0 && bytes + encoded > maxBytes) break;
      batch.push(event);
      bytes += encoded;
    }
    return batch;
  }

  /** Remove `count` events from the head (after a batch was delivered). */
  removeFirst(count: number): void {
    this.items.splice(0, count);
  }

  /**
   * Re-insert events at the head — strict per-event reconciliation puts
   * non-terminal batch members back after the whole batch was removed.
   */
  requeueAtHead(events: QueuedEvent[]): void {
    this.items.unshift(...events);
  }

  clear(): void {
    this.items.length = 0;
  }

  /** Read-only copy of the queued events (for persistence snapshots). */
  snapshot(): readonly QueuedEvent[] {
    return [...this.items];
  }
}
