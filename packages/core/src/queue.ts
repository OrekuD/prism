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

/**
 * One immutable queue entry (task-10): either an event or an identify
 * operation. Events and identify ops share the FIFO so ordering is
 * deterministic; both kinds serialize at enqueue time (immutable
 * identity context) and both are persisted in the same snapshot.
 */
export interface QueuedEvent {
  /** Persistence-segment owner (execution-context identity). */
  readonly owner: string;
  /** "event" | "identify" */
  readonly kind: "event" | "identify";
  /** eventId for events, opId for identify operations. */
  readonly eventId: string;
  /** Event name (events only). */
  readonly name?: string;
  readonly properties?: JsonObject;
  /** Epoch milliseconds (runtime.now() at enqueue time). */
  readonly timestamp: number;
  /** Active session ID at track time, when one exists (events only). */
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
  /** Recently removed event IDs (persistence tombstones — bounded). */
  private readonly removedIds: string[] = [];
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
   * Peek the next EVENT batch without removing it. Identify operations
   * are excluded (they ride alongside in the same request); the head
   * event is ALWAYS included — an event larger than maxBytes delivers
   * alone rather than wedging the queue forever.
   */
  peekBatch(maxEvents: number, maxBytes: number): QueuedEvent[] {
    const batch: QueuedEvent[] = [];
    let bytes = 0;
    for (const entry of this.items) {
      if (entry.kind !== "event") continue;
      if (batch.length >= maxEvents) break;
      const encoded = utf8Length(entry.serialized);
      if (batch.length > 0 && bytes + encoded > maxBytes) break;
      batch.push(entry);
      bytes += encoded;
    }
    return batch;
  }

  /** Pending identify operations in FIFO order (delivered with the next batch). */
  pendingOps(): QueuedEvent[] {
    return this.items.filter((entry) => entry.kind === "identify");
  }

  /** Remove delivered identify operations (atomic with the batch success). */
  removeOps(ids: string[]): void {
    const idSet = new Set(ids);
    const kept: QueuedEvent[] = [];
    for (const entry of this.items) {
      if (entry.kind === "identify" && idSet.has(entry.eventId)) {
        this.removedIds.push(entry.eventId);
      } else {
        kept.push(entry);
      }
    }
    this.items.length = 0;
    this.items.push(...kept);
    this.trimRemovedIds();
  }

  /** Remove every pending identify operation (reset). */
  removeAllOps(): void {
    const kept: QueuedEvent[] = [];
    for (const entry of this.items) {
      if (entry.kind === "identify") {
        this.removedIds.push(entry.eventId);
      } else {
        kept.push(entry);
      }
    }
    this.items.length = 0;
    this.items.push(...kept);
    this.trimRemovedIds();
  }

  /**
   * Remove the delivered BATCH entries by ID (after a batch was
   * delivered). Identify ops can sit ahead of the event batch in the
   * FIFO, so head-count removal is wrong — removal is id-based. The
   * removed IDs become persistence tombstones so a shared-storage merge
   * never resurrects a delivered event from another context's stale
   * segment.
   */
  removeBatch(ids: string[]): void {
    const idSet = new Set(ids);
    const kept: QueuedEvent[] = [];
    for (const entry of this.items) {
      if (idSet.has(entry.eventId)) {
        this.removedIds.push(entry.eventId);
      } else {
        kept.push(entry);
      }
    }
    this.items.length = 0;
    this.items.push(...kept);
    this.trimRemovedIds();
  }

  /**
   * Re-insert events at the head — strict per-event reconciliation puts
   * non-terminal batch members back after the whole batch was removed.
   */
  requeueAtHead(events: QueuedEvent[]): void {
    this.items.unshift(...events);
  }

  clear(): void {
    for (const event of this.items) {
      this.removedIds.push(event.eventId);
    }
    this.items.length = 0;
    this.trimRemovedIds();
  }

  /** Tombstoned IDs (delivered or consent-purged) — shared-storage merge filters them. */
  recentlyRemovedIds(): Set<string> {
    return new Set(this.removedIds);
  }

  /**
   * Mark IDs as tombstoned WITHOUT removing them from the queue — used
   * when a context ADOPTS restored events: the stale copy in the other
   * context's segment must not survive alongside the adopted one.
   */
  tombstoneIds(ids: string[]): void {
    for (const id of ids) {
      this.removedIds.push(id);
    }
    this.trimRemovedIds();
  }

  private trimRemovedIds(): void {
    const MAX_TOMBSTONES = 2_000;
    while (this.removedIds.length > MAX_TOMBSTONES) {
      this.removedIds.shift();
    }
  }

  /** Read-only copy of the queued events (for persistence snapshots). */
  snapshot(): readonly QueuedEvent[] {
    return [...this.items];
  }
}
