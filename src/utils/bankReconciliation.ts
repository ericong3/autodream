import Anthropic from '@anthropic-ai/sdk';
import { BankTransaction, Payment } from '../types';

// ── Statement extraction ────────────────────────────────────────────────────
// Deliberately not a PDF-text-extraction or OCR library — Claude reads the
// statement directly (PDF or a photo of one, same code path either way) and
// generalizes across bank formats instead of needing a per-bank template.
// Reuses the exact api-key + browser-call convention already established in
// AIAssistant.tsx (`localStorage.getItem('autodream_api_key')`).

export interface ExtractedTxn {
  date: string;        // ISO yyyy-mm-dd
  description: string;
  amount: number;       // always positive; direction carries the sign
  direction: 'debit' | 'credit';
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip the "data:<mime>;base64," prefix — the API wants raw base64.
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

const EXTRACTION_PROMPT = `You are reading a bank statement (it may be a PDF export or a photo of a printed/mobile statement). Extract every transaction line into a strict JSON array — nothing else, no markdown fences, no commentary.

Each item:
{
  "date": "YYYY-MM-DD",
  "description": "the transaction description/payee exactly as printed",
  "amount": <positive number, no currency symbol or thousands separators>,
  "direction": "debit" | "credit"
}

"debit" = money leaving the account (a payment/withdrawal/transfer out).
"credit" = money entering the account (a deposit/collection/transfer in).
Some statements show separate debit/credit columns; others show one signed amount or a running balance — infer direction from whichever the statement actually uses. Skip balance-only lines, headers, and footers. If you cannot read the statement at all, return an empty array [].

Return ONLY the JSON array.`;

export async function extractTransactionsFromStatement(file: File, apiKey: string): Promise<ExtractedTxn[]> {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const base64 = await fileToBase64(file);
  const isPdf = file.type === 'application/pdf';
  const block = isPdf
    ? { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: base64 } }
    : { type: 'image' as const, source: { type: 'base64' as const, media_type: (file.type || 'image/jpeg') as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif', data: base64 } };

  const response = await client.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 8192,
    messages: [{ role: 'user', content: [block, { type: 'text', text: EXTRACTION_PROMPT }] }],
  });
  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') throw new Error('No response from Claude');

  // Defensive parse — the prompt says "no markdown fences" but models sometimes add them anyway.
  const raw = textBlock.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Could not parse the statement — the response wasn\'t valid JSON. Try a clearer scan/photo.');
  }
  if (!Array.isArray(parsed)) throw new Error('Unexpected response shape from Claude');
  return parsed.filter((t): t is ExtractedTxn =>
    t && typeof t.date === 'string' && typeof t.description === 'string' &&
    typeof t.amount === 'number' && (t.direction === 'debit' || t.direction === 'credit'));
}

// ── Local matching ──────────────────────────────────────────────────────────
// A bank debit is money we paid out — matches any non-inbound Payment.
// A bank credit is money we received — matches an inbound-type Payment.
// Mirrors the same split Payments.tsx already defines (INBOUND_TYPES).
const INBOUND_TYPES = new Set<Payment['type']>(['customer_collection', 'loan_disbursement', 'consignment_collection']);

const DAY_MS = 86400000;
const MIN_SCORE = 0.45; // below this, don't suggest anything — force a manual look

function tokenOverlapScore(a: string, b: string): number {
  const tokensOf = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2));
  const ta = tokensOf(a), tb = tokensOf(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  ta.forEach((w) => { if (tb.has(w)) shared++; });
  return shared / Math.max(ta.size, tb.size);
}

// Only candidates still worth matching against — a payment already reconciled
// against a different bank line isn't a candidate again.
function isCandidate(p: Payment, direction: 'debit' | 'credit', alreadyMatchedIds: Set<string>): boolean {
  if (p.status !== 'pending') return false;
  if (alreadyMatchedIds.has(p.id)) return false;
  const inbound = INBOUND_TYPES.has(p.type);
  return direction === 'credit' ? inbound : !inbound;
}

// Exposed for the review UI's manual-override dropdown — same eligibility
// rule the auto-matcher uses, so overriding never offers a payment that
// wouldn't make sense (wrong direction, already reconciled elsewhere).
export function candidatePayments(direction: 'debit' | 'credit', payments: Payment[], excludeIds: Set<string>): Payment[] {
  return payments.filter((p) => isCandidate(p, direction, excludeIds));
}

export function suggestMatch(
  txn: { txnDate: string; description: string; amount: number; direction: 'debit' | 'credit' },
  payments: Payment[],
  alreadyMatchedIds: Set<string>,
): string | undefined {
  let best: { id: string; score: number } | null = null;
  for (const p of payments) {
    if (!isCandidate(p, txn.direction, alreadyMatchedIds)) continue;
    const amountDiff = Math.abs(p.amount - txn.amount);
    const amountScore = amountDiff < 0.01 ? 1 : Math.max(0, 1 - amountDiff / Math.max(p.amount, txn.amount, 1));
    const refDate = p.transferredAt ?? p.createdAt;
    const daysApart = Math.abs(new Date(txn.txnDate).getTime() - new Date(refDate).getTime()) / DAY_MS;
    const dateScore = Math.max(0, 1 - daysApart / 30); // full credit within a couple days, fades out over a month
    const nameScore = tokenOverlapScore(p.recipientName, txn.description);
    // Amount match matters most — it's the strongest signal a bank line and a
    // payment are the same real-world transfer.
    const score = amountScore * 0.6 + dateScore * 0.25 + nameScore * 0.15;
    if (!best || score > best.score) best = { id: p.id, score };
  }
  return best && best.score >= MIN_SCORE ? best.id : undefined;
}

// Batch version for after an upload's transactions are inserted — assigns
// suggestions greedily in amount-score order so two bank lines with the same
// amount don't both claim the same payment.
export function matchBankTransactions(
  bankTxns: Pick<BankTransaction, 'id' | 'txnDate' | 'description' | 'amount' | 'direction'>[],
  payments: Payment[],
): Map<string, string> {
  const suggestions = new Map<string, string>();
  const claimed = new Set<string>();
  for (const txn of bankTxns) {
    const match = suggestMatch(txn, payments, claimed);
    if (match) {
      suggestions.set(txn.id, match);
      claimed.add(match);
    }
  }
  return suggestions;
}
