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
  window.__cfGo = go; // lets the "Change the app" chat open pages
  window.__cfShell?.ready(); // tells the loader this version started fine
  navigator.storage?.persist?.().catch(() => {});
  await Sync.connect(); // live sync with your other devices (if set up)
  await resumeAll();
  if (!running.size && !queue.length) cleanupFiles().catch(() => {});
  window.__cf = { db, kv, blobs, keys, running, queue, Sync, live, editScript, update, saveSetting, budget, now }; // for debugging from the console
})();
