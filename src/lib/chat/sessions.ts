/**
 * METATRON V11 — Chat session storage (localStorage).
 * Local-first, no Supabase. Survives reload, scoped per browser.
 *
 * Persisted here: the session list (with per-session unsent draft) and which
 * session was last active, so a reload restores the exact chat you were in —
 * including text typed but never sent.
 */
import { readJSON, writeJSON } from "@/lib/persist/flush";
import type { ChatMessage, ChatSession } from "./types";

const KEY = "metatron-v11-chat-sessions";
const ACTIVE_KEY = "metatron-v11-chat-active";

export function loadSessions(): ChatSession[] {
  const list = readJSON<ChatSession[]>(KEY, []);
  return Array.isArray(list) ? list : [];
}

export function saveSessions(sessions: ChatSession[]) {
  writeJSON(KEY, sessions);
}

export function loadActiveId(): string | null {
  if (typeof localStorage === "undefined") return null;
  try { return localStorage.getItem(ACTIVE_KEY); } catch { return null; }
}

export function saveActiveId(id: string) {
  if (typeof localStorage === "undefined") return;
  try { localStorage.setItem(ACTIVE_KEY, id); } catch { /* quota */ }
}

export function newSession(): ChatSession {
  const t = Date.now();
  return { id: `s_${t}_${Math.random().toString(36).slice(2, 8)}`, title: "New chat", createdAt: t, updatedAt: t, messages: [], draft: "" };
}

export function newMessage(role: ChatMessage["role"], content: string, model?: string): ChatMessage {
  return { id: `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, role, content, createdAt: Date.now(), model };
}
