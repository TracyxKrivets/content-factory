export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.EMBEDDED_WORKER !== "false") {
    const { startWorker } = await import("./lib/jobs/worker");
    startWorker();
  }
}
