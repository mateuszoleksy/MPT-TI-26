import cron, { type ScheduledTask, type TaskOptions } from 'node-cron';

export interface ScheduledJob {
  task: ScheduledTask;
  stop(): Promise<void>;
}

export function scheduleJob(
  expression: string,
  job: () => Promise<unknown>,
  options?: TaskOptions,
): ScheduledJob {
  let active: Promise<unknown> | undefined;
  const task = cron.schedule(
    expression,
    async () => {
      active = job();
      try {
        return await active;
      } finally {
        active = undefined;
      }
    },
    options,
  );
  return {
    task,
    async stop() {
      await task.stop();
      // Failures are already reported by the run itself.
      await active?.catch(() => {});
      await task.destroy();
    },
  };
}
