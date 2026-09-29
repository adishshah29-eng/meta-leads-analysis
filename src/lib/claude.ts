/**
 * Claude (Anthropic) API client for generating weekly narrative summaries.
 * Only called from the weekly report computation route.
 */

import Anthropic from "@anthropic-ai/sdk";

export interface WeeklyNarrativeInput {
  weekStart: string;
  weekEnd: string;
  totalSpend: number;
  totalResults: number;
  avgCTR: number;
  avgCPA: number;
  spendChangePct: number | null;
  cpaChangePct: number | null;
  resultsChangePct: number | null;
  topAds: Array<{ ad_name: string; results: number; cost_per_result: number }>;
  bottomAds: Array<{ ad_name: string; spend: number; results: number }>;
}

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5-5";

/**
 * Generate a 3-4 sentence analyst-style weekly summary using Claude.
 * Returns null if ANTHROPIC_API_KEY is not set or the call fails (graceful degradation).
 */
export async function generateWeeklyNarrative(
  data: WeeklyNarrativeInput
): Promise<string | null> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn("[Claude] ANTHROPIC_API_KEY not set — skipping AI narrative.");
    return null;
  }

  const pctStr = (v: number | null) =>
    v === null ? "N/A" : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;

  const prompt = `You are a concise performance marketing analyst. Given these week-over-week Meta Ads metrics, write a 3-4 sentence analyst-style summary. Highlight the most important trend and give one specific, actionable suggestion. Be direct and data-driven. Do not use bullet points or headers — write in flowing sentences.

Week: ${data.weekStart} to ${data.weekEnd}
Total Spend: ₹${data.totalSpend.toFixed(0)} (${pctStr(data.spendChangePct)} vs last week)
Total Results: ${data.totalResults} (${pctStr(data.resultsChangePct)} vs last week)
Average CPA: ₹${data.avgCPA.toFixed(0)} (${pctStr(data.cpaChangePct)} vs last week)
Average CTR: ${data.avgCTR.toFixed(2)}%

Top performing ads (by results):
${data.topAds.map((a) => `- ${a.ad_name}: ${a.results} results at ₹${a.cost_per_result.toFixed(0)} per result`).join("\n")}

Underperforming ads (high spend, low results):
${data.bottomAds.map((a) => `- ${a.ad_name}: ₹${a.spend.toFixed(0)} spend, ${a.results} results`).join("\n")}

Write the summary now:`;

  try {
    const client = new Anthropic();
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: "low" },
      // On a safety decline, re-run on a fallback model chosen by the API
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages: [{ role: "user", content: prompt }],
    });

    if (response.stop_reason === "refusal") {
      console.warn("[Claude] Narrative request was declined:", response.stop_details);
      return null;
    }

    // Thinking blocks may precede the answer, so pick the text blocks explicitly
    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    return text || null;
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      console.error(`[Claude] API error ${err.status}:`, err.message);
    } else {
      console.error("[Claude] Request failed:", err);
    }
    return null;
  }
}
