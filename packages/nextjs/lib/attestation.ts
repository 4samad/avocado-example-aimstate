// Server-only — never import this in client components
//
// Lazy re-attestation: called inline within the evaluate API route whenever
// isTEETrusted(signing_address) returns false (expired or new TEE key).
// This means re-attestation is automatic and happens at most once per 24h TTL.
import { getGovernanceContract } from "./contract-server";
import axios from "axios";
import crypto from "crypto";

type AttestationReport = {
  signing_address: string;
  signing_algo: string;
  request_nonce: string;
  intel_quote: string; // hex-encoded Intel TDX quote
  nvidia_payload: string; // JSON string — NVIDIA GPU attestation
  info: {
    tcb_info: string; // JSON string — includes Docker compose manifest
  };
  all_attestations?: AttestationReport[];
};

async function fetchAttestation(
  model: string,
  signingAddress: string,
): Promise<AttestationReport & { _nonce: string }> {
  const nonce = crypto.randomBytes(32).toString("hex");

  const response = await axios.get("https://api.redpill.ai/v1/attestation/report", {
    params: { model, nonce, signing_address: signingAddress },
    headers: { Authorization: `Bearer ${process.env.REDPILL_API_KEY}` },
  });

  const data = response.data;

  // Multi-server deployment: filter for the signing address we care about
  if (data.all_attestations) {
    const match = data.all_attestations.find(
      (a: AttestationReport) => a.signing_address.toLowerCase() === signingAddress.toLowerCase(),
    );
    if (!match) throw new Error("No attestation found for signing address");
    return { ...match, _nonce: nonce };
  }

  if (data.request_nonce !== nonce) {
    throw new Error("Nonce mismatch — possible replay attack");
  }

  return { ...data, _nonce: nonce };
}

function parseIfString(value: unknown): unknown {
  return typeof value === "string" ? JSON.parse(value) : value;
}

async function verifyNvidiaGPU(attestation: AttestationReport, nonce: string): Promise<void> {
  const gpuPayload = parseIfString(attestation.nvidia_payload) as Record<string, unknown>;

  if ((gpuPayload.nonce as string)?.toLowerCase() !== nonce.toLowerCase()) {
    throw new Error("GPU nonce mismatch");
  }

  const nrasResponse = await axios.post("https://nras.attestation.nvidia.com/v3/attest/gpu", gpuPayload);

  const jwtToken = nrasResponse.data[0][1];
  const payloadB64 = jwtToken.split(".")[1];
  const padded = payloadB64 + "=".repeat((4 - (payloadB64.length % 4)) % 4);
  const verdict = JSON.parse(Buffer.from(padded, "base64url").toString());

  if (!verdict["x-nvidia-overall-att-result"]) {
    throw new Error("NVIDIA GPU attestation failed");
  }
}

async function verifySigstoreProvenance(attestation: AttestationReport): Promise<void> {
  const tcbInfo = parseIfString(attestation.info.tcb_info) as Record<string, unknown>;
  const appCompose = parseIfString(tcbInfo.app_compose) as Record<string, unknown>;
  const dockerCompose = appCompose.docker_compose_file as string;

  const digestRegex = /@sha256:([0-9a-f]{64})/g;
  const digests = [...new Set([...dockerCompose.matchAll(digestRegex)].map((m: RegExpMatchArray) => m[1]))];

  for (const digest of digests) {
    const url = `https://search.sigstore.dev/?hash=sha256:${digest}`;
    const response = await axios.head(url, { timeout: 10000 });
    if (response.status >= 400) {
      throw new Error(`Sigstore provenance verification failed for digest: ${digest}`);
    }
  }
}

const PHALA_TDX_VERIFIER_API = "https://cloud-api.phala.network/api/v1/attestations/verify";

async function verifyIntelTDXQuote(
  attestation: AttestationReport,
  nonce: string,
  signingAddress: string,
): Promise<void> {
  if (!attestation.intel_quote) {
    throw new Error("Intel TDX quote missing from attestation report");
  }

  const response = await axios.post(PHALA_TDX_VERIFIER_API, { hex: attestation.intel_quote }, { timeout: 30000 });
  const intelResult = response.data as {
    quote?: {
      verified?: boolean;
      body?: { reportdata?: string; mrconfig?: string };
    };
    message?: string;
  };

  if (!intelResult?.quote?.verified) {
    throw new Error(`Intel TDX quote verification failed: ${intelResult?.message ?? "unknown error"}`);
  }

  const reportDataHex = intelResult.quote.body?.reportdata ?? "";
  if (!reportDataHex) {
    throw new Error("Intel TDX quote response missing reportdata field");
  }
  const reportData = Buffer.from(reportDataHex.replace(/^0x/, ""), "hex");

  // Verify signing address is embedded in report data.
  // RedPill/Phala convention: address is left-padded to 32 bytes (ABI style),
  // so bytes 12–31 are the raw 20-byte address, bytes 0–11 are zeros.
  const rawAddressBytes = Buffer.from(signingAddress.replace(/^0x/i, "").toLowerCase(), "hex"); // 20 bytes
  const leftPaddedMatch = reportData.subarray(12, 32).equals(rawAddressBytes);
  const rightPaddedMatch = reportData.subarray(0, 20).equals(rawAddressBytes);
  if (!leftPaddedMatch && !rightPaddedMatch) {
    console.error("TDX reportdata (hex):", reportDataHex);
    console.error("Expected address bytes:", rawAddressBytes.toString("hex"));
    console.error("reportdata[0..20]:", reportData.subarray(0, 20).toString("hex"));
    console.error("reportdata[12..32]:", reportData.subarray(12, 32).toString("hex"));
    throw new Error("TDX report data does not bind the signing address — possible key substitution attack");
  }
  console.log("TDX address binding:", leftPaddedMatch ? "left-padded" : "right-aligned");

  // Verify nonce is embedded in report data (bytes 32–63, raw 32-byte nonce)
  const nonceBytes = Buffer.from(nonce, "hex");
  if (!reportData.subarray(32, 64).equals(nonceBytes)) {
    console.error("TDX reportdata nonce bytes:", reportData.subarray(32, 64).toString("hex"));
    console.error("Expected nonce bytes:", nonceBytes.toString("hex"));
    throw new Error("TDX report data does not embed the request nonce — possible replay attack");
  }

  // Verify Docker compose hash matches mr_config (proves the exact code running)
  const tcbInfo = parseIfString(attestation.info.tcb_info) as Record<string, unknown>;
  const appComposeRaw = tcbInfo.app_compose as string;
  const composeHash = crypto.createHash("sha256").update(appComposeRaw, "utf8").digest("hex");
  const expectedMrConfig = "0x01" + composeHash;
  const mrConfig = (intelResult.quote.body?.mrconfig ?? "").toLowerCase();

  if (!mrConfig.startsWith(expectedMrConfig.toLowerCase())) {
    throw new Error(
      `TDX mr_config mismatch — running code does not match attested Docker compose.\nExpected prefix: ${expectedMrConfig}\nGot: ${mrConfig}`,
    );
  }

  console.log("Intel TDX quote verified");
  console.log("TDX report data binds signing address: true");
  console.log("TDX report data embeds request nonce: true");
  console.log("TDX mr_config matches compose hash: true");
}

/**
 * Full TEE attestation verification.
 * - Verifies Intel TDX quote via Phala verification service
 * - Verifies report data binds signing address and nonce
 * - Verifies NVIDIA GPU attestation via NRAS
 * - Verifies Sigstore build provenance for all Docker image digests
 */
async function verifyTEEAttestation(signingAddress: string, model: string): Promise<void> {
  console.log(`Verifying TEE attestation for ${signingAddress}...`);

  const attestation = await fetchAttestation(model, signingAddress);
  const nonce = attestation._nonce;

  // 1. Verify Intel TDX quote (quote validity + signing key binding + compose hash)
  await verifyIntelTDXQuote(attestation, nonce, signingAddress);

  // 2. Verify NVIDIA GPU
  await verifyNvidiaGPU(attestation, nonce);
  console.log("NVIDIA GPU attestation verified");

  // 3. Verify Sigstore build provenance
  await verifySigstoreProvenance(attestation);
  console.log("Sigstore build provenance verified");

  console.log(`TEE attestation complete for ${signingAddress}`);
}

/**
 * Check if the TEE signer is trusted onchain. If not (expired or new key),
 * run full attestation and register the signer.
 *
 * This is the lazy re-attestation strategy: no cron job needed.
 * Called inline before every submitAIDecision.
 */
export async function ensureTEETrusted(signingAddress: string, model: string): Promise<void> {
  const contract = await getGovernanceContract();

  const isTrusted: boolean = await contract.isTEETrusted(signingAddress);
  if (isTrusted) return;

  console.log(`TEE ${signingAddress} not trusted or expired — running attestation...`);

  await verifyTEEAttestation(signingAddress, model);

  const tx = await contract.registerTEESigner(signingAddress, model);
  await tx.wait();
  console.log(`TEE signer registered onchain: ${signingAddress}`);
}
