"use client";

import { useSyncExternalStore } from "react";
import type { ManualChanges } from "@/lib/storage";
import type { Expense } from "@/lib/types";

/**
 * A small write-ahead copy of manual edits, kept in localStorage until
 * IndexedDB confirms them.
 *
 * Review writes each change here before saving it, and removes it once the
 * save succeeds. If the save fails, or the page is left or closed before it
 * finishes, the change survives here: Review offers to save or discard it,
 * and the Inbox and export treat that expense as not ready, so it is never
 * exported with the older stored values.
 *
 * Only this device and browser see it. If localStorage is unavailable the
 * app still works; it just loses this extra safety net.
 */

const KEY = "notsplitwise:unsaved-edits:v1";
const CHANGE_EVENT = "notsplitwise:unsaved-edits";

export type UnsavedEdits = Record<string, ManualChanges>;

const empty: UnsavedEdits = {};
let cachedRaw: string | null = null;
let cachedValue: UnsavedEdits = empty;

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function readUnsavedEdits(): UnsavedEdits {
  let raw: string | null = null;

  try {
    raw = storage()?.getItem(KEY) ?? null;
  } catch {
    raw = null;
  }

  if (raw === cachedRaw) {
    return cachedValue;
  }

  cachedRaw = raw;

  try {
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    cachedValue =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as UnsavedEdits)
        : empty;
  } catch {
    cachedValue = empty;
  }

  return cachedValue;
}

function write(next: UnsavedEdits): void {
  try {
    const store = storage();

    if (!store) return;

    if (Object.keys(next).length === 0) {
      store.removeItem(KEY);
    } else {
      store.setItem(KEY, JSON.stringify(next));
    }

    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    // Storage full or blocked: the IndexedDB save is still attempted.
  }
}

const amountFields: Array<keyof ManualChanges> = ["amount", "amountInput"];

/**
 * The fields an edit replaces. The amount and its unfinished text are one
 * field to the person: a new amount replaces older unfinished text and the
 * other way round, so an older one can never come back over a newer one.
 */
export function supersededFields(changes: ManualChanges): Array<keyof ManualChanges> {
  const keys = Object.keys(changes) as Array<keyof ManualChanges>;

  return keys.some((key) => amountFields.includes(key))
    ? [...new Set([...keys, ...amountFields])]
    : keys;
}

/** Records changes before they are saved. Newer values replace older ones. */
export function rememberUnsavedEdit(id: string, changes: ManualChanges): void {
  if (Object.keys(changes).length === 0) return;

  const all = readUnsavedEdits();
  const entry: ManualChanges = { ...all[id] };

  for (const key of supersededFields(changes)) delete entry[key];

  write({ ...all, [id]: { ...entry, ...changes } });
}

/**
 * Removes the given changes once saved. A key is only removed if it still
 * holds the saved value, so a newer edit that is still in flight stays.
 */
export function forgetUnsavedEdit(id: string, saved: ManualChanges): void {
  const all = readUnsavedEdits();
  const current = all[id];

  if (!current) return;

  const rest: ManualChanges = { ...current };

  for (const key of Object.keys(saved) as Array<keyof ManualChanges>) {
    if (sameValue(rest[key], saved[key])) delete rest[key];
  }

  const next = { ...all };

  if (Object.keys(rest).length === 0) {
    delete next[id];
  } else {
    next[id] = rest;
  }

  write(next);
}

/** Drops every remembered change for an expense (discarded or deleted). */
export function discardUnsavedEdit(id: string): void {
  const all = readUnsavedEdits();

  if (!all[id]) return;

  const next = { ...all };
  delete next[id];
  write(next);
}

/**
 * The remembered changes that the stored expense doesn't already contain.
 * Empty when everything did get saved (for example the page closed right
 * after the write finished).
 */
export function unsavedDifferences(
  expense: Expense,
  edits: ManualChanges | undefined,
): ManualChanges {
  const differences: ManualChanges = {};

  if (!edits) return differences;

  for (const key of Object.keys(edits) as Array<keyof ManualChanges>) {
    if (!sameValue(expense[key], edits[key])) {
      Object.assign(differences, { [key]: edits[key] });
    }
  }

  return differences;
}

export function hasUnsavedDifferences(
  expense: Expense,
  edits: ManualChanges | undefined,
): boolean {
  return Object.keys(unsavedDifferences(expense, edits)).length > 0;
}

function subscribe(callback: () => void): () => void {
  window.addEventListener("storage", callback);
  window.addEventListener(CHANGE_EVENT, callback);

  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(CHANGE_EVENT, callback);
  };
}

/** Live view of remembered changes, updated across tabs. */
export function useUnsavedEdits(): UnsavedEdits {
  return useSyncExternalStore(subscribe, readUnsavedEdits, () => empty);
}
