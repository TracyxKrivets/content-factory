// ---------------------------------------------------------------- start
/** Delete stored files no video points to anymore (left over from redos). */
async function cleanupFiles() {
  const used = new Set((await db.all("videos")).flatMap(videoBlobKeys));
  const all = await tx("blobs", "readonly", (o) => req(o.getAllKeys()));
  for (const k of all) if (!used.has(k)) await tx("blobs", "readwrite", (o) => req(o.delete(k)));
}
(async () => {
  await idb(); // falls back to memory if storage is blocked
  const root = document.getElementById("app");
  root.textContent = ""; // remove the "Loading…" placeholder
  render(html`<${App} />`, root);
  navigator.storage?.persist?.().catch(() => {});
  await resumeAll();
  if (!running.size && !queue.length) cleanupFiles().catch(() => {});
  window.__cf = { db, kv, blobs, keys, running, queue }; // for debugging from the console
})();
