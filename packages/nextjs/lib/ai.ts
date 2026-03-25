// Server-only — never import this in client components
import { CONSTITUTION } from "./constitution";
import type OpenAI from "openai";

const SYSTEM_PROMPT = `You are the constitutional AI of Avocado Nation.
Your role is to evaluate citizen proposals against the national constitution and
make governance decisions. Your decision is final and will be executed automatically
onchain. Be fair, consistent, and apply the constitution equally to all citizens.

You must respond ONLY with a valid JSON object. No preamble. No explanation outside
the JSON. No markdown code fences. Raw JSON only.

Response schema:
{
  "decision": "approve" | "reject",
  "reasoning": "string — max 500 characters, explain your decision",
  "constitutional_alignment": number between 0 and 100,
  "risk_flags": ["array of strings describing any concerns, empty if none"],
  "approved_action_target": "0x... address string or null if no action or not approved",
  "approved_action_value": "wei amount as string or null if no action or not approved"
}

Rules:
- "approve": proposal is consistent with the constitution and may proceed
- "reject": proposal violates the constitution, is not in the state's interest, or is unclear — explain why in reasoning
- If decision is "approve" and hasAction is true, you MUST echo back the exact
  actionTarget and actionValue from the proposal in approved_action_target and
  approved_action_value. Do not modify them. If you are not approving, set both to null.
- Apply the 10% treasury cap rule from Article II Section 4.
- Apply equal treatment from Article V to all citizens regardless of address.`;

export type AIInput = {
  proposalId: number;
  proposalHash: string; // bytes32 hex from contract — tamper-evident commitment
  proposalText: string;
  hasAction: boolean;
  actionTarget: string; // "0x0000..." if no action
  actionValue: string; // wei as string, "0" if no action
  citizen: string; // submitter address
  treasuryBalance: string; // current balance in wei as string
  constitutionHash: string; // the hash stored in the contract at submission
};

export type AIOutput = {
  decision: "approve" | "reject";
  reasoning: string; // max 500 chars — stored onchain
  constitutional_alignment: number; // 0-100
  risk_flags: string[];
  // If proposal has an action, AI must echo back target and value it is approving.
  approved_action_target: string | null;
  approved_action_value: string | null; // wei as string
};

export type AICallResult = {
  response: OpenAI.ChatCompletion;
  requestBodyJson: string; // exact JSON string used — needed for hash verification
  responseBodyJson: string; // exact JSON string received — needed for hash verification
  output: AIOutput;
  requestId: string;
};

export async function evaluateProposal(input: AIInput): Promise<AICallResult> {
  const userMessage = `
CONSTITUTION HASH (for tamper evidence): ${input.constitutionHash}

CONSTITUTION:
${CONSTITUTION}

---

PROPOSAL ID: ${input.proposalId}
PROPOSAL HASH (tamper-evident commitment): ${input.proposalHash}
SUBMITTER ADDRESS: ${input.citizen}
TREASURY BALANCE (wei): ${input.treasuryBalance}

PROPOSAL TEXT:
${input.proposalText}

REQUESTED ACTION: ${input.hasAction ? "YES" : "NO"}
${
  input.hasAction
    ? `ACTION TARGET: ${input.actionTarget}
ACTION VALUE (wei): ${input.actionValue}`
    : ""
}

Evaluate this proposal against the constitution and respond with JSON only.
`.trim();

  // Serialize once — this exact string is what the TEE will hash and sign.
  // Use raw fetch (not the OpenAI SDK) so we control the wire format precisely.
  const requestBodyJson = JSON.stringify({
    model: process.env.REDPILL_MODEL || "openai/gpt-oss-120b",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ],
    temperature: 0,
    max_tokens: 1024,
  });

  const httpResponse = await fetch("https://api.redpill.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.REDPILL_API_KEY}`,
    },
    body: requestBodyJson,
  });

  if (!httpResponse.ok) {
    const errText = await httpResponse.text();
    throw new Error(`RedPill API error ${httpResponse.status}: ${errText}`);
  }

  const responseBodyJson = await httpResponse.text(); // raw string — same bytes the TEE signed
  const response = JSON.parse(responseBodyJson) as OpenAI.ChatCompletion;

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("Empty AI response");

  let output: AIOutput;
  try {
    output = JSON.parse(content) as AIOutput;
  } catch {
    throw new Error(`AI returned invalid JSON: ${content}`);
  }

  if (!["approve", "reject"].includes(output.decision)) {
    throw new Error(`Invalid AI decision value: ${output.decision}`);
  }
  if (typeof output.reasoning !== "string" || output.reasoning.length === 0) {
    throw new Error("AI reasoning is missing or empty");
  }
  if (output.reasoning.length > 500) {
    throw new Error("AI reasoning exceeds 500 chars");
  }
  if (
    typeof output.constitutional_alignment !== "number" ||
    output.constitutional_alignment < 0 ||
    output.constitutional_alignment > 100
  ) {
    throw new Error("AI constitutional_alignment must be a number between 0 and 100");
  }
  if (!Array.isArray(output.risk_flags) || !output.risk_flags.every(f => typeof f === "string")) {
    throw new Error("AI risk_flags must be an array of strings");
  }

  // If approved with action, AI must echo back exact target and value
  if (output.decision === "approve" && input.hasAction) {
    if (!output.approved_action_target || !output.approved_action_value) {
      throw new Error("AI approved an action proposal but did not echo back target/value");
    }
    if (output.approved_action_target.toLowerCase() !== input.actionTarget.toLowerCase()) {
      throw new Error(
        `AI echoed wrong action target. Expected: ${input.actionTarget}, Got: ${output.approved_action_target}`,
      );
    }
    if (output.approved_action_value !== input.actionValue) {
      throw new Error(
        `AI echoed wrong action value. Expected: ${input.actionValue}, Got: ${output.approved_action_value}`,
      );
    }
  }

  return {
    response,
    requestBodyJson,
    responseBodyJson,
    output,
    requestId: response.id,
  };
}
