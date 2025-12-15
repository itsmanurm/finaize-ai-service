import { z } from 'zod';

export const ItemSchema = z.object({
  description: z.string().min(1),
  merchant: z.string().optional(),
  amount: z.number(),
  currency: z.enum(['ARS', 'USD']),
  when: z.string().optional(),
  accountLast4: z.string().optional(),
  bankMessageId: z.string().optional(),
  category: z.string().optional(),
  previousTransactions: z.array(z.object({
    description: z.string(),
    amount: z.number(),
    category: z.string().optional()
  })).optional(),
  userProfile: z.object({
    commonMerchants: z.array(z.string()).optional()
  }).optional()
});

export type ItemInput = z.infer<typeof ItemSchema>;

export const FeedbackSchema = z.object({
  dedupHash: z.string().min(20),
  category_user: z.string().min(1),
  reason: z.string().optional(),
  userId: z.string().optional(),
  item: ItemSchema.optional()
});
export type FeedbackInput = z.infer<typeof FeedbackSchema>;

export const SummarizeSchema = z.object({
  items: z.array(ItemSchema).min(1),
  classifyMissing: z.boolean().optional().default(true),
  currency: z.enum(['ARS', 'USD']).optional().default('ARS'),
  periodLabel: z.string().optional(),
  useAI: z.boolean().optional().default(false)
});
export type SummarizeInput = z.infer<typeof SummarizeSchema>;

// -- DS / Analytics Schemas --

export const TransactionSchema = z.object({
  _id: z.string().optional(),
  id: z.string().optional(),
  amount: z.number(),
  date: z.union([z.string(), z.date()]).optional(),
  when: z.union([z.string(), z.date()]).optional(), // Alias común en el proyecto
  description: z.string().optional(),
  category: z.string().optional(),
  merchant: z.string().optional()
});
export type TransactionInput = z.infer<typeof TransactionSchema>;

export const ForecastRequestSchema = z.object({
  transactions: z.array(TransactionSchema),
  category: z.string().optional(),
  horizonDays: z.number().min(1).max(365).default(30)
});
export type ForecastRequestInput = z.infer<typeof ForecastRequestSchema>;

export const AnomalyRequestSchema = z.object({
  transactions: z.array(TransactionSchema),
  threshold: z.number().min(0.1).max(10).optional().default(3.5)
});
export type AnomalyRequestInput = z.infer<typeof AnomalyRequestSchema>;
