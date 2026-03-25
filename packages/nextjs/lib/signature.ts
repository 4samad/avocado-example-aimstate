// Server-only — never import this in client components
import axios from "axios";
import crypto from "crypto";

export type RedPillSignature = {
  text: string; // "sha256_request_hex:sha256_response_hex" — the signed payload
  signature: string; // ECDSA signature hex
  signing_address: string; // Ethereum address of TEE key
  signing_algo: string;
};

export function sha256Hex(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

export async function fetchSignatureWithRetry(
  requestId: string,
  model: string,
  maxAttempts = 5,
): Promise<RedPillSignature> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await new Promise(r => setTimeout(r, attempt * 1500)); // exponential backoff
    try {
      const res = await axios.get(`https://api.redpill.ai/v1/signature/${requestId}`, {
        params: { model, signing_algo: "ecdsa" },
        headers: { Authorization: `Bearer ${process.env.REDPILL_API_KEY}` },
      });
      return res.data as RedPillSignature;
    } catch (err: unknown) {
      if (attempt === maxAttempts) throw err;
      console.warn(`Signature fetch attempt ${attempt} failed, retrying...`);
    }
  }
  throw new Error("Failed to fetch signature after max attempts");
}

/**
 * Verify the signature covers our actual request.
 * RedPill's text field is "sha256(requestBody):sha256(responseBody)".
 *
 * We verify only the request hash because the gateway wraps the TEE's raw inference
 * response before delivering it to us, making the response bytes we receive differ from
 * what the TEE signed. The TEE's response hash is still committed onchain via sig.text.
 */
export function verifyHashes(requestBodyJson: string, sig: RedPillSignature): void {
  const localRequestHash = sha256Hex(requestBodyJson);
  const [serverRequestHash] = sig.text.split(":");

  if (localRequestHash !== serverRequestHash) {
    throw new Error(`Request hash mismatch.\nLocal:  ${localRequestHash}\nServer: ${serverRequestHash}`);
  }
}

/**
 * Extract the response hash directly from the TEE-signed text field.
 * Used for onchain submission since we cannot recompute it from the HTTP response.
 */
export function extractResponseHash(sig: RedPillSignature): string {
  const parts = sig.text.split(":");
  if (parts.length !== 2) throw new Error("Unexpected sig.text format");
  return parts[1];
}
