
import { Router } from 'express';
import { agentChatCompletion } from '../ai/openai-service';
import { z } from 'zod';

const r = Router();

// Validation Schema
const AgentChatSchema = z.object({
    messages: z.array(z.any()),
    tools: z.array(z.any()).optional(),
    model: z.string().optional()
});

/** POST /ai/agent/chat - Pure LLM Gateway for Agents */
r.post('/chat', async (req, res) => {
    const parse = AgentChatSchema.safeParse(req.body);
    if (!parse.success) {
        return res.status(400).json({ ok: false, error: 'Bad request', details: parse.error.issues });
    }

    try {
        const message = await agentChatCompletion(parse.data);
        return res.json({ ok: true, message });
    } catch (error: any) {
        console.error('[Agent Chat] Error:', error);
        return res.status(500).json({ ok: false, error: error.message });
    }
});

export default r;
