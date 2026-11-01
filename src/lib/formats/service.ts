import { db } from "../db";
import type { Format } from "../types";
import { LOCAL_USER, now, uid } from "../util";
import { STARTER_FORMATS } from "./starters";

const g = globalThis as any;

async function seed(userId: string) {
  const t = now();
  for (const [i, s] of STARTER_FORMATS.entries()) {
    const { key, ...rest } = s;
    await db().insert("formats", {
      ...rest,
      id: `${userId}-${key}`,
      userId,
      isDefault: i === 1, // Napolitan is the default starter
      isStarter: true,
      createdAt: new Date(Date.parse(t) + i).toISOString(),
      updatedAt: t,
    });
  }
}

export async function listFormats(userId = LOCAL_USER): Promise<Format[]> {
  let rows = await db().list("formats", { where: { userId } });
  if (rows.length === 0 && !g.__cfSeeded?.[userId]) {
    g.__cfSeeded = { ...(g.__cfSeeded || {}), [userId]: true };
    await seed(userId);
    rows = await db().list("formats", { where: { userId } });
  }
  return rows;
}

export async function restoreStarters(userId = LOCAL_USER) {
  const existing = new Set((await listFormats(userId)).map((f) => f.id));
  const t = now();
  for (const { key, ...rest } of STARTER_FORMATS) {
    const id = `${userId}-${key}`;
    if (!existing.has(id))
      await db().insert("formats", { ...rest, id, userId, isDefault: false, isStarter: true, createdAt: t, updatedAt: t });
  }
}

export async function getDefaultFormat(userId = LOCAL_USER) {
  const all = await listFormats(userId);
  return all.find((f) => f.isDefault) || all[0] || null;
}

export async function createFormat(input: Partial<Format>, userId = LOCAL_USER) {
  const t = now();
  const base = STARTER_FORMATS[1];
  const f: Format = {
    name: "My Format",
    emoji: "✨",
    description: "",
    hookStyle: base.hookStyle,
    structure: base.structure,
    visualStyle: base.visualStyle,
    voiceStyle: base.voiceStyle,
    captionStyle: "bold-yellow",
    musicStyle: "dark-drone",
    lengthSec: 45,
    ...sanitize(input),
    id: uid(),
    userId,
    isDefault: false,
    isStarter: false,
    createdAt: t,
    updatedAt: t,
  };
  return db().insert("formats", f);
}

export async function updateFormat(id: string, patch: Partial<Format>, userId = LOCAL_USER) {
  if (patch.isDefault) {
    for (const f of await listFormats(userId))
      if (f.isDefault && f.id !== id) await db().update("formats", f.id, { isDefault: false });
  }
  return db().update("formats", id, { ...sanitize(patch), ...(patch.isDefault ? { isDefault: true } : {}) });
}

export async function duplicateFormat(id: string, userId = LOCAL_USER) {
  const f = await db().get("formats", id);
  if (!f) throw new Error("Format not found");
  const { id: _i, createdAt, updatedAt, isDefault, isStarter, ...rest } = f;
  return createFormat({ ...rest, name: `${f.name} (copy)` }, userId);
}

export async function deleteFormat(id: string, userId = LOCAL_USER) {
  const f = await db().get("formats", id);
  if (!f) return;
  await db().remove("formats", id);
  if (f.isDefault) {
    const next = (await listFormats(userId))[0];
    if (next) await db().update("formats", next.id, { isDefault: true });
  }
}

const EDITABLE: (keyof Format)[] = [
  "name", "emoji", "description", "hookStyle", "structure", "visualStyle",
  "voiceStyle", "captionStyle", "musicStyle", "lengthSec",
];
function sanitize(p: Partial<Format>) {
  const out: any = {};
  for (const k of EDITABLE) if (p[k] !== undefined) out[k] = p[k];
  if (out.lengthSec !== undefined) out.lengthSec = Math.min(90, Math.max(15, Number(out.lengthSec) || 45));
  if (typeof out.name === "string") out.name = out.name.slice(0, 60) || "Untitled";
  return out;
}
