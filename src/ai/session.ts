import { v4 as uuidv4 } from 'uuid';

type SessionData = {
  id: string;
  messages: Array<{ role: 'user' | 'bot' | 'system'; text: string; ts: string }>;
  createdAt: number;
  expiresAt: number;
};

const SESSIONS = new Map<string, SessionData>();
const DEFAULT_TTL_MS = Number(process.env.SESSION_TTL_MS ?? 30 * 60 * 1000); // 30 min

export function createSession(): SessionData {
  const id = uuidv4();
  const now = Date.now();
  const s: SessionData = { id, messages: [], createdAt: now, expiresAt: now + DEFAULT_TTL_MS };
  SESSIONS.set(id, s);
  return s;
}

export function getSession(id?: string): SessionData | null {
  if (!id) return null;
  const s = SESSIONS.get(id);
  if (!s) return null;
  if (Date.now() > s.expiresAt) {
    SESSIONS.delete(id);
    return null;
  }
  // extend expiry on access
  s.expiresAt = Date.now() + DEFAULT_TTL_MS;
  return s;
}

export function appendMessage(sessionId: string, role: SessionData['messages'][0]['role'], text: string) {
  const s = getSession(sessionId);
  if (!s) return null;
  s.messages.push({ role, text, ts: new Date().toISOString() });
  return s;
}

export function ensureSession(id?: string) {
  const existing = id ? getSession(id) : null;
  if (existing) return existing;
  return createSession();
}

export function clearSession(id: string) {
  return SESSIONS.delete(id);
}

// ============================================
// Pending Transaction Management
// ============================================

interface PendingTransaction {
  transactionData: any;
  requestedAccount: string;
  availableAccounts: any[];
  timestamp: Date;
}

const PENDING_TRANSACTIONS = new Map<string, PendingTransaction>();

export function storePendingTransaction(
  sessionId: string,
  transactionData: any,
  requestedAccount: string,
  availableAccounts: any[]
) {
  PENDING_TRANSACTIONS.set(sessionId, {
    transactionData,
    requestedAccount,
    availableAccounts,
    timestamp: new Date()
  });
}

export function getPendingTransaction(sessionId: string): PendingTransaction | undefined {
  return PENDING_TRANSACTIONS.get(sessionId);
}

export function clearPendingTransaction(sessionId: string) {
  PENDING_TRANSACTIONS.delete(sessionId);
}

