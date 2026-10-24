// Placeholder: replaced by the owning slice (see ./index.ts).
import type { JobContext, OrderJob } from "./types.ts";

export function handle(_ctx: JobContext, job: OrderJob): Promise<void> {
  return Promise.reject(new Error(`job handler not implemented: ${job.kind}`));
}
