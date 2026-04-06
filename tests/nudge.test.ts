import { describe, test, expect } from "bun:test";
import { stage4NudgePrompt } from "../src/prompts";

describe("stage4NudgePrompt", () => {
  const question = "Should we use Postgres or DynamoDB?";
  const originalResponse = "### Recommendation\nUse DynamoDB for scale.";
  const correction = "Our app will never exceed 100GB, scale is not a concern.";

  test("includes original question", () => {
    const prompt = stage4NudgePrompt(question, originalResponse, correction);
    expect(prompt).toContain(question);
  });

  test("includes original response", () => {
    const prompt = stage4NudgePrompt(question, originalResponse, correction);
    expect(prompt).toContain(originalResponse);
  });

  test("includes correction text", () => {
    const prompt = stage4NudgePrompt(question, originalResponse, correction);
    expect(prompt).toContain(correction);
  });

  test("requests structured output sections", () => {
    const prompt = stage4NudgePrompt(question, originalResponse, correction);
    expect(prompt).toContain("### What Changed");
    expect(prompt).toContain("### Updated Recommendation");
    expect(prompt).toContain("### Assumptions");
    expect(prompt).toContain("### Updated Confidence");
  });

  test("asks agent to be explicit about changes", () => {
    const prompt = stage4NudgePrompt(question, originalResponse, correction);
    expect(prompt).toContain("what changed and what stayed the same");
  });
});
