import Anthropic from '@anthropic-ai/sdk';
import { Injectable, Logger, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export const AI_MODEL = 'claude-opus-5-5';

/**
 * Thin wrapper around the Claude Messages API. Enabled when ANTHROPIC_API_KEY is set
 * (or AI_ENABLED=true with another SDK credential source, e.g. `ant auth login`).
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private client: Anthropic | null = null;

  constructor(private readonly config: ConfigService) {}

  get enabled() {
    return !!this.config.get('ANTHROPIC_API_KEY') || this.config.get('AI_ENABLED') === 'true' || this.simulated;
  }

  /**
   * Dev/test only: AI_SIMULATE=true (and no API key) returns canned, deterministic output
   * instead of calling Claude, so AI flows can be exercised offline. Never on in production.
   */
  get simulated() {
    return process.env.NODE_ENV !== 'production' && this.config.get('AI_SIMULATE') === 'true' && !this.config.get('ANTHROPIC_API_KEY');
  }

  private get anthropic() {
    if (!this.enabled) throw new ServiceUnavailableException('AI is not configured. Set ANTHROPIC_API_KEY on the API server.');
    this.client ??= new Anthropic({ apiKey: this.config.get('ANTHROPIC_API_KEY') || undefined, maxRetries: 2, timeout: 120_000 });
    return this.client;
  }

  /** One-shot generation. Low effort: these are short drafting tasks where latency matters. */
  async generate(system: string, prompt: string, opts: { maxTokens?: number; effort?: 'low' | 'medium' | 'high' } = {}): Promise<string> {
    if (this.simulated) return simulate(system, prompt);
    try {
      const response = await this.anthropic.beta.messages.create({
        model: AI_MODEL,
        max_tokens: opts.maxTokens ?? 4000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: opts.effort ?? 'low' },
        system,
        messages: [{ role: 'user', content: prompt }],
      });
      if (response.stop_reason === 'refusal') {
        throw new UnprocessableEntityException('The AI declined to generate this content. Try rephrasing the request.');
      }
      const text = response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('')
        .trim();
      if (!text) throw new UnprocessableEntityException('The AI returned an empty response.');
      return text;
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) {
        throw new ServiceUnavailableException('AI credentials are invalid. Check ANTHROPIC_API_KEY.');
      }
      if (err instanceof Anthropic.RateLimitError) {
        throw new ServiceUnavailableException('AI is busy right now (rate limited). Try again in a moment.');
      }
      if (err instanceof Anthropic.APIError) {
        this.logger.error(`Claude API error ${err.status}: ${err.message}`);
        throw new ServiceUnavailableException('AI request failed. Please try again.');
      }
      throw err;
    }
  }
}

/** Canned output for AI_SIMULATE (see AiService.simulated). */
function simulate(system: string, prompt: string): string {
  if (system.includes('AI_ASSISTANT_DECISION')) {
    const latest = /<latest_message>([\s\S]*?)<\/latest_message>/.exec(prompt)?.[1]?.trim() ?? '';
    if (/\b(human|person|agent|someone|refund|complain|manager)\b/i.test(latest)) {
      return JSON.stringify({ action: 'handoff', message: '', reason: 'Customer asked for a person (simulated)' });
    }
    return JSON.stringify({ action: 'reply', message: `Thanks for your message! (Simulated reply to: "${latest.slice(0, 80)}")`, reason: '' });
  }
  if (prompt.includes('Write an email')) return 'Subject: Simulated subject\n\nSimulated email body.';
  return 'Simulated AI response.';
}
