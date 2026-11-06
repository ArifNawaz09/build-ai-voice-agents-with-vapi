// lib/store.js  (Chapter 6)
// A tiny JSON file store: one file per collection in data/<name>.json.
// Each file holds an object keyed by record id. Good enough for a
// demo and for low volume; swap for a real database in production.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(here, "..", "data");

function fileFor(name) {
  if (!/^[a-z0-9-]+$/i.test(name)) {
    throw new Error(`Bad collection name: ${name}`);
  }
  return path.join(DATA_DIR, `${name}.json`);
}

function load(name) {
  try {
    return JSON.parse(fs.readFileSync(fileFor(name), "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return {};
    throw err;
  }
}

function save(name, data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const file = fileFor(name);
  // Write to a temp file, then rename: a crash mid-write
  // never leaves a half-written JSON file behind.
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

// All records in a collection, as an array.
export function readAll(name) {
  return Object.values(load(name));
}

// One record, or null.
export function findById(name, id) {
  return load(name)[id] ?? null;
}

// Create or merge a record. Returns the saved record.
export function upsert(name, id, patch) {
  const data = load(name);
  const now = new Date().toISOString();
  const prev = data[id] ?? { id, createdAt: now };
  data[id] = { ...prev, ...patch, id, updatedAt: now };
  save(name, data);
  return data[id];
}
