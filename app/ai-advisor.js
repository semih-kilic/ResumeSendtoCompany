import OpenAI from 'openai';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { CircuitBreaker, RetryManager } from './resilience-manager.js';
import { scoreToVerdict } from './job-fit-evaluator.js';
import { logProviderUsage } from './metrics.js';

/**
 * AI Advisor Service
 * Handles personalized content generation with intelligent failover.
 * Supports: Gemini → OpenAI → Nvidia NIM (multi-model cascade) → Graceful Degradation
 */

const NVIDIA_MODELS = [
    { id: 'deepseek-ai/deepseek-v4-flash-0731', name: 'DeepSeek V4 Flash', maxTokens: 60 },
    { id: 'meta/llama-3.1-70b-instruct', name: 'Llama 3.1 70B', maxTokens: 60 },
    { id: 'nvidia/llama-3.3-nemotron-super-49b-v1', name: 'Nemotron Super 49B', maxTokens: 60 },
    { id: 'meta/llama-3.1-405b-instruct', name: 'Llama 3.1 405B', maxTokens: 60 },
    { id: 'qwen/qwen3-32b', name: 'Qwen3 32B', maxTokens: 60 },
    { id: 'deepseek-ai/deepseek-r1-distill-llama-70b', name: 'DeepSeek R1 70B', maxTokens: 60 },
];

export class AIAdvisor {
    constructor(config) {
        this.config = config;
        this.openai = null;
        this.gemini = null;

        // Circuit breakers for each AI provider
        this.geminiBreakerr = new CircuitBreaker('gemini-ai', {
            failureThreshold: 3,
            timeoutSecs: 300,
        });
        this.openaiBreaker = new CircuitBreaker('openai-ai', {
            failureThreshold: 3,
            timeoutSecs: 300,
        });

        // Retry manager for transient failures
        this.retryManager = new RetryManager({
            maxRetries: 2,
            initialDelayMs: 2000,
            maxDelayMs: 15000,
        });

        // Track quota exhaustion per Nvidia model
        this.quotaExhaustedUntil = {
            gemini: 0,
            openai: 0,
        };
        this.nvidiaModelCooldowns = {};

        if (config.gemini_api_key) {
            console.log('[AI-ADVISOR] Gemini API Key found, initializing...');
            const genAI = new GoogleGenerativeAI(config.gemini_api_key);
            this.gemini = genAI.getGenerativeModel({
                model: "gemini-2.5-flash",
                safetySettings: [
                    { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
                    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
                    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
                    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
                ]
            });
        }

        if (config.openai_api_key) {
            this.openai = new OpenAI({ apiKey: config.openai_api_key });
        }

        // Nvidia NIM — cascade fallback (OpenAI-compatible API)
        this.nvidia = null;
        this.nvidiaBreaker = new CircuitBreaker('nvidia-ai', {
            failureThreshold: 3,
            timeoutSecs: 300,
        });

        if (config.nvidia_api_key) {
            console.log('[AI-ADVISOR] Nvidia NIM API Key found, initializing...');
            this.nvidia = new OpenAI({
                apiKey: config.nvidia_api_key,
                baseURL: 'https://integrate.api.nvidia.com/v1',
            });
        }
    }

    _isQuotaExhausted(provider) {
        return Date.now() < (this.quotaExhaustedUntil[provider] || 0);
    }

    _isNvidiaModelCooling(modelId) {
        return Date.now() < (this.nvidiaModelCooldowns[modelId] || 0);
    }

    _markNvidiaModelCooling(modelId, durationSecs = 300) {
        this.nvidiaModelCooldowns[modelId] = Date.now() + (durationSecs * 1000);
    }

    _markQuotaExhausted(provider, durationSecs = 3600) {
        this.quotaExhaustedUntil[provider] = Date.now() + (durationSecs * 1000);
        console.error(`[AI-ADVISOR] ${provider.toUpperCase()} quota exhausted for ${durationSecs}s`);
    }

    _handleApiError(error, provider) {
        const message = error.message || '';

        if (error.status === 429 || message.includes('quota') || message.includes('rate')) {
            this._markQuotaExhausted(provider, 3600);
            console.error(`[AI-ADVISOR] ${provider} rate limited: ${message}`);
            logProviderUsage({ provider, action: 'ai_personalize', status: 'rate_limit', error: message });
            return { isQuotaError: true, isTransient: true };
        }

        if (error.status === 402 || message.includes('billing') || message.includes('payment')) {
            this._markQuotaExhausted(provider, 86400);
            console.error(`[AI-ADVISOR] ${provider} billing error: ${message}`);
            logProviderUsage({ provider, action: 'ai_personalize', status: 'billing_error', error: message });
            return { isQuotaError: true, isTransient: true };
        }

        if (error.status === 500 || error.status === 503 || error.status === 504) {
            logProviderUsage({ provider, action: 'ai_personalize', status: 'transient_error', error: message });
            return { isQuotaError: false, isTransient: true };
        }

        logProviderUsage({ provider, action: 'ai_personalize', status: 'failure', error: message });
        return { isQuotaError: false, isTransient: false };
    }

    /**
     * Try Nvidia NIM models in cascade order
     */
    async _tryNvidiaModels(prompt, { maxTokens = 60, temperature = 0.7, action = 'ai_personalize' } = {}) {
        if (!this.nvidia) return null;

        for (const model of NVIDIA_MODELS) {
            if (this._isNvidiaModelCooling(model.id)) {
                console.log(`[AI-ADVISOR] Skipping ${model.name} (cooling down)`);
                continue;
            }

            try {
                const result = await this.nvidiaBreaker.execute(async () => {
                    console.log(`[AI-ADVISOR] Prompting Nvidia NIM (${model.name})...`);
                    const t0 = Date.now();
                    const response = await this.nvidia.chat.completions.create({
                        model: model.id,
                        messages: [{ role: 'user', content: prompt }],
                        max_tokens: maxTokens || model.maxTokens,
                        temperature,
                    });
                    const text = response.choices[0]?.message?.content?.trim();
                    const cleaned = text ? text.replace(/^["']|["']$/g, '') : null;
                    logProviderUsage({ provider: 'nvidia', action, status: 'success', durationMs: Date.now() - t0, model: model.id });
                    return cleaned;
                });
                if (result) return result;
            } catch (err) {
                console.warn(`[AI-ADVISOR] Nvidia ${model.name} failed: ${err.message}`);
                this._markNvidiaModelCooling(model.id, 300);
                logProviderUsage({ provider: 'nvidia', action, status: 'failure', error: err.message, model: model.id });
            }
        }
        return null;
    }

    async generateIntro(companyName, websiteContent) {
        if (!this.config.ai_personalization_enabled) return null;
        if (!websiteContent || websiteContent.length < 20) return null;

        const prompt = `
        You are Semih Kılıç, an experienced IT Systems Administrator (formerly Assistant Manager at KPMG).
        You are writing an honest, professional outreach email to ${companyName}.

        USER PROFILE (Your Background):
        - Cleared 200+ ticket backlog at KPMG.
        - Authorized to work in Canada.
        - Focus: Systems stabilization and operational performance.

        COMPANY CONTEXT (Their website/news):
        "${websiteContent.substring(0, 1000)}"

        TASK:
        Write ONE (1) short, natural, and honest sentence as an opening that connects your background to what they do.
        Example: "I've been following [Company]'s expansion into [Region], and as someone who managed IT for 2,500+ staff at KPMG, I admire your [Industry] efficiency."

        Output only the sentence. No quotes. Natural tone.
        `;

        // Try Gemini First
        if (this.gemini && !this._isQuotaExhausted('gemini')) {
            try {
                const geminiResult = await this.geminiBreakerr.execute(async () => {
                    console.log(`[AI-ADVISOR] Prompting Gemini...`);
                    const t0 = Date.now();
                    const genResult = await this.gemini.generateContent(prompt);
                    const response = await genResult.response;
                    const text = response.text().trim();
                    const intro = text ? text.replace(/^["']|["']$/g, '') : null;
                    logProviderUsage({ provider: 'gemini', action: 'ai_personalize', status: 'success', durationMs: Date.now() - t0 });
                    return intro;
                });
                return geminiResult;
            } catch (err) {
                const { isQuotaError, isTransient } = this._handleApiError(err, 'gemini');
                console.warn(`[AI-ADVISOR] Gemini failed: ${err.message} (quota: ${isQuotaError}, transient: ${isTransient})`);

                if (!isQuotaError) {
                    try {
                        return await this.retryManager.executeWithRetry(
                            () => this.geminiBreakerr.execute(() => this.gemini.generateContent(prompt)),
                            'Gemini intro generation'
                        );
                    } catch (retryErr) {
                        console.warn(`[AI-ADVISOR] Gemini retry exhausted`);
                    }
                }
            }
        }

        // Fallback to OpenAI
        if (this.openai && !this._isQuotaExhausted('openai')) {
            try {
                const openaiResult = await this.openaiBreaker.execute(async () => {
                    console.log(`[AI-ADVISOR] Prompting OpenAI (Gemini failed)...`);
                    const t0 = Date.now();
                    const response = await this.openai.chat.completions.create({
                        model: "gpt-3.5-turbo",
                        messages: [{ role: "user", content: prompt }],
                        max_tokens: 60,
                        temperature: 0.7,
                    });
                    const intro = response.choices[0]?.message?.content?.trim();
                    const result = intro ? intro.replace(/^["']|["']$/g, '') : null;
                    logProviderUsage({ provider: 'openai', action: 'ai_personalize', status: 'success', durationMs: Date.now() - t0 });
                    return result;
                });
                return openaiResult;
            } catch (err) {
                const { isQuotaError } = this._handleApiError(err, 'openai');
                console.error(`[AI-ADVISOR] OpenAI failed: ${err.message}`);
            }
        }

        // Fallback to Nvidia NIM cascade
        const nvidiaResult = await this._tryNvidiaModels(prompt, { maxTokens: 60, temperature: 0.7 });
        if (nvidiaResult) return nvidiaResult;

        console.warn(`[AI-ADVISOR] All AI providers unavailable. Using generic intro.`);
        return null;
    }

    async generateDynamicCVSummary(companyName, companyContext, baseSummary) {
        if (!this.config.ai_personalization_enabled) return baseSummary;

        const prompt = `
        You are an expert Executive Resume Writer.
        Your client is Semih Kılıç, an experienced IT Systems Administrator (formerly Assistant Manager at KPMG).

        BASE PROFILE:
        "${baseSummary}"

        TARGET COMPANY: ${companyName}
        COMPANY CONTEXT: "${companyContext ? companyContext.substring(0, 500) : 'A technology-focused company in Canada.'}"

        TASK:
        Rewrite Semih's Professional Summary to explicitly target ${companyName}.
        Make it sound like his entire career has been leading up to solving IT challenges specifically in their industry.
        Keep it professional, highly confident, and around 3-4 sentences.
        Do NOT use placeholders like [Company Name], use the actual name: ${companyName}.

        Output ONLY the rewritten paragraph. No quotes, no intro text.
        `;

        if (this.gemini) {
            try {
                const result = await this.gemini.generateContent(prompt);
                const response = await result.response;
                const text = response.text().trim();
                return text || baseSummary;
            } catch (err) {
                console.warn(`[AI-ADVISOR] Dynamic CV Summary failed (Gemini): ${err.message}`);
            }
        }

        if (this.openai) {
            try {
                const response = await this.openai.chat.completions.create({
                    model: "gpt-3.5-turbo",
                    messages: [{ role: "user", content: prompt }],
                    max_tokens: 150,
                    temperature: 0.6,
                });
                return response.choices[0]?.message?.content?.trim() || baseSummary;
            } catch (err) {
                console.warn(`[AI-ADVISOR] Dynamic CV Summary failed (OpenAI): ${err.message}`);
            }
        }

        const nvidiaResult = await this._tryNvidiaModels(prompt, { maxTokens: 150, temperature: 0.6, action: 'cv_summary' });
        return nvidiaResult || baseSummary;
    }

    async analyzeSentiment(body, subject) {
        const prompt = `
        Analyze the following email and classify it into EXACTLY one of these categories: interested, curious, redirected, rejected, ooo, or spam.

        Rules:
        - interested: They want a meeting, CV, or asked for a call.
        - curious: They asked generic questions.
        - redirected: Told to apply on a website or contact someone else.
        - rejected: Not interested.
        - ooo: Out of office.

        Subject: ${subject}
        Body: ${body.substring(0, 800)}

        Output only the category word.
        `;

        if (this.gemini) {
            try {
                const result = await this.gemini.generateContent(prompt);
                const response = await result.response;
                const text = response.text().trim().toLowerCase();
                return text.split(/\s+/)[0].replace(/[^a-z]/g, '');
            } catch (err) {
                console.warn(`[AI-ADVISOR] Gemini sentiment failed: ${err.message}`);
            }
        }

        if (this.openai) {
            try {
                const response = await this.openai.chat.completions.create({
                    model: "gpt-3.5-turbo",
                    messages: [{ role: "user", content: prompt }],
                    max_tokens: 10,
                });
                return response.choices[0]?.message?.content?.trim().toLowerCase();
            } catch (err) {
                return 'unknown';
            }
        }

        const nvidiaResult = await this._tryNvidiaModels(prompt, { maxTokens: 10, temperature: 0.1, action: 'sentiment' });
        return nvidiaResult?.split(/\s+/)[0]?.replace(/[^a-z]/g, '') || 'unknown';
    }

    async analyzeSalesIntent(body, subject) {
        const prompt = `
        Analyze the following B2B SaaS outreach reply and classify it into EXACTLY one of these categories:
        interested, pricing, demo, rejected, ooo, or unknown.

        SaaS Categories:
        - interested: General positive interest, wants more info.
        - pricing: Specifically asked about costs, plans, or quotes.
        - demo: Asked for a walkthrough, trial, or meeting to see the tool.
        - rejected: Not interested, "stop emailing", or "no thanks".
        - ooo: Out of office auto-reply.

        Subject: ${subject}
        Body: ${body.substring(0, 800)}

        Output only the category word.
        `;

        if (this.gemini) {
            try {
                const result = await this.gemini.generateContent(prompt);
                const response = await result.response;
                const text = response.text().trim().toLowerCase();
                return text.split(/\s+/)[0].replace(/[^a-z]/g, '');
            } catch (err) {
                console.warn(`[AI-ADVISOR] Gemini sales intent failed: ${err.message}`);
            }
        }

        if (this.openai) {
            try {
                const response = await this.openai.chat.completions.create({
                    model: "gpt-3.5-turbo",
                    messages: [{ role: "user", content: prompt }],
                    max_tokens: 10,
                });
                return response.choices[0]?.message?.content?.trim().toLowerCase();
            } catch (err) {
                return 'unknown';
            }
        }

        const nvidiaResult = await this._tryNvidiaModels(prompt, { maxTokens: 10, temperature: 0.1, action: 'sales_intent' });
        return nvidiaResult?.split(/\s+/)[0]?.replace(/[^a-z]/g, '') || 'unknown';
    }

    async evaluateCompanyFit(context, profile) {
        const { companyName, website, emailType, websiteSnippet } = context;

        const prompt = `You evaluate whether a candidate should send an open job application to a company.

CANDIDATE PROFILE:
- Name: ${profile.name}
- Location: ${profile.location}
- Summary: ${profile.summary}
- Core competencies: ${profile.competencies.join(', ')}
- Experience: ${profile.experience}
- Certifications: ${profile.certifications}
- Career goals: ${profile.careerGoals.join('; ')}
- Energizing work: ${profile.energizingTasks.join('; ')}
- Avoid: ${profile.drainingTasks.join('; ')}

TARGET COMPANY:
- Name: ${companyName}
- Website: ${website || 'unknown'}
- Contact type: ${emailType || 'general'}
- Website excerpt: "${(websiteSnippet || '').substring(0, 800)}"

Score each dimension 0-100:
1. technicalSkills - IT/infrastructure relevance of the company to candidate skills
2. experienceMatch - likelihood they need someone with enterprise IT background
3. behavioralFit - professional B2B culture fit (estimate if unknown)
4. careerAlignment - advances candidate's Canada IT career goals
5. location - use "PASS" if Canada-based or remote-friendly, "FAIL" if clearly non-Canada only

Respond ONLY with valid JSON:
{
  "technicalSkills": 0,
  "experienceMatch": 0,
  "behavioralFit": 0,
  "careerAlignment": 0,
  "location": "PASS",
  "overallScore": 0,
  "recommendation": "apply|apply_with_caveats|skip",
  "strengths": ["..."],
  "gaps": ["..."]
}

Weight overallScore: technical 30%, experience 25%, behavioral 15%, career 30%.
If location is FAIL, cap overallScore at 40.`;

        const parseJson = (text) => {
            const match = text.match(/\{[\s\S]*\}/);
            if (!match) return null;
            const parsed = JSON.parse(match[0]);
            const overall = parsed.overallScore ?? Math.round(
                (parsed.technicalSkills || 0) * 0.3 +
                (parsed.experienceMatch || 0) * 0.25 +
                (parsed.behavioralFit || 0) * 0.15 +
                (parsed.careerAlignment || 0) * 0.3
            );
            return {
                overallScore: overall,
                verdict: scoreToVerdict(overall),
                dimensions: {
                    technicalSkills: parsed.technicalSkills,
                    experienceMatch: parsed.experienceMatch,
                    behavioralFit: parsed.behavioralFit,
                    location: parsed.location,
                    careerAlignment: parsed.careerAlignment,
                },
                recommendation: parsed.recommendation,
                strengths: parsed.strengths || [],
                gaps: parsed.gaps || [],
            };
        };

        if (this.gemini && !this._isQuotaExhausted('gemini')) {
            try {
                const result = await this.gemini.generateContent(prompt);
                const text = (await result.response).text();
                const parsed = parseJson(text);
                if (parsed) return parsed;
            } catch (err) {
                console.warn(`[AI-ADVISOR] Gemini fit eval failed: ${err.message}`);
            }
        }

        if (this.openai && !this._isQuotaExhausted('openai')) {
            try {
                const response = await this.openai.chat.completions.create({
                    model: 'gpt-3.5-turbo',
                    messages: [{ role: 'user', content: prompt }],
                    max_tokens: 400,
                    temperature: 0.3,
                    response_format: { type: 'json_object' },
                });
                const parsed = parseJson(response.choices[0]?.message?.content || '');
                if (parsed) return parsed;
            } catch (err) {
                console.warn(`[AI-ADVISOR] OpenAI fit eval failed: ${err.message}`);
            }
        }

        if (this.nvidia) {
            for (const model of NVIDIA_MODELS) {
                if (this._isNvidiaModelCooling(model.id)) continue;
                try {
                    const response = await this.nvidia.chat.completions.create({
                        model: model.id,
                        messages: [{ role: 'user', content: prompt }],
                        max_tokens: 400,
                        temperature: 0.3,
                    });
                    const parsed = parseJson(response.choices[0]?.message?.content || '');
                    if (parsed) return parsed;
                } catch (err) {
                    console.warn(`[AI-ADVISOR] Nvidia ${model.name} fit eval failed: ${err.message}`);
                    this._markNvidiaModelCooling(model.id, 300);
                }
            }
        }

        return null;
    }

    async reviewOutreachDraft(intro, companyName, websiteSnippet) {
        if (!intro || intro.length < 10) return intro;

        const prompt = `You are a strict reviewer for professional job outreach emails.

COMPANY: ${companyName}
WEBSITE CONTEXT: "${(websiteSnippet || '').substring(0, 400)}"

DRAFT OPENING SENTENCE:
"${intro}"

Rules:
- Must be ONE sentence, natural, honest, no hype
- Must connect candidate IT background to company context
- No placeholders, no generic fluff
- If good, return unchanged
- If weak, return improved version only (no quotes, no explanation)

Output ONLY the final sentence.`;

        if (this.gemini && !this._isQuotaExhausted('gemini')) {
            try {
                const result = await this.gemini.generateContent(prompt);
                const text = (await result.response).text().trim().replace(/^["']|["']$/g, '');
                if (text.length > 20) return text;
            } catch {}
        }

        if (this.openai && !this._isQuotaExhausted('openai')) {
            try {
                const response = await this.openai.chat.completions.create({
                    model: 'gpt-3.5-turbo',
                    messages: [{ role: 'user', content: prompt }],
                    max_tokens: 120,
                    temperature: 0.5,
                });
                const text = response.choices[0]?.message?.content?.trim().replace(/^["']|["']$/g, '');
                if (text && text.length > 20) return text;
            } catch {}
        }

        if (this.nvidia) {
            for (const model of NVIDIA_MODELS) {
                if (this._isNvidiaModelCooling(model.id)) continue;
                try {
                    const response = await this.nvidia.chat.completions.create({
                        model: model.id,
                        messages: [{ role: 'user', content: prompt }],
                        max_tokens: 120,
                        temperature: 0.5,
                    });
                    const text = response.choices[0]?.message?.content?.trim().replace(/^["']|["']$/g, '');
                    if (text && text.length > 20) return text;
                } catch {
                    this._markNvidiaModelCooling(model.id, 300);
                }
            }
        }

        return intro;
    }
}
