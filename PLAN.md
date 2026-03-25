# Build Plan — Example AIM State

## Overview

Governance dApp where citizens submit proposals, a verifiable AI (RedPill/Phala TEE)
evaluates them against the constitution, and approved proposals auto-execute onchain.
No human voting. No multisig.

Built on Scaffold-ETH 2 (Hardhat flavor).

---

## Architecture

```
packages/hardhat/
  contracts/
    ExampleAIMState.sol         ← single governance contract
  deploy/
    00_deploy_example_aim_state.ts

packages/nextjs/
  app/
    page.tsx                    ← dashboard (citizens, treasury, join)
    proposals/
      page.tsx                  ← proposal list
      new/page.tsx              ← submit proposal form
      [id]/page.tsx             ← proposal detail + AI proof
    api/
      proposals/
        evaluate/route.ts       ← POST: read proposal → call AI → verify → submit onchain
  lib/
    constitution.ts             ← CONSTITUTION string constant
    ai.ts                       ← RedPill AI call (server-only)
    signature.ts                ← fetch + verify RedPill ECDSA signature
    attestation.ts              ← TEE attestation verification + onchain registration
    contract-server.ts          ← ethers.js contract writes (server-only)
```

---

## SE-2 Adaptations (vs. original spec)

| Spec | This build | Reason |
|---|---|---|
| Standalone Express.js backend | Next.js API routes | SE-2 monorepo, no extra server |
| Raw wagmi hooks | `useScaffoldReadContract` / `useScaffoldWriteContract` | SE-2 standard |
| "No component library" | DaisyUI | Already configured in SE-2 |
| Raw ethers.js deploy script | hardhat-deploy plugin format | SE-2 standard |
| Manual `lib/contract.ts` ABI | Auto-generated `deployedContracts.ts` | SE-2 auto-generates on deploy |
| Separate Express cron for re-attestation | Lazy inline re-attestation | See below |
| `chains.hardhat` only | + Sepolia configured | Easy testnet deploy |

### Re-attestation Strategy

No cron job. Fully automatic, inline with every governance call:

```
evaluate route:
  1. Call RedPill AI → get response + signing_address from signature
  2. Check isTEETrusted(signing_address) on contract
  3. If NOT trusted → run full TEE attestation → registerTEESigner(signing_address)
  4. Submit submitAIDecision onchain
```

Re-attestation happens at most once per 24h (the onchain TTL), or whenever RedPill
rotates its signing key. Zero maintenance overhead.

### Proposal ID from Receipt

Parse `ProposalSubmitted(uint256 indexed proposalId, ...)` event from the viem
`writeContractAsync` tx receipt — no backend endpoint needed for this.

```typescript
// viem decodes logs automatically with the ABI
const receipt = await waitForTransactionReceipt(...)
const log = parseEventLogs({ abi: ABI, logs: receipt.logs, eventName: 'ProposalSubmitted' })[0]
const proposalId = log.args.proposalId
```

---

## Build Phases

### Phase 1 — Cleanup + Config
- [ ] Delete `YourContract.sol`
- [ ] Delete `00_deploy_your_contract.ts`
- [ ] Clear boilerplate home page
- [ ] Add Sepolia to `scaffold.config.ts`
- [ ] Add `openai`, `axios` deps to nextjs package
- [ ] Add `.env.local.example`

### Phase 2 — Smart Contract
- [ ] `ExampleAIMState.sol` (from spec — full contract)
- [ ] `00_deploy_example_aim_state.ts` (hardhat-deploy format, hashes constitution)

### Phase 3 — Backend (API Routes)
- [ ] `lib/constitution.ts` — CONSTITUTION string
- [ ] `lib/ai.ts` — evaluateProposal (RedPill call, strict JSON, validate fields)
- [ ] `lib/signature.ts` — fetchSignatureWithRetry, verifyHashes
- [ ] `lib/attestation.ts` — verifyTEEAttestation, auto-register if expired
- [ ] `lib/contract-server.ts` — submitAIDecisionOnchain, executeProposalOnchain
- [ ] `app/api/proposals/evaluate/route.ts` — full governance pipeline

### Phase 4 — Frontend
- [ ] `app/page.tsx` — dashboard: citizen count, treasury, join button, nav
- [ ] `app/proposals/page.tsx` — list all proposals (from events), status badges
- [ ] `app/proposals/new/page.tsx` — submit form, parse proposalId from receipt, trigger AI
- [ ] `app/proposals/[id]/page.tsx` — detail: proposal text, AI decision, TEE proof

### Phase 5 — Navbar + Layout
- [ ] Update SE-2 header with correct nav links
- [ ] Remove SE-2 default nav items (faucet link etc.)

---

## Environment Variables

### `packages/nextjs/.env.local`
```bash
# RedPill
REDPILL_API_KEY=                    # server-only (no NEXT_PUBLIC_ prefix)
REDPILL_MODEL=openai/gpt-oss-120b

# Chain (for server-side contract writes)
RPC_URL=                            # local: http://127.0.0.1:8545
ADMIN_PRIVATE_KEY=                  # deployer wallet — server-only

# Contract (auto-set after deploy for local, manual for testnet)
CONTRACT_ADDRESS=                   # ExampleAIMState deployed address

# Frontend
NEXT_PUBLIC_BACKEND_URL=http://localhost:3000   # same origin in dev
```

### `packages/hardhat/.env`
```bash
DEPLOYER_PRIVATE_KEY=               # only needed for testnet deploy
ALCHEMY_API_KEY=
```

---

## Security Invariants (from spec)

1. Backend reads ALL proposal data from chain — never from request body
2. `temperature: 0` on every AI call — deterministic
3. Signature retries with exponential backoff
4. `verifyHashes` runs before any onchain submission
5. Auto re-attestation: check `isTEETrusted` before submitting, attest if needed
6. `executeProposal` uses stored proposal values only — no calldata parameters
7. `nonReentrant` on both `submitAIDecision` and `executeProposal`
8. `REDPILL_API_KEY` and `ADMIN_PRIVATE_KEY` are never `NEXT_PUBLIC_`

---

## Known Limitations / TODOs in v1

- Full Intel TDX quote binary parsing delegated to `redpill-verify` SDK (not implemented here)
- `verifyDockerComposeHash` skipped (requires parsed TDX quote)
- Proposal list uses event history — no pagination for now
- No owner admin panel for updating model/constitution (use debug page or scripts)
- Proposal cooldown UI indicator not shown
