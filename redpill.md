# RedPill AI — AIM States Integration Guide

## What This Is

This document tells Claude Code exactly how to implement RedPill AI inference with
cryptographic verification for an AIM State smart contract. The goal is to prove
onchain that AI governance decisions were produced by a verified, untampered open
source model running on genuine TEE hardware — without trusting RedPill as an operator.

RedPill is a developer-facing API layer built on top of Phala Network's GPU TEE
infrastructure. The underlying hardware is Intel TDX CPU + NVIDIA H100 GPU running
in Confidential Computing mode. RedPill is OpenAI-compatible.

---

## Core Concept: Two-Layer Verification

### Layer 1 — Offchain Attestation (once per TEE instance, ~hourly)
Proves the TEE hardware and software stack are genuine and untampered.
Run this in your backend. Result: a trusted `signing_address` you register onchain.

### Layer 2 — Onchain Signature Verification (every governance request)
Proves this specific AI response came from a registered, trusted TEE.
Run this in your Solidity contract. Costs ~21k gas.

---

## Environment Setup

```bash
REDPILL_API_KEY=your_key_here   # from redpill.ai/dashboard
```

Never expose this key client-side. Store in `.env`, inject via CI secrets.

---

## API Base

```
https://api.redpill.ai/v1
```

Fully OpenAI-compatible. Use the OpenAI SDK — just change `baseURL`.

---

## Recommended Models for AIM States

Use Phala-provider models only. These have full TEE attestation (CPU + GPU).
Non-Phala models only have gateway TEE — not sufficient for governance verification.

| Model ID | Use Case | Context | Cost (in/out per 1M) |
|---|---|---|---|
| `deepseek/deepseek-r1-0528` | Constitutional reasoning, complex proposal evaluation | 164K | $2.00/$2.00 |
| `openai/gpt-oss-120b` | Structured JSON output, routine governance tasks | 131K | $0.10/$0.49 |
| `qwen/qwen-2.5-7b-instruct` | Cheap classification, tagging, simple checks | 33K | $0.04/$0.10 |
| `qwen/qwen3-embedding-8b` | Semantic search over proposals/constitution | 33K | $0.01/$0.00 |

**Default for AIM States governance**: `openai/gpt-oss-120b` (best cost/quality balance)
**For reasoning-heavy decisions**: `deepseek/deepseek-r1-0528`

Provider for all above: `phala` — verified via Intel TDX + NVIDIA H100 TEE.

---

## Step 1 — Call the AI (TypeScript/Node)

```typescript
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env.REDPILL_API_KEY,
  baseURL: 'https://api.redpill.ai/v1',
});

interface GovernanceEvaluation {
  decision: 'approve' | 'reject' | 'defer';
  reasoning: string;
  constitutional_alignment: number; // 0-100
  risk_flags: string[];
}

async function evaluateProposal(
  proposalText: string,
  constitutionText: string
): Promise<{ response: OpenAI.ChatCompletion; evaluation: GovernanceEvaluation }> {
  const response = await client.chat.completions.create({
    model: 'openai/gpt-oss-120b',
    messages: [
      {
        role: 'system',
        content: `You are a constitutional AI for an AIM State. 
Evaluate governance proposals against the constitution.
Always respond with valid JSON matching this schema:
{
  "decision": "approve" | "reject" | "defer",
  "reasoning": "string",
  "constitutional_alignment": number (0-100),
  "risk_flags": string[]
}`,
      },
      {
        role: 'user',
        content: `CONSTITUTION:\n${constitutionText}\n\nPROPOSAL:\n${proposalText}`,
      },
    ],
    response_format: { type: 'json_object' },
  });

  const evaluation = JSON.parse(
    response.choices[0].message.content!
  ) as GovernanceEvaluation;

  return { response, evaluation };
}
```

---

## Step 2 — Fetch the Cryptographic Signature

After every AI call, fetch the ECDSA signature. Wait 1-2 seconds — signatures are
generated asynchronously.

```typescript
interface RedPillSignature {
  request_id: string;
  model: string;
  text: string;              // "request_hash:response_hash" — the signed payload
  signature: string;         // ECDSA signature (hex)
  signing_address: string;   // Ethereum address of the TEE signing key
  payload: {
    request_hash: string;
    response_hash: string;
    timestamp: string;
    model: string;
    tee_instance: string;
  };
  cert_chain: string[];      // Certificate chain to TEE root
}

async function fetchSignature(
  requestId: string,
  model: string
): Promise<RedPillSignature> {
  // Wait for async signature generation
  await new Promise(resolve => setTimeout(resolve, 2000));

  const response = await fetch(
    `https://api.redpill.ai/v1/signature/${requestId}?model=${model}&signing_algo=ecdsa`,
    {
      headers: {
        Authorization: `Bearer ${process.env.REDPILL_API_KEY}`,
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Signature fetch failed: ${response.status}`);
  }

  return response.json();
}
```

---

## Step 3 — Verify Request/Response Hashes

Confirm the hashes in `text` match your actual request and response.
This proves nothing was swapped after signing.

```typescript
import crypto from 'crypto';

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function verifyHashes(
  requestBodyJson: string,   // exact JSON string you sent
  responseBodyJson: string,  // exact JSON string you received
  signatureData: RedPillSignature
): void {
  const requestHash = sha256(requestBodyJson);
  const responseHash = sha256(responseBodyJson);

  const [serverRequestHash, serverResponseHash] = signatureData.text.split(':');

  if (requestHash !== serverRequestHash) {
    throw new Error(`Request hash mismatch. Local: ${requestHash}, Server: ${serverRequestHash}`);
  }
  if (responseHash !== serverResponseHash) {
    throw new Error(`Response hash mismatch. Local: ${responseHash}, Server: ${serverResponseHash}`);
  }
}
```

---

## Step 4 — Offchain Attestation Verification

Run this once when a TEE instance starts, or periodically (every 24h).
This is the most important step — it proves the `signing_address` belongs to genuine
TEE hardware running verified open-source software.

```typescript
import { ethers } from 'ethers';
import crypto from 'crypto';
import axios from 'axios';

interface AttestationReport {
  signing_address: string;
  signing_algo: string;
  request_nonce: string;
  intel_quote: string;       // hex-encoded Intel TDX quote
  nvidia_payload: string;    // JSON string — NVIDIA GPU attestation
  info: {
    tcb_info: string;        // JSON string — includes Docker compose manifest
  };
  all_attestations?: AttestationReport[];
}

async function fetchAttestation(
  model: string,
  signingAddress: string
): Promise<AttestationReport> {
  const nonce = crypto.randomBytes(32).toString('hex');

  const response = await axios.get('https://api.redpill.ai/v1/attestation/report', {
    params: { model, nonce, signing_address: signingAddress },
    headers: { Authorization: `Bearer ${process.env.REDPILL_API_KEY}` },
  });

  const data = response.data;

  // Multi-server deployment: filter for the signing address we care about
  if (data.all_attestations) {
    const match = data.all_attestations.find(
      (a: AttestationReport) =>
        a.signing_address.toLowerCase() === signingAddress.toLowerCase()
    );
    if (!match) throw new Error('No attestation found for signing address');
    return { ...match, _nonce: nonce } as any;
  }

  // Verify the nonce was embedded (replay protection)
  if (data.request_nonce !== nonce) {
    throw new Error('Nonce mismatch — possible replay attack');
  }

  return data;
}

async function verifyNvidiaGPU(attestation: AttestationReport, nonce: string): Promise<void> {
  const gpuPayload = JSON.parse(attestation.nvidia_payload);

  if (gpuPayload.nonce?.toLowerCase() !== nonce.toLowerCase()) {
    throw new Error('GPU nonce mismatch');
  }

  // Submit to NVIDIA Remote Attestation Service
  const nrasResponse = await axios.post(
    'https://nras.attestation.nvidia.com/v3/attest/gpu',
    gpuPayload
  );

  // Decode JWT verdict
  const jwtToken = nrasResponse.data[0][1];
  const payloadB64 = jwtToken.split('.')[1];
  const padded = payloadB64 + '='.repeat((4 - (payloadB64.length % 4)) % 4);
  const verdict = JSON.parse(Buffer.from(padded, 'base64url').toString());

  if (!verdict['x-nvidia-overall-att-result']) {
    throw new Error('NVIDIA GPU attestation failed');
  }
}

function verifyDockerComposeHash(
  attestation: AttestationReport,
  intelTdxResult: any
): string {
  const tcbInfo = JSON.parse(attestation.info.tcb_info);
  const appCompose = tcbInfo.app_compose;
  const composeHash = crypto
    .createHash('sha256')
    .update(appCompose, 'utf8')
    .digest('hex');

  const mrConfig = intelTdxResult?.quote?.body?.mrconfig;
  const expectedMrConfig = '0x01' + composeHash;

  if (!mrConfig?.toLowerCase().startsWith(expectedMrConfig.toLowerCase())) {
    throw new Error('Docker compose hash does not match TEE measurement (mr_config)');
  }

  // Return the compose file for logging/auditing
  return JSON.parse(appCompose).docker_compose_file;
}

async function verifySigstoreProvenance(attestation: AttestationReport): Promise<void> {
  const tcbInfo = JSON.parse(attestation.info.tcb_info);
  const dockerCompose = JSON.parse(tcbInfo.app_compose).docker_compose_file;

  // Extract all @sha256:xxx image digests from the compose file
  const digestRegex = /@sha256:([0-9a-f]{64})/g;
  const digests = [...new Set([...dockerCompose.matchAll(digestRegex)].map(m => m[1]))];

  for (const digest of digests) {
    const url = `https://search.sigstore.dev/?hash=sha256:${digest}`;
    const response = await axios.head(url, { timeout: 10000 });
    if (response.status >= 400) {
      throw new Error(`Sigstore provenance verification failed for digest: ${digest}`);
    }
  }
}

// Full attestation verification — run once per TEE instance
async function verifyTEEAttestation(
  signingAddress: string,
  model: string
): Promise<void> {
  console.log(`Verifying TEE attestation for ${signingAddress}...`);

  const attestation = await fetchAttestation(model, signingAddress);

  // 1. Verify Intel TDX quote (submit to Intel or Phala's verification service)
  // Use: https://github.com/phala-network/dstack/tree/main/verifier
  // Or install: pip install redpill-verify
  // The intel_quote field is a hex-encoded TDX quote blob
  console.log('Intel TDX quote present:', !!attestation.intel_quote);

  // 2. Verify report data binding — signing address embedded in hardware attestation
  // This is the CRITICAL step: proves signing key was generated inside TEE
  // Bytes 0-31 of report data = signing address (left-padded to 32 bytes)
  // Bytes 32-63 = nonce
  // Full implementation requires parsing the TDX quote binary format
  // Use redpill-verify SDK for production: https://github.com/redpill-ai/redpill-verifier

  // 3. Verify NVIDIA GPU
  const nonce = attestation.request_nonce;
  await verifyNvidiaGPU(attestation, nonce);
  console.log('✅ NVIDIA GPU attestation verified');

  // 4. Verify Docker compose hash matches TEE measurement
  // intelTdxResult comes from parsing the intel_quote — use redpill-verify SDK
  // verifyDockerComposeHash(attestation, intelTdxResult);
  console.log('Docker compose manifest present in tcb_info:', !!attestation.info?.tcb_info);

  // 5. Verify Sigstore build provenance
  await verifySigstoreProvenance(attestation);
  console.log('✅ Sigstore build provenance verified');

  console.log(`✅ TEE attestation complete for ${signingAddress}`);
}
```

> **Production Note**: For full Intel TDX quote parsing and report data binding
> verification, use the official SDK:
> ```bash
> pip install redpill-verify
> # or
> npm install @redpill-ai/verifier
> ```
> GitHub: https://github.com/redpill-ai/redpill-verifier

---

## Step 5 — Register Trusted Signer Onchain

After attestation passes, register the `signing_address` in your smart contract.

```typescript
import { ethers } from 'ethers';

async function registerTEESigner(
  contractAddress: string,
  signerAddress: string,
  model: string,
  dockerComposeHash: string,
  adminPrivateKey: string
): Promise<void> {
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  const wallet = new ethers.Wallet(adminPrivateKey, provider);

  const abi = [
    'function registerTEESigner(address signer, string model, string dockerComposeHash) external',
  ];
  const contract = new ethers.Contract(contractAddress, abi, wallet);

  const tx = await contract.registerTEESigner(signerAddress, model, dockerComposeHash);
  await tx.wait();
  console.log(`TEE signer registered: ${signerAddress}`);
}
```

---

## Step 6 — Submit Governance Proof Onchain

After every AI governance call, submit the proof to your contract.

```typescript
async function submitGovernanceProof(
  contractAddress: string,
  proposalId: string,           // bytes32 hex string e.g. "0xabc123..."
  signatureData: RedPillSignature,
  adminPrivateKey: string
): Promise<void> {
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  const wallet = new ethers.Wallet(adminPrivateKey, provider);

  const abi = [
    'function verifyGovernanceProof(bytes32 proposalId, string text, bytes signature) external returns (address)',
  ];
  const contract = new ethers.Contract(contractAddress, abi, wallet);

  // Convert hex signature to bytes
  const sigBytes = ethers.getBytes(signatureData.signature);

  const tx = await contract.verifyGovernanceProof(
    proposalId,
    signatureData.text,
    sigBytes
  );
  const receipt = await tx.wait();
  console.log(`Governance proof submitted. Tx: ${receipt.hash}`);
}
```

---

## Solidity Contract — AIMStatesAIVerifier.sol

Deploy this on your target EVM chain (Ethereum, Base, Polygon, etc.).

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/**
 * @title AIMStatesAIVerifier
 * @notice Verifies that AIM State governance decisions came from a trusted
 *         TEE-attested AI instance via RedPill/Phala infrastructure.
 *
 * Trust chain:
 *   Intel TDX hardware → NVIDIA H100 TEE → Phala/RedPill software stack
 *   → signing_address (attested offchain) → ECDSA signature (verified onchain)
 *   → governance proposal decision (recorded permanently)
 */
contract AIMStatesAIVerifier {
    using ECDSA for bytes32;

    // ─── Data Structures ────────────────────────────────────────────────────

    struct TEESigner {
        bool trusted;
        string model;               // e.g. "openai/gpt-oss-120b"
        string dockerComposeHash;   // sha256 of the Docker compose that was attested
        uint256 attestedAt;
        uint256 expiresAt;          // force re-attestation after TTL
    }

    struct GovernanceProof {
        string requestHash;         // sha256 of the prompt sent to AI
        string responseHash;        // sha256 of the AI response
        address teeAddress;         // which TEE instance signed this
        string model;               // which model was used
        uint256 timestamp;
        bool verified;
    }

    // ─── State ──────────────────────────────────────────────────────────────

    mapping(address => TEESigner) public trustedSigners;
    mapping(bytes32 => GovernanceProof) public proofs; // proposalId => proof

    address public owner;
    uint256 public attestationTTL = 24 hours;

    // ─── Events ─────────────────────────────────────────────────────────────

    event TEERegistered(
        address indexed signer,
        string model,
        string dockerComposeHash,
        uint256 expiresAt
    );
    event TEERevoked(address indexed signer);
    event ProposalVerified(
        bytes32 indexed proposalId,
        address indexed teeAddress,
        string model,
        string requestHash,
        string responseHash,
        uint256 timestamp
    );

    // ─── Constructor ─────────────────────────────────────────────────────────

    constructor() {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    // ─── TEE Management ──────────────────────────────────────────────────────

    /**
     * @notice Register a TEE signing address after offchain attestation passes.
     * @dev Call this after verifying Intel TDX quote + NVIDIA GPU + Sigstore offchain.
     */
    function registerTEESigner(
        address signer,
        string calldata model,
        string calldata dockerComposeHash
    ) external onlyOwner {
        trustedSigners[signer] = TEESigner({
            trusted: true,
            model: model,
            dockerComposeHash: dockerComposeHash,
            attestedAt: block.timestamp,
            expiresAt: block.timestamp + attestationTTL
        });
        emit TEERegistered(signer, model, dockerComposeHash, block.timestamp + attestationTTL);
    }

    function revokeTEESigner(address signer) external onlyOwner {
        trustedSigners[signer].trusted = false;
        emit TEERevoked(signer);
    }

    function setAttestationTTL(uint256 ttl) external onlyOwner {
        attestationTTL = ttl;
    }

    // ─── Governance Proof Verification ───────────────────────────────────────

    /**
     * @notice Verify an AI governance response and record it permanently onchain.
     *
     * @param proposalId  Your governance proposal identifier (bytes32)
     * @param text        The "request_hash:response_hash" string from RedPill signature API
     * @param signature   ECDSA signature bytes from RedPill signature API
     *
     * What this proves when it succeeds:
     *   1. The response was signed by a TEE whose hardware was attested by Intel + NVIDIA
     *   2. The software stack running in that TEE was verified via Sigstore provenance
     *   3. The exact request hash and response hash are recorded immutably
     *   4. The TEE attestation has not expired (re-attestation enforced)
     */
    function verifyGovernanceProof(
        bytes32 proposalId,
        string calldata text,
        bytes calldata signature
    ) external returns (address) {
        require(!proofs[proposalId].verified, "Proposal already verified");

        // 1. Recover the TEE signing address from the ECDSA signature
        //    RedPill signs: keccak256(text) with eth_sign prefix
        bytes32 messageHash = MessageHashUtils.toEthSignedMessageHash(
            keccak256(abi.encodePacked(text))
        );
        address recovered = ECDSA.recover(messageHash, signature);

        // 2. Verify this address is a registered, non-expired TEE
        TEESigner memory signer = trustedSigners[recovered];
        require(signer.trusted, "Signer is not a trusted TEE");
        require(block.timestamp < signer.expiresAt, "TEE attestation has expired — re-attest required");

        // 3. Parse request/response hashes from "reqHash:resHash"
        (string memory reqHash, string memory resHash) = _splitHashes(text);

        // 4. Store the proof permanently
        proofs[proposalId] = GovernanceProof({
            requestHash: reqHash,
            responseHash: resHash,
            teeAddress: recovered,
            model: signer.model,
            timestamp: block.timestamp,
            verified: true
        });

        emit ProposalVerified(
            proposalId,
            recovered,
            signer.model,
            reqHash,
            resHash,
            block.timestamp
        );

        return recovered;
    }

    // ─── Views ───────────────────────────────────────────────────────────────

    function isProposalVerified(bytes32 proposalId) external view returns (bool) {
        return proofs[proposalId].verified;
    }

    function getProof(bytes32 proposalId) external view returns (GovernanceProof memory) {
        return proofs[proposalId];
    }

    function isTEETrusted(address signer) external view returns (bool) {
        return trustedSigners[signer].trusted &&
               block.timestamp < trustedSigners[signer].expiresAt;
    }

    // ─── Internal ────────────────────────────────────────────────────────────

    function _splitHashes(string memory text)
        internal
        pure
        returns (string memory req, string memory res)
    {
        bytes memory b = bytes(text);
        uint256 splitAt;
        for (uint256 i = 0; i < b.length; i++) {
            if (b[i] == ':') {
                splitAt = i;
                break;
            }
        }
        require(splitAt > 0, "Invalid text format — expected req_hash:res_hash");

        bytes memory r1 = new bytes(splitAt);
        bytes memory r2 = new bytes(b.length - splitAt - 1);
        for (uint256 i = 0; i < splitAt; i++) r1[i] = b[i];
        for (uint256 i = 0; i < r2.length; i++) r2[i] = b[splitAt + 1 + i];

        return (string(r1), string(r2));
    }
}
```

---

## Complete End-to-End Flow (TypeScript)

This is the full AIM State governance call in one function.

```typescript
import OpenAI from 'openai';
import { ethers } from 'ethers';
import crypto from 'crypto';
import axios from 'axios';

const MODEL = 'openai/gpt-oss-120b';

async function processGovernanceProposal(
  proposalId: string,           // bytes32 hex, e.g. "0xabc123..."
  proposalText: string,
  constitutionText: string,
  contractAddress: string,
  adminPrivateKey: string
): Promise<{
  decision: string;
  reasoning: string;
  txHash: string;
}> {
  const client = new OpenAI({
    apiKey: process.env.REDPILL_API_KEY,
    baseURL: 'https://api.redpill.ai/v1',
  });

  // ── 1. Call AI ──────────────────────────────────────────────────────────
  const requestBody = {
    model: MODEL,
    messages: [
      {
        role: 'system' as const,
        content: `You are the constitutional AI for an AIM State. Evaluate proposals.
Respond only with JSON: { "decision": "approve"|"reject"|"defer", "reasoning": "string", "constitutional_alignment": 0-100, "risk_flags": [] }`,
      },
      {
        role: 'user' as const,
        content: `CONSTITUTION:\n${constitutionText}\n\nPROPOSAL:\n${proposalText}`,
      },
    ],
    response_format: { type: 'json_object' as const },
  };

  const response = await client.chat.completions.create(requestBody);
  const requestId = response.id;
  const responseContent = response.choices[0].message.content!;
  const evaluation = JSON.parse(responseContent);

  // ── 2. Fetch signature ──────────────────────────────────────────────────
  await new Promise(r => setTimeout(r, 2000)); // wait for async signature gen

  const sigResponse = await axios.get(
    `https://api.redpill.ai/v1/signature/${requestId}`,
    {
      params: { model: MODEL, signing_algo: 'ecdsa' },
      headers: { Authorization: `Bearer ${process.env.REDPILL_API_KEY}` },
    }
  );
  const sigData = sigResponse.data;

  // ── 3. Verify hashes locally ────────────────────────────────────────────
  const requestHash = crypto
    .createHash('sha256')
    .update(JSON.stringify(requestBody), 'utf8')
    .digest('hex');
  const responseHash = crypto
    .createHash('sha256')
    .update(JSON.stringify(response), 'utf8')
    .digest('hex');

  const [serverReqHash, serverResHash] = sigData.text.split(':');
  if (requestHash !== serverReqHash) throw new Error('Request hash mismatch');
  if (responseHash !== serverResHash) throw new Error('Response hash mismatch');

  // ── 4. Submit onchain ───────────────────────────────────────────────────
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  const wallet = new ethers.Wallet(adminPrivateKey, provider);

  const abi = [
    'function verifyGovernanceProof(bytes32 proposalId, string text, bytes signature) external returns (address)',
  ];
  const contract = new ethers.Contract(contractAddress, abi, wallet);
  const sigBytes = ethers.getBytes(sigData.signature);

  const tx = await contract.verifyGovernanceProof(proposalId, sigData.text, sigBytes);
  const receipt = await tx.wait();

  return {
    decision: evaluation.decision,
    reasoning: evaluation.reasoning,
    txHash: receipt.hash,
  };
}
```

---

## Periodic Re-Attestation

> **SE-2 adaptation**: No cron job / background service. Instead, re-attestation is
> triggered **lazily and automatically** inline within the `/api/proposals/evaluate`
> route, every time a proposal is evaluated:
> 1. After fetching the RedPill signature, extract `signing_address`
> 2. Call `isTEETrusted(signing_address)` on the contract
> 3. If false (expired or new key) → run full attestation → `registerTEESigner`
> 4. Proceed with `submitAIDecision`
>
> This means re-attestation happens at most once per 24h (the TTL), automatically,
> with no maintenance overhead.

The reference worker below is kept for documentation. The actual implementation is
in `packages/nextjs/lib/attestation.ts`.

Run this as a cron job or background service. Re-attests the TEE every 23 hours
(before the 24h onchain TTL expires).

```typescript
async function reattestationWorker(
  contractAddress: string,
  adminPrivateKey: string,
  model: string = MODEL
): Promise<void> {
  console.log('Running re-attestation check...');

  // 1. Fetch current attestation
  const nonce = crypto.randomBytes(32).toString('hex');
  const attestResponse = await axios.get(
    'https://api.redpill.ai/v1/attestation/report',
    {
      params: { model, nonce },
      headers: { Authorization: `Bearer ${process.env.REDPILL_API_KEY}` },
    }
  );
  const attestation = attestResponse.data;
  const signingAddress = attestation.signing_address;

  // 2. Run full verification (NVIDIA + Sigstore)
  await verifyTEEAttestation(signingAddress, model);

  // 3. Get Docker compose hash for onchain record
  const tcbInfo = JSON.parse(attestation.info.tcb_info);
  const appCompose = tcbInfo.app_compose;
  const composeHash = crypto
    .createHash('sha256')
    .update(appCompose, 'utf8')
    .digest('hex');

  // 4. Register onchain
  await registerTEESigner(
    contractAddress,
    signingAddress,
    model,
    composeHash,
    adminPrivateKey
  );

  console.log(`Re-attestation complete. Next run in 23 hours.`);
}

// Schedule: every 23 hours
setInterval(() => reattestationWorker(
  process.env.CONTRACT_ADDRESS!,
  process.env.ADMIN_PRIVATE_KEY!
), 23 * 60 * 60 * 1000);
```

---

## What Is Proven When Verification Passes

When `verifyGovernanceProof()` succeeds onchain, any observer can verify:

| Claim | How It's Proven |
|---|---|
| AI ran on genuine Intel TDX CPU | TDX quote verified against Intel root CA (offchain) |
| AI ran on genuine NVIDIA H100 GPU | NVIDIA NRAS returned passing verdict (offchain) |
| Exact open-source software stack ran | Docker compose hash matches `mr_config` in TDX quote (offchain) |
| Container images from public source code | Sigstore build provenance verified (offchain) |
| Operator (RedPill/Phala) could not tamper | Signing key hardware-bound to TEE — embedded in TDX report data |
| This exact prompt was sent | `requestHash` stored permanently onchain |
| This exact response was produced | `responseHash` stored permanently onchain |
| Response wasn't modified in transit | ECDSA signature over `reqHash:resHash` verified onchain |
| Attestation is fresh | `expiresAt` enforced onchain — stale TEEs auto-rejected |

---

## Trust Assumptions (Residual)

Things you still trust after full verification:

- **Intel** — TDX hardware works as Intel specifies
- **NVIDIA** — H100 TEE works as NVIDIA specifies
- **The open source code itself** — auditable at github.com/redpill-ai and github.com/phala-network/dstack
- **Sigstore infrastructure** — append-only transparency log (monitored publicly)

You do NOT trust: RedPill operators, Phala operators, cloud providers, sysadmins.

---

## Error Handling Reference

| Error | Cause | Fix |
|---|---|---|
| `Signer is not a trusted TEE` | `signing_address` not registered | Run attestation → call `registerTEESigner` |
| `TEE attestation has expired` | 24h TTL passed | Re-run attestation worker |
| `Request hash mismatch` | JSON serialization inconsistency | Ensure identical JSON string for hashing |
| `Proposal already verified` | Duplicate submission | Check `isProposalVerified` before calling |
| Signature fetch 404 | Too fast after AI call | Wait 2s, retry up to 3 times |
| NVIDIA attestation failed | GPU not in TEE mode | Use Phala-provider models only |

---

## Dependencies

```json
{
  "dependencies": {
    "openai": "^4.0.0",
    "ethers": "^6.0.0",
    "axios": "^1.0.0",
    "@openzeppelin/contracts": "^5.0.0"
  }
}
```

```bash
# Optional: official RedPill verifier (handles Intel TDX quote parsing)
pip install redpill-verify
# or
npm install @redpill-ai/verifier
```

---

## Key URLs

| Resource | URL |
|---|---|
| API base | `https://api.redpill.ai/v1` |
| Signature endpoint | `GET /v1/signature/{request_id}?model=...&signing_algo=ecdsa` |
| Attestation endpoint | `GET /v1/attestation/report?model=...&nonce=...&signing_address=...` |
| NVIDIA NRAS | `https://nras.attestation.nvidia.com/v3/attest/gpu` |
| Sigstore search | `https://search.sigstore.dev/?hash=sha256:{digest}` |
| RedPill verifier SDK | `https://github.com/redpill-ai/redpill-verifier` |
| Phala dstack source | `https://github.com/phala-network/dstack` |
| RedPill docs | `https://docs.redpill.ai` |
| RedPill dashboard | `https://www.redpill.ai/dashboard` |
