import { EventEmitter } from "node:events";

export type HiveEvent = {
  id: string;
  type: string;
  runId: string;
  occurredAt: string;
  data: Record<string, unknown>;
};

export class EventBus {
  private readonly emitter = new EventEmitter();

  publish(event: HiveEvent) { this.emitter.emit(event.runId, event); }
  subscribe(runId: string, listener: (event: HiveEvent) => void) {
    this.emitter.on(runId, listener);
    return () => this.emitter.off(runId, listener);
  }
}
