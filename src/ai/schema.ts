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
