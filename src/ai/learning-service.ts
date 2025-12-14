import { promises as fs } from 'fs';
import path from 'path';
import { normalizeMerchant } from './merchant-normalizer';

const DATA_DIR = path.join(process.cwd(), 'data');
const FEEDBACK_FILE = path.join(DATA_DIR, 'feedback.jsonl');

interface FeedbackEntry {
    dedupHash: string;
    category_user: string;
    reason?: string;
    item?: {
        description: string;
        merchant?: string;
        amount: number;
    };
    ts: string;
}

interface LearnedPattern {
    category: string;
    confidence: number;
    source: 'user_feedback';
    count: number;
}

// In-memory cache of learned patterns
// Key: merchant_clean or description_clean
const memoryBank = new Map<string, LearnedPattern>();
let lastLoadTime = 0;

/**
 * Carga el feedback del archivo jsonl y construye un "banco de memoria"
 * Agrupa por comercio/descripción y determina la categoría más votada por el usuario
 */
export async function loadFeedbackMemory(force = false) {
    // Reload only every 5 minutes unless forced
    if (!force && Date.now() - lastLoadTime < 5 * 60 * 1000 && memoryBank.size > 0) {
        return;
    }

    try {
        // Ensure file exists
        try {
            await fs.access(FEEDBACK_FILE);
        } catch {
            return; // No feedback file yet
        }

        const content = await fs.readFile(FEEDBACK_FILE, 'utf8');
        const lines = content.split('\n').filter(Boolean);

        // Temporary aggregation map
        // Key: string (normalized identifier), Value: Map<category, count>
        const aggregations = new Map<string, Map<string, number>>();

        for (const line of lines) {
            try {
                const entry: FeedbackEntry = JSON.parse(line);
                if (!entry.category_user) continue;

                // Extract identifiers
                const keys: string[] = [];

                if (entry.item?.merchant) {
                    const m = normalizeMerchant(entry.item.merchant);
                    if (m) keys.push(`merchant:${m}`);
                }

                if (entry.item?.description) {
                    // Simplificar descripción para matching
                    const d = entry.item.description.toLowerCase().trim();
                    keys.push(`desc:${d}`);
                }

                // Add votes
                for (const key of keys) {
                    if (!aggregations.has(key)) {
                        aggregations.set(key, new Map());
                    }
                    const catMap = aggregations.get(key)!;
                    catMap.set(entry.category_user, (catMap.get(entry.category_user) || 0) + 1);
                }

            } catch (e) {
                // Ignore malformed lines
            }
        }

        // Convert aggregations to finalized memory bank
        memoryBank.clear();
        for (const [key, catMap] of aggregations.entries()) {
            // Find winner category
            let winnerCat = '';
            let maxVotes = 0;
            let totalVotes = 0;

            for (const [cat, votes] of catMap.entries()) {
                totalVotes += votes;
                if (votes > maxVotes) {
                    maxVotes = votes;
                    winnerCat = cat;
                }
            }

            // Confidence heuristic: mostly agreement
            const consensus = maxVotes / totalVotes;

            // Solo aprender si hay cierto consenso (ej > 70%)
            if (consensus >= 0.7) {
                memoryBank.set(key, {
                    category: winnerCat,
                    confidence: Math.min(0.95, 0.5 + (consensus * 0.4) + (Math.min(maxVotes, 5) * 0.02)), // Base + agreement + volume bonus
                    source: 'user_feedback',
                    count: totalVotes
                });
            }
        }

        lastLoadTime = Date.now();
        console.log(`[LearningService] Loaded ${memoryBank.size} learned patterns from feedback.`);

    } catch (error) {
        console.error('[LearningService] Error loading feedback:', error);
    }
}

/**
 * Consulta la memoria para ver si aprendimos algo sobre esta transacción
 */
export async function consultMemory(input: { merchant?: string; description: string }): Promise<LearnedPattern | null> {
    // Ensure loaded (lazy load logic handled inside)
    await loadFeedbackMemory();

    // 1. Try by merchant (Strongest signal)
    if (input.merchant) {
        const m = normalizeMerchant(input.merchant);
        if (m) {
            const match = memoryBank.get(`merchant:${m}`);
            if (match) return match;
        }
    }

    // 2. Try by description (Exact match normalized)
    const d = input.description.toLowerCase().trim();
    const matchDesc = memoryBank.get(`desc:${d}`);
    if (matchDesc) return matchDesc;

    return null;
}
