import { keccak256, toUtf8Bytes } from "ethers";
import { NextRequest, NextResponse } from "next/server";
import { evaluateProposal } from "~~/lib/ai";
import { ensureTEETrusted } from "~~/lib/attestation";
import { executeProposalOnchain, getGovernanceContract, submitAIDecisionOnchain } from "~~/lib/contract-server";
import { CONSTITUTION } from "~~/lib/constitution";
import { fetchSignatureWithRetry, verifyHashes } from "~~/lib/signature";

const LOCAL_CONSTITUTION_HASH = keccak256(toUtf8Bytes(CONSTITUTION));

// Simple in-memory rate limiting: max 5 evaluations per IP per 10 minutes
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count++;
  return true;
}

// Prevent concurrent duplicate evaluations of the same proposal
const inFlightEvaluations = new Set<number>();

/**
 * POST /api/proposals/evaluate
 * Body: { proposalId: number }
 *
 * Full governance pipeline:
 * 1. Read proposal from chain (never trusts caller-provided data)
 * 2. Build AI input from onchain data only
 * 3. Call RedPill AI
 * 4. Fetch and verify ECDSA signature
 * 5. Lazy re-attestation: check isTEETrusted — if false, attest and register
 * 6. Submit AI decision onchain
 * 7. If approved + has action, execute the proposal
 */
export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!checkRateLimit(ip)) {
    return NextResponse.json({ error: "Too many requests. Please wait before evaluating another proposal." }, { status: 429 });
  }

  let proposalId: number;

  try {
    const body = await req.json();
    proposalId = body.proposalId;
    if (!proposalId || typeof proposalId !== "number" || !Number.isInteger(proposalId) || proposalId < 1) {
      return NextResponse.json({ error: "proposalId (number) required" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (inFlightEvaluations.has(proposalId)) {
    return NextResponse.json({ error: "This proposal is already being evaluated. Please wait." }, { status: 409 });
  }

  inFlightEvaluations.add(proposalId);
  try {
    const contract = await getGovernanceContract(false); // read-only

    // ── 1. Read proposal from chain — never trust caller-provided data ────
    const [proposal, proposalHash, constitutionHashOnchain, treasuryBalance] = await Promise.all([
      contract.getProposal(proposalId),
      contract.getProposalHash(proposalId),
      contract.constitutionHash(),
      contract.treasuryBalance(),
    ]);

    // Verify local constitution text matches what is stored onchain.
    // If these diverge, the AI would evaluate against the wrong constitution.
    if (LOCAL_CONSTITUTION_HASH.toLowerCase() !== (constitutionHashOnchain as string).toLowerCase()) {
      console.error("Constitution hash mismatch — local text does not match onchain hash.");
      console.error("Local hash:   ", LOCAL_CONSTITUTION_HASH);
      console.error("Onchain hash: ", constitutionHashOnchain);
      throw new Error("Server constitution is out of sync with the deployed contract. Contact the operator.");
    }

    if (Number(proposal.status) !== 0) {
      // 0 = Pending
      return NextResponse.json({ error: "Proposal is not in Pending status" }, { status: 400 });
    }

    // ── 2. Build AI input from onchain data only ──────────────────────────
    const aiInput = {
      proposalId,
      proposalHash: proposalHash as string,
      proposalText: proposal.proposalText as string,
      hasAction: proposal.hasAction as boolean,
      actionTarget: proposal.actionTarget as string,
      actionValue: (proposal.actionValue as bigint).toString(),
      citizen: proposal.citizen as string,
      treasuryBalance: (treasuryBalance as bigint).toString(),
      constitutionHash: constitutionHashOnchain as string,
    };

    // ── 3. Call AI ────────────────────────────────────────────────────────
    console.log(`Evaluating proposal ${proposalId}...`);
    const aiResult = await evaluateProposal(aiInput);

    // ── 4. Fetch RedPill signature ────────────────────────────────────────
    const model = process.env.REDPILL_MODEL || "openai/gpt-oss-120b";
    const sig = await fetchSignatureWithRetry(aiResult.requestId, model);

    // ── 5. Verify request hash locally ───────────────────────────────────
    // (Response hash is taken from sig.text — see signature.ts for explanation)
    verifyHashes(aiResult.requestBodyJson, sig);
    console.log("Hash verification passed");

    // ── 6. Lazy re-attestation — auto-registers TEE if expired or new ─────
    await ensureTEETrusted(sig.signing_address, model);

    // ── 7. Submit decision onchain ────────────────────────────────────────
    const decisionTxHash = await submitAIDecisionOnchain(proposalId, aiResult.output, sig, aiResult.requestBodyJson);

    // ── 8. Execute if approved and has action ─────────────────────────────
    let executionTxHash: string | null = null;
    if (aiResult.output.decision === "approve" && Boolean(proposal.hasAction)) {
      executionTxHash = await executeProposalOnchain(proposalId);
    }

    return NextResponse.json({
      proposalId,
      decision: aiResult.output.decision,
      reasoning: aiResult.output.reasoning,
      constitutional_alignment: aiResult.output.constitutional_alignment,
      risk_flags: aiResult.output.risk_flags,
      decisionTxHash,
      executionTxHash,
      teeSigningAddress: sig.signing_address,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Proposal evaluation failed:", err);
    // Expose a safe subset of error messages to the frontend
    const safeMessage =
      message.startsWith("Proposal is not in") ||
      message.startsWith("Proposal does not exist") ||
      message.startsWith("Too many requests")
        ? message
        : "Proposal evaluation failed. Please try again.";
    return NextResponse.json({ error: safeMessage }, { status: 500 });
  } finally {
    inFlightEvaluations.delete(proposalId);
  }
}
