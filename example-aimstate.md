# Example AIM State — Build Specification

## What This Document Is

This is the complete specification for Claude Code to build the Example AIM State dApp.
Read this entire document before writing a single line of code.
Also read `redpill.md` in this repo — it covers the AI verification layer in full detail.

Do not hallucinate any API, contract method, or library that is not explicitly specified here.
If something is ambiguous, implement the simpler interpretation and leave a TODO comment.

---

## Project Overview

The Example AIM State is a governance system where:
- Anyone can join as a citizen
- Citizens can submit proposals (with or without an onchain action to execute)
- An AI (via RedPill) evaluates each proposal against the state constitution
- The AI decision is cryptographically verified onchain (see redpill.md)
- If the proposal includes an onchain action and the AI approves it, the action executes automatically
- No human voting. No multisig. The verifiable AI is the decision-maker.
- The owner (deployer) can update the AI model string and the constitution text

The state is focused on **equality** — its constitution reflects this value.

---

## Constitution

Store this exactly as a string constant in the smart contract and in the backend.
The backend passes this verbatim as part of every AI prompt.
The contract stores a keccak256 hash of it so proposals can be verified against
the correct constitution version.

```
CONSTITUTION OF THE EXAMPLE AIM STATE

Preamble
We, the citizens of the Example AIM State, establish this constitution to build
a society grounded in equality — equal dignity, equal opportunity, and equal
standing before the governance system — for every person who joins this state.

Article I — Citizenship
Section 1. Any person may become a citizen of the Example AIM State by registering
their Ethereum address. Citizenship is open to all without discrimination based on
identity, origin, belief, or background.
Section 2. Every citizen holds equal standing in the governance system. No citizen
has more inherent weight or authority than any other.
Section 3. Citizenship may not be revoked except by the citizen's own choice to
leave the state.

Article II — The Treasury
Section 1. The state treasury is held in ETH in the governance smart contract.
Section 2. Treasury funds exist to serve the collective wellbeing and individual
needs of citizens. Funds shall not be used to enrich any party disproportionately
or in ways that undermine equality.
Section 3. Any citizen may propose a treasury disbursement. The AI shall evaluate
whether the proposed use genuinely serves need and is consistent with equality.
Section 4. No single proposal may request more than 10% of the current treasury
balance. This protects against depletion by any single actor.
Section 5. Repeated disbursement requests from the same citizen within 30 days
shall be evaluated with heightened scrutiny.

Article III — Proposals
Section 1. Any citizen may submit a proposal at any time. Proposals must be written
in good faith and describe a genuine need, initiative, or change to the state.
Section 2. Proposals are evaluated by the AI governance system against this
constitution. The AI decision is final and executed automatically onchain.
Section 3. Proposals that request onchain actions (such as ETH transfers) must
specify the exact recipient address and amount in structured form so the contract
can verify the AI approved the exact action being executed.
Section 4. Proposals that promote discrimination, harassment, or inequality of
any kind shall be rejected.
Section 5. Proposals that seek to concentrate power, resources, or influence
disproportionately shall be rejected.

Article IV — AI Governance
Section 1. The AI evaluating proposals must be verifiably running open-source
software on hardware-attested TEE infrastructure. Citizens may independently
verify this at any time using the attestation data stored onchain.
Section 2. The AI decision for every proposal is recorded permanently onchain
including the hash of the exact prompt sent and the exact response received.
This ensures full auditability.
Section 3. The owner of the contract may update the AI model used for governance.
Any model change takes effect only for proposals submitted after the change.
Section 4. The owner may update the constitution. Proposals submitted before a
constitution change are evaluated against the constitution that was active at
the time of submission.

Article V — Equality Principles
Section 1. Equal need is a valid basis for resource allocation. A citizen with
a genuine financial need has a valid claim on the treasury regardless of their
background or history with the state.
Section 2. The AI shall apply the same standard to every proposal regardless of
who submitted it.
Section 3. Actions that would result in one citizen or group of citizens having
substantially more power or resources than others shall require exceptionally
strong justification and shall be viewed with suspicion by the AI.
```

---

## Tech Stack

> **SE-2 adaptation**: This is built on Scaffold-ETH 2 (Hardhat flavor). See `PLAN.md`
> for a full mapping of spec→SE-2 adaptations.

### Smart Contracts
- Solidity ^0.8.20
- OpenZeppelin Contracts v5
- Hardhat + hardhat-deploy plugin
- ethers.js v6 for contract interaction

### Backend (Governance API)
- **Next.js API routes** (not a standalone Express server — SE-2 monorepo)
- OpenAI SDK (pointed at RedPill base URL) — server-side only
- axios for RedPill signature and attestation endpoints
- ethers.js v6 for onchain submission
- **Re-attestation**: lazy inline check on every governance call — no cron needed
  (see `PLAN.md` → Re-attestation Strategy)

### Frontend (dApp)
- Next.js 15 (App Router) — SE-2 version
- TypeScript
- wagmi v2 + viem for wallet connection and contract reads
- RainbowKit for wallet UI
- **DaisyUI + Tailwind CSS** (SE-2 default — replaces "plain Tailwind" from original spec)
- `useScaffoldReadContract` / `useScaffoldWriteContract` (SE-2 hooks — replaces raw wagmi hooks)
- ABI auto-generated to `deployedContracts.ts` via hardhat-deploy (no manual `lib/contract.ts`)

### Chain
- Local Hardhat node for development
- Sepolia configured and ready (one env var swap to deploy to testnet)

---

## Repository Structure

> **SE-2 adaptation**: Mapped into SE-2 monorepo structure.
> See `PLAN.md` for full rationale.

```
packages/hardhat/
├── contracts/
│   └── ExampleAIMState.sol          # main governance contract
└── deploy/
    └── 00_deploy_example_aim_state.ts  # hardhat-deploy script (hashes constitution)

packages/nextjs/
├── app/
│   ├── page.tsx                     # dashboard (citizens, treasury, join)
│   ├── proposals/
│   │   ├── page.tsx                 # proposal list
│   │   ├── new/page.tsx             # submit proposal form
│   │   └── [id]/page.tsx           # proposal detail + AI proof
│   └── api/
│       └── proposals/
│           └── evaluate/route.ts    # POST: read from chain → AI → verify → submit
├── lib/
│   ├── constitution.ts              # CONSTITUTION string (server + client safe)
│   ├── ai.ts                        # RedPill inference (server-only)
│   ├── signature.ts                 # signature fetch + verify (server-only)
│   ├── attestation.ts               # TEE attestation + auto-register (server-only)
│   └── contract-server.ts           # ethers.js writes (server-only)
└── contracts/
    └── deployedContracts.ts         # auto-generated by hardhat-deploy

PLAN.md                              # build plan + SE-2 adaptations (this project)
redpill.md                           # AI verification reference
example-aimstate.md                  # this file
```

---

## Environment Variables

### Root / Backend `.env`
```bash
# RedPill
REDPILL_API_KEY=                    # from redpill.ai/dashboard
REDPILL_MODEL=openai/gpt-oss-120b   # default model — Phala provider, full TEE

# Chain
RPC_URL=                            # Sepolia RPC e.g. from Alchemy or Infura
ADMIN_PRIVATE_KEY=                  # deployer/owner wallet private key

# Contract
CONTRACT_ADDRESS=                   # set after deploy

# Server
PORT=3001
```

### Frontend `.env.local`
```bash
NEXT_PUBLIC_CONTRACT_ADDRESS=
NEXT_PUBLIC_RPC_URL=
NEXT_PUBLIC_BACKEND_URL=http://localhost:3001
NEXT_PUBLIC_CHAIN_ID=11155111       # Sepolia
```

---

## Smart Contract — ExampleAIMState.sol

This is the single contract. It handles citizenship, treasury, proposals, TEE
signer management, and AI proof verification. Read every comment.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title ExampleAIMState
 * @notice A governance contract where an AI evaluates proposals against a
 *         constitution. AI decisions are cryptographically verified via
 *         RedPill/Phala TEE attestation. No human voting.
 *
 * Key security invariants:
 *  1. Only TEE-attested signers (registered by owner after offchain attestation)
 *     can produce valid governance proofs.
 *  2. The AI response JSON is hashed and stored. The contract verifies the
 *     proposal action parameters match exactly what the AI approved — preventing
 *     any user from substituting different parameters after the AI decision.
 *  3. Treasury actions only execute if the AI approved them AND the caller
 *     provides the exact parameters the AI approved, verified by hash.
 *  4. Re-entrancy is prevented on all ETH-moving functions.
 */
contract ExampleAIMState is ReentrancyGuard {
    using ECDSA for bytes32;

    // ─── Constants ────────────────────────────────────────────────────────

    /// @notice Maximum ETH a single proposal can request (10% of treasury)
    uint256 public constant MAX_TREASURY_REQUEST_BPS = 1000; // 10% in basis points

    // ─── Structs ──────────────────────────────────────────────────────────

    struct TEESigner {
        bool trusted;
        string model;
        uint256 attestedAt;
        uint256 expiresAt;
    }

    /**
     * @notice A citizen's proposal record.
     * @dev proposalHash = keccak256(abi.encode(proposalId, citizen, proposalText,
     *      hasAction, actionTarget, actionValue, constitutionHash))
     *      This hash is what the AI sees as input context — it binds every field.
     *      The backend must reconstruct this hash and include it in the AI prompt
     *      so the AI is signing over a tamper-evident commitment.
     */
    struct Proposal {
        uint256 id;
        address citizen;
        string proposalText;
        bool hasAction;
        address actionTarget;   // only meaningful if hasAction = true
        uint256 actionValue;    // ETH in wei, only meaningful if hasAction = true
        bytes32 constitutionHash; // hash of constitution at time of submission
        ProposalStatus status;
        // AI proof fields — set when AI decision is submitted
        string aiDecision;      // "approve" | "reject" | "defer"
        string aiReasoning;     // AI explanation (stored offchain hash only)
        bytes32 aiResponseHash; // keccak256 of the full AI JSON response string
        bytes32 requestHash;    // keccak256 of the full prompt string sent to AI
        address teeAddress;     // which TEE signed the response
        uint256 decidedAt;
        bool executed;
    }

    enum ProposalStatus {
        Pending,    // submitted, awaiting AI evaluation
        Approved,   // AI approved
        Rejected,   // AI rejected
        Deferred,   // AI deferred (needs more info)
        Executed    // approved + onchain action completed
    }

    // ─── State ────────────────────────────────────────────────────────────

    address public owner;
    string public currentModel;
    bytes32 public constitutionHash; // keccak256 of current constitution text

    mapping(address => bool) public isCitizen;
    address[] public citizenList;

    mapping(uint256 => Proposal) public proposals;
    uint256 public proposalCount;

    mapping(address => TEESigner) public trustedSigners;
    uint256 public attestationTTL = 24 hours;

    // Anti-spam: track last proposal time per citizen
    mapping(address => uint256) public lastProposalTime;
    uint256 public proposalCooldown = 1 hours;

    // ─── Events ───────────────────────────────────────────────────────────

    event CitizenJoined(address indexed citizen, uint256 totalCitizens);
    event ProposalSubmitted(
        uint256 indexed proposalId,
        address indexed citizen,
        bool hasAction,
        bytes32 proposalHash
    );
    event ProposalDecided(
        uint256 indexed proposalId,
        string decision,
        address indexed teeAddress,
        bytes32 aiResponseHash
    );
    event ProposalExecuted(uint256 indexed proposalId, address target, uint256 value);
    event TEERegistered(address indexed signer, string model, uint256 expiresAt);
    event TEERevoked(address indexed signer);
    event ConstitutionUpdated(bytes32 newHash);
    event ModelUpdated(string newModel);
    event TreasuryDeposit(address indexed from, uint256 amount);

    // ─── Constructor ──────────────────────────────────────────────────────

    /**
     * @param _constitutionHash keccak256 of the constitution string
     * @param _initialModel     RedPill model string e.g. "openai/gpt-oss-120b"
     */
    constructor(bytes32 _constitutionHash, string memory _initialModel) {
        owner = msg.sender;
        constitutionHash = _constitutionHash;
        currentModel = _initialModel;
    }

    // ─── Modifiers ────────────────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier onlyCitizen() {
        require(isCitizen[msg.sender], "Not a citizen");
        _;
    }

    // ─── Treasury ─────────────────────────────────────────────────────────

    receive() external payable {
        emit TreasuryDeposit(msg.sender, msg.value);
    }

    function treasuryBalance() external view returns (uint256) {
        return address(this).balance;
    }

    // ─── Citizenship ──────────────────────────────────────────────────────

    function join() external {
        require(!isCitizen[msg.sender], "Already a citizen");
        isCitizen[msg.sender] = true;
        citizenList.push(msg.sender);
        emit CitizenJoined(msg.sender, citizenList.length);
    }

    function citizenCount() external view returns (uint256) {
        return citizenList.length;
    }

    // ─── Proposals ────────────────────────────────────────────────────────

    /**
     * @notice Submit a governance proposal.
     *
     * @param proposalText  The proposal in plain text (stored onchain for auditability)
     * @param hasAction     True if this proposal requests an onchain action on approval
     * @param actionTarget  ETH recipient address (ignored if hasAction = false)
     * @param actionValue   ETH amount in wei (ignored if hasAction = false)
     *
     * Security: The proposalHash binds all fields together including the current
     * constitutionHash. The backend uses this hash in the AI prompt so the AI
     * is evaluating a tamper-evident commitment to these exact values.
     * If the user submits different values at execution time, the hash won't match.
     */
    function submitProposal(
        string calldata proposalText,
        bool hasAction,
        address actionTarget,
        uint256 actionValue
    ) external onlyCitizen returns (uint256) {
        require(bytes(proposalText).length > 0, "Empty proposal");
        require(bytes(proposalText).length <= 5000, "Proposal too long");
        require(
            block.timestamp >= lastProposalTime[msg.sender] + proposalCooldown,
            "Cooldown active"
        );

        if (hasAction) {
            require(actionTarget != address(0), "Invalid target");
            require(actionValue > 0, "Action value must be > 0");
            // Enforce 10% treasury cap at submission time
            uint256 maxAllowed = (address(this).balance * MAX_TREASURY_REQUEST_BPS) / 10000;
            require(actionValue <= maxAllowed, "Exceeds 10% treasury cap");
        } else {
            // Ensure clean state for non-action proposals
            require(actionTarget == address(0), "No target for non-action proposal");
            require(actionValue == 0, "No value for non-action proposal");
        }

        uint256 proposalId = ++proposalCount;
        lastProposalTime[msg.sender] = block.timestamp;

        bytes32 proposalHash = keccak256(abi.encode(
            proposalId,
            msg.sender,
            proposalText,
            hasAction,
            actionTarget,
            actionValue,
            constitutionHash
        ));

        proposals[proposalId] = Proposal({
            id: proposalId,
            citizen: msg.sender,
            proposalText: proposalText,
            hasAction: hasAction,
            actionTarget: actionTarget,
            actionValue: actionValue,
            constitutionHash: constitutionHash,
            status: ProposalStatus.Pending,
            aiDecision: "",
            aiReasoning: "",
            aiResponseHash: bytes32(0),
            requestHash: bytes32(0),
            teeAddress: address(0),
            decidedAt: 0,
            executed: false
        });

        emit ProposalSubmitted(proposalId, msg.sender, hasAction, proposalHash);
        return proposalId;
    }

    /**
     * @notice Submit the AI governance decision for a proposal. Called by the backend
     *         after RedPill returns a verified response.
     *
     * @param proposalId        The proposal being decided
     * @param decision          "approve" | "reject" | "defer"
     * @param reasoning         Short reasoning string from AI (max 500 chars)
     * @param aiResponseHashHex keccak256 of the full AI JSON response string
     * @param requestHashHex    keccak256 of the full prompt string sent to AI
     * @param teeSignedText     The "reqHash:resHash" string from RedPill signature API
     * @param teeSignature      ECDSA signature bytes from RedPill signature API
     *
     * Security invariants enforced here:
     *  1. Proposal must be in Pending status — no re-deciding.
     *  2. The TEE signer must be registered and non-expired.
     *  3. The ECDSA signature over teeSignedText must recover to the registered TEE address.
     *  4. The requestHashHex must match the first segment of teeSignedText.
     *  5. The aiResponseHashHex must match the second segment of teeSignedText.
     *  6. This ensures the exact prompt and response we store are what the TEE signed.
     */
    function submitAIDecision(
        uint256 proposalId,
        string calldata decision,
        string calldata reasoning,
        bytes32 aiResponseHashHex,
        bytes32 requestHashHex,
        string calldata teeSignedText,
        bytes calldata teeSignature
    ) external nonReentrant {
        Proposal storage p = proposals[proposalId];
        require(p.id != 0, "Proposal does not exist");
        require(p.status == ProposalStatus.Pending, "Proposal not pending");

        // Validate decision string
        bytes32 decisionHash = keccak256(bytes(decision));
        require(
            decisionHash == keccak256("approve") ||
            decisionHash == keccak256("reject") ||
            decisionHash == keccak256("defer"),
            "Invalid decision value"
        );

        require(bytes(reasoning).length <= 500, "Reasoning too long");

        // ── TEE Signature Verification ─────────────────────────────────────
        // Recover the address that signed teeSignedText
        bytes32 messageHash = MessageHashUtils.toEthSignedMessageHash(
            keccak256(abi.encodePacked(teeSignedText))
        );
        address recovered = ECDSA.recover(messageHash, teeSignature);

        // Verify it's a trusted, non-expired TEE
        TEESigner memory signer = trustedSigners[recovered];
        require(signer.trusted, "Not a trusted TEE signer");
        require(block.timestamp < signer.expiresAt, "TEE attestation expired");

        // ── Hash Binding Verification ──────────────────────────────────────
        // teeSignedText format is "sha256_request_hash:sha256_response_hash"
        // These are SHA-256 hex strings (64 chars each), not bytes32.
        // We verify that the bytes32 values passed in match what's in teeSignedText.
        // The backend passes requestHashHex = bytes32(sha256OfPrompt) and
        // aiResponseHashHex = bytes32(sha256OfResponse).
        // We encode them to hex strings and compare to teeSignedText segments.
        (string memory reqHexFromText, string memory resHexFromText) =
            _splitColonSeparated(teeSignedText);

        require(
            keccak256(bytes(_bytes32ToHexString(requestHashHex))) ==
            keccak256(bytes(reqHexFromText)),
            "Request hash mismatch with TEE signed text"
        );
        require(
            keccak256(bytes(_bytes32ToHexString(aiResponseHashHex))) ==
            keccak256(bytes(resHexFromText)),
            "Response hash mismatch with TEE signed text"
        );

        // ── Store Decision ─────────────────────────────────────────────────
        p.aiDecision = decision;
        p.aiReasoning = reasoning;
        p.aiResponseHash = aiResponseHashHex;
        p.requestHash = requestHashHex;
        p.teeAddress = recovered;
        p.decidedAt = block.timestamp;

        if (decisionHash == keccak256("approve")) {
            p.status = ProposalStatus.Approved;
        } else if (decisionHash == keccak256("reject")) {
            p.status = ProposalStatus.Rejected;
        } else {
            p.status = ProposalStatus.Deferred;
        }

        emit ProposalDecided(proposalId, decision, recovered, aiResponseHashHex);
    }

    /**
     * @notice Execute the onchain action for an approved proposal.
     *         Can be called by anyone — the contract verifies everything internally.
     *
     * @param proposalId        The approved proposal to execute
     *
     * Security: The action parameters (target, value) are read from the stored
     * proposal — NOT from calldata. This means the user cannot pass different
     * parameters at execution time. The AI approved the exact target and value
     * stored in the proposal struct, which was committed at submission time.
     */
    function executeProposal(uint256 proposalId) external nonReentrant {
        Proposal storage p = proposals[proposalId];
        require(p.id != 0, "Proposal does not exist");
        require(p.status == ProposalStatus.Approved, "Proposal not approved");
        require(p.hasAction, "No action to execute");
        require(!p.executed, "Already executed");

        // Re-verify treasury cap at execution time (balance may have changed)
        uint256 maxAllowed = (address(this).balance * MAX_TREASURY_REQUEST_BPS) / 10000;
        require(p.actionValue <= maxAllowed, "Exceeds 10% treasury cap at execution");
        require(address(this).balance >= p.actionValue, "Insufficient treasury");

        p.executed = true;
        p.status = ProposalStatus.Executed;

        // Transfer ETH — target and value come from the stored proposal only
        (bool success, ) = p.actionTarget.call{value: p.actionValue}("");
        require(success, "ETH transfer failed");

        emit ProposalExecuted(proposalId, p.actionTarget, p.actionValue);
    }

    // ─── TEE Management ───────────────────────────────────────────────────

    /**
     * @notice Register a TEE signing address. Call after offchain attestation passes.
     *         See redpill.md — Step 4 and Step 5.
     */
    function registerTEESigner(
        address signer,
        string calldata model
    ) external onlyOwner {
        require(signer != address(0), "Zero address");
        trustedSigners[signer] = TEESigner({
            trusted: true,
            model: model,
            attestedAt: block.timestamp,
            expiresAt: block.timestamp + attestationTTL
        });
        emit TEERegistered(signer, model, block.timestamp + attestationTTL);
    }

    function revokeTEESigner(address signer) external onlyOwner {
        trustedSigners[signer].trusted = false;
        emit TEERevoked(signer);
    }

    function setAttestationTTL(uint256 ttl) external onlyOwner {
        require(ttl >= 1 hours, "TTL too short");
        attestationTTL = ttl;
    }

    // ─── Owner Controls ───────────────────────────────────────────────────

    /**
     * @notice Update the AI model. New model applies to proposals submitted after
     *         this call. Existing pending proposals keep the old model context
     *         (enforced offchain — the backend checks the event log).
     */
    function updateModel(string calldata newModel) external onlyOwner {
        require(bytes(newModel).length > 0, "Empty model");
        currentModel = newModel;
        emit ModelUpdated(newModel);
    }

    /**
     * @notice Update the constitution. New hash applies to proposals submitted after
     *         this call. Each proposal stores the constitutionHash at submission time.
     * @param newHash keccak256 of the new constitution text
     */
    function updateConstitution(bytes32 newHash) external onlyOwner {
        require(newHash != bytes32(0), "Zero hash");
        constitutionHash = newHash;
        emit ConstitutionUpdated(newHash);
    }

    function setProposalCooldown(uint256 cooldown) external onlyOwner {
        proposalCooldown = cooldown;
    }

    // ─── Views ────────────────────────────────────────────────────────────

    function getProposal(uint256 proposalId) external view returns (Proposal memory) {
        require(proposals[proposalId].id != 0, "Does not exist");
        return proposals[proposalId];
    }

    function isTEETrusted(address signer) external view returns (bool) {
        return trustedSigners[signer].trusted &&
               block.timestamp < trustedSigners[signer].expiresAt;
    }

    function getProposalHash(uint256 proposalId) external view returns (bytes32) {
        Proposal memory p = proposals[proposalId];
        require(p.id != 0, "Does not exist");
        return keccak256(abi.encode(
            p.id,
            p.citizen,
            p.proposalText,
            p.hasAction,
            p.actionTarget,
            p.actionValue,
            p.constitutionHash
        ));
    }

    // ─── Internal Utilities ───────────────────────────────────────────────

    /**
     * @dev Split "aaa:bbb" into ("aaa", "bbb"). Finds first colon only.
     */
    function _splitColonSeparated(string memory text)
        internal
        pure
        returns (string memory left, string memory right)
    {
        bytes memory b = bytes(text);
        uint256 splitAt;
        bool found;
        for (uint256 i = 0; i < b.length; i++) {
            if (b[i] == ':') {
                splitAt = i;
                found = true;
                break;
            }
        }
        require(found, "No colon separator in TEE signed text");

        bytes memory l = new bytes(splitAt);
        bytes memory r = new bytes(b.length - splitAt - 1);
        for (uint256 i = 0; i < splitAt; i++) l[i] = b[i];
        for (uint256 i = 0; i < r.length; i++) r[i] = b[splitAt + 1 + i];

        return (string(l), string(r));
    }

    /**
     * @dev Convert bytes32 to lowercase hex string (no 0x prefix).
     *      Used to compare bytes32 hashes against hex strings from TEE signed text.
     */
    function _bytes32ToHexString(bytes32 b) internal pure returns (string memory) {
        bytes memory hexChars = "0123456789abcdef";
        bytes memory result = new bytes(64);
        for (uint256 i = 0; i < 32; i++) {
            result[i * 2]     = hexChars[uint8(b[i]) >> 4];
            result[i * 2 + 1] = hexChars[uint8(b[i]) & 0x0f];
        }
        return string(result);
    }
}
```

---

## Backend — Governance API

The backend is the only component that holds `REDPILL_API_KEY`. It:
1. Receives a proposal evaluation request from the frontend (or directly)
2. Builds the AI prompt from the proposal + constitution
3. Calls RedPill AI
4. Fetches and verifies the ECDSA signature
5. Submits the AI decision to the smart contract

### constitution.ts

```typescript
// backend/src/constitution.ts
// This must be kept in sync with what is hashed in the deployment script.
// keccak256 of this string must equal the constitutionHash in the contract.

export const CONSTITUTION = `CONSTITUTION OF THE EXAMPLE AIM STATE

Preamble
We, the citizens of the Example AIM State, establish this constitution to build
a society grounded in equality — equal dignity, equal opportunity, and equal
standing before the governance system — for every person who joins this state.

Article I — Citizenship
Section 1. Any person may become a citizen of the Example AIM State by registering
their Ethereum address. Citizenship is open to all without discrimination based on
identity, origin, belief, or background.
Section 2. Every citizen holds equal standing in the governance system. No citizen
has more inherent weight or authority than any other.
Section 3. Citizenship may not be revoked except by the citizen's own choice to
leave the state.

Article II — The Treasury
Section 1. The state treasury is held in ETH in the governance smart contract.
Section 2. Treasury funds exist to serve the collective wellbeing and individual
needs of citizens. Funds shall not be used to enrich any party disproportionately
or in ways that undermine equality.
Section 3. Any citizen may propose a treasury disbursement. The AI shall evaluate
whether the proposed use genuinely serves need and is consistent with equality.
Section 4. No single proposal may request more than 10% of the current treasury
balance. This protects against depletion by any single actor.
Section 5. Repeated disbursement requests from the same citizen within 30 days
shall be evaluated with heightened scrutiny.

Article III — Proposals
Section 1. Any citizen may submit a proposal at any time. Proposals must be written
in good faith and describe a genuine need, initiative, or change to the state.
Section 2. Proposals are evaluated by the AI governance system against this
constitution. The AI decision is final and executed automatically onchain.
Section 3. Proposals that request onchain actions (such as ETH transfers) must
specify the exact recipient address and amount in structured form so the contract
can verify the AI approved the exact action being executed.
Section 4. Proposals that promote discrimination, harassment, or inequality of
any kind shall be rejected.
Section 5. Proposals that seek to concentrate power, resources, or influence
disproportionately shall be rejected.

Article IV — AI Governance
Section 1. The AI evaluating proposals must be verifiably running open-source
software on hardware-attested TEE infrastructure. Citizens may independently
verify this at any time using the attestation data stored onchain.
Section 2. The AI decision for every proposal is recorded permanently onchain
including the hash of the exact prompt sent and the exact response received.
This ensures full auditability.
Section 3. The owner of the contract may update the AI model used for governance.
Any model change takes effect only for proposals submitted after the change.
Section 4. The owner may update the constitution. Proposals submitted before a
constitution change are evaluated against the constitution that was active at
the time of submission.

Article V — Equality Principles
Section 1. Equal need is a valid basis for resource allocation. A citizen with
a genuine financial need has a valid claim on the treasury regardless of their
background or history with the state.
Section 2. The AI shall apply the same standard to every proposal regardless of
who submitted it.
Section 3. Actions that would result in one citizen or group of citizens having
substantially more power or resources than others shall require exceptionally
strong justification and shall be viewed with suspicion by the AI.`;
```

### AI Prompt Construction — ai.ts

This is the most security-critical piece of the backend.
The prompt must include the proposalHash so the AI is reasoning about a
tamper-evident commitment. The AI response must be strict JSON.

```typescript
// backend/src/services/ai.ts
import OpenAI from 'openai';
import { CONSTITUTION } from '../constitution';

const client = new OpenAI({
  apiKey: process.env.REDPILL_API_KEY,
  baseURL: 'https://api.redpill.ai/v1',
});

export interface AIInput {
  proposalId: number;
  proposalHash: string;       // bytes32 hex from contract — tamper-evident commitment
  proposalText: string;
  hasAction: boolean;
  actionTarget: string;       // "0x0000..." if no action
  actionValue: string;        // wei as string, "0" if no action
  citizen: string;            // submitter address
  treasuryBalance: string;    // current balance in wei as string
  constitutionHash: string;   // the hash stored in the contract at submission
}

export interface AIOutput {
  decision: 'approve' | 'reject' | 'defer';
  reasoning: string;          // max 500 chars — stored onchain
  constitutional_alignment: number; // 0-100
  risk_flags: string[];
  // If proposal has an action, AI must echo back target and value it is approving.
  // The contract backend verifies these match the stored proposal before submitting.
  approved_action_target: string | null;
  approved_action_value: string | null; // wei as string
}

export interface AICallResult {
  response: OpenAI.ChatCompletion;
  requestBodyJson: string;    // exact JSON string used — needed for hash verification
  responseBodyJson: string;   // exact JSON string received — needed for hash verification
  output: AIOutput;
  requestId: string;
}

const SYSTEM_PROMPT = `You are the constitutional AI of the Example AIM State.
Your role is to evaluate citizen proposals against the state constitution and
make governance decisions. Your decision is final and will be executed automatically
onchain. Be fair, consistent, and apply the constitution equally to all citizens.

You must respond ONLY with a valid JSON object. No preamble. No explanation outside
the JSON. No markdown code fences. Raw JSON only.

Response schema:
{
  "decision": "approve" | "reject" | "defer",
  "reasoning": "string — max 500 characters, explain your decision",
  "constitutional_alignment": number between 0 and 100,
  "risk_flags": ["array of strings describing any concerns, empty if none"],
  "approved_action_target": "0x... address string or null if no action or not approved",
  "approved_action_value": "wei amount as string or null if no action or not approved"
}

Rules:
- "approve": proposal is consistent with the constitution and may proceed
- "reject": proposal violates the constitution or is not in the state's interest
- "defer": proposal needs clarification before a decision can be made
- If decision is "approve" and hasAction is true, you MUST echo back the exact
  actionTarget and actionValue from the proposal in approved_action_target and
  approved_action_value. Do not modify them. If you are not approving, set both to null.
- Apply the 10% treasury cap rule from Article II Section 4.
- Apply equal treatment from Article V to all citizens regardless of address.`;

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

REQUESTED ACTION: ${input.hasAction ? 'YES' : 'NO'}
${input.hasAction ? `ACTION TARGET: ${input.actionTarget}
ACTION VALUE (wei): ${input.actionValue}` : ''}

Evaluate this proposal against the constitution and respond with JSON only.
`.trim();

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userMessage },
  ];

  const requestBody = {
    model: process.env.REDPILL_MODEL || 'openai/gpt-oss-120b',
    messages,
    response_format: { type: 'json_object' as const },
    temperature: 0,             // deterministic — governance decisions must not vary
    max_tokens: 1024,
  };

  // Serialize request body deterministically for hashing
  const requestBodyJson = JSON.stringify(requestBody);

  const response = await client.chat.completions.create(requestBody);
  const responseBodyJson = JSON.stringify(response);

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error('Empty AI response');

  let output: AIOutput;
  try {
    output = JSON.parse(content) as AIOutput;
  } catch {
    throw new Error(`AI returned invalid JSON: ${content}`);
  }

  // Validate required fields
  if (!['approve', 'reject', 'defer'].includes(output.decision)) {
    throw new Error(`Invalid AI decision value: ${output.decision}`);
  }
  if (typeof output.reasoning !== 'string' || output.reasoning.length > 500) {
    throw new Error('AI reasoning missing or too long');
  }
  if (output.reasoning.length === 0) {
    throw new Error('AI reasoning is empty');
  }

  // If approved with action, AI must echo back the target and value
  if (output.decision === 'approve' && input.hasAction) {
    if (!output.approved_action_target || !output.approved_action_value) {
      throw new Error('AI approved an action proposal but did not echo back target/value');
    }
    // Verify AI echoed back the EXACT same values (case-insensitive for address)
    if (
      output.approved_action_target.toLowerCase() !== input.actionTarget.toLowerCase()
    ) {
      throw new Error(
        `AI echoed wrong action target. Expected: ${input.actionTarget}, Got: ${output.approved_action_target}`
      );
    }
    if (output.approved_action_value !== input.actionValue) {
      throw new Error(
        `AI echoed wrong action value. Expected: ${input.actionValue}, Got: ${output.approved_action_value}`
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
```

### Signature Service — signature.ts

```typescript
// backend/src/services/signature.ts
import crypto from 'crypto';
import axios from 'axios';

export interface RedPillSignature {
  request_id: string;
  model: string;
  text: string;            // "sha256_request_hex:sha256_response_hex"
  signature: string;       // ECDSA signature hex
  signing_address: string; // Ethereum address of TEE key
  payload: {
    request_hash: string;
    response_hash: string;
    timestamp: string;
    model: string;
  };
}

export function sha256Hex(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

export async function fetchSignatureWithRetry(
  requestId: string,
  model: string,
  maxAttempts = 5
): Promise<RedPillSignature> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await new Promise(r => setTimeout(r, attempt * 1500)); // back off
    try {
      const res = await axios.get(
        `https://api.redpill.ai/v1/signature/${requestId}`,
        {
          params: { model, signing_algo: 'ecdsa' },
          headers: { Authorization: `Bearer ${process.env.REDPILL_API_KEY}` },
        }
      );
      return res.data as RedPillSignature;
    } catch (err: any) {
      if (attempt === maxAttempts) throw err;
      console.warn(`Signature fetch attempt ${attempt} failed, retrying...`);
    }
  }
  throw new Error('Failed to fetch signature after max attempts');
}

/**
 * Verify the signature covers our actual request and response.
 * RedPill's text field is "sha256(requestBody):sha256(responseBody)".
 */
export function verifyHashes(
  requestBodyJson: string,
  responseBodyJson: string,
  sig: RedPillSignature
): void {
  const localRequestHash = sha256Hex(requestBodyJson);
  const localResponseHash = sha256Hex(responseBodyJson);

  const [serverRequestHash, serverResponseHash] = sig.text.split(':');

  if (localRequestHash !== serverRequestHash) {
    throw new Error(
      `Request hash mismatch.\nLocal:  ${localRequestHash}\nServer: ${serverRequestHash}`
    );
  }
  if (localResponseHash !== serverResponseHash) {
    throw new Error(
      `Response hash mismatch.\nLocal:  ${localResponseHash}\nServer: ${serverResponseHash}`
    );
  }
}
```

### Contract Service — contract.ts

```typescript
// backend/src/services/contract.ts
import { ethers } from 'ethers';
import crypto from 'crypto';
import { RedPillSignature, sha256Hex } from './signature';
import { AIOutput } from './ai';

// Minimal ABI — only what backend needs
const ABI = [
  'function submitAIDecision(uint256 proposalId, string decision, string reasoning, bytes32 aiResponseHashHex, bytes32 requestHashHex, string teeSignedText, bytes teeSignature) external',
  'function executeProposal(uint256 proposalId) external',
  'function getProposal(uint256 proposalId) external view returns (tuple(uint256 id, address citizen, string proposalText, bool hasAction, address actionTarget, uint256 actionValue, bytes32 constitutionHash, uint8 status, string aiDecision, string aiReasoning, bytes32 aiResponseHash, bytes32 requestHash, address teeAddress, uint256 decidedAt, bool executed))',
  'function getProposalHash(uint256 proposalId) external view returns (bytes32)',
  'event ProposalDecided(uint256 indexed proposalId, string decision, address indexed teeAddress, bytes32 aiResponseHash)',
];

function getContract() {
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  const wallet = new ethers.Wallet(process.env.ADMIN_PRIVATE_KEY!, provider);
  return new ethers.Contract(process.env.CONTRACT_ADDRESS!, ABI, wallet);
}

/**
 * Convert a SHA-256 hex string (64 chars) to bytes32.
 * sha256Hex returns a 64-char hex string.
 * bytes32 in ethers is a 32-byte hex with 0x prefix.
 */
function hexStringToBytes32(hex: string): string {
  // Remove any 0x prefix, pad to 64 chars, add 0x
  const clean = hex.replace(/^0x/, '').padStart(64, '0');
  return '0x' + clean;
}

export async function submitAIDecisionOnchain(
  proposalId: number,
  output: AIOutput,
  sig: RedPillSignature,
  requestBodyJson: string,
  responseBodyJson: string
): Promise<string> {
  const contract = getContract();

  const requestHashHex = hexStringToBytes32(sha256Hex(requestBodyJson));
  const responseHashHex = hexStringToBytes32(sha256Hex(responseBodyJson));
  const sigBytes = ethers.getBytes(sig.signature);

  // reasoning must be max 500 chars — already validated in ai.ts
  const reasoning = output.reasoning.slice(0, 500);

  const tx = await contract.submitAIDecision(
    proposalId,
    output.decision,
    reasoning,
    responseHashHex,
    requestHashHex,
    sig.text,
    sigBytes
  );

  const receipt = await tx.wait();
  console.log(`AI decision submitted onchain. Tx: ${receipt.hash}`);
  return receipt.hash;
}

export async function executeProposalOnchain(proposalId: number): Promise<string> {
  const contract = getContract();
  const tx = await contract.executeProposal(proposalId);
  const receipt = await tx.wait();
  console.log(`Proposal executed onchain. Tx: ${receipt.hash}`);
  return receipt.hash;
}
```

### Main Route — proposals.ts

```typescript
// backend/src/routes/proposals.ts
import { Router, Request, Response } from 'express';
import { ethers } from 'ethers';
import { evaluateProposal } from '../services/ai';
import { fetchSignatureWithRetry, verifyHashes } from '../services/signature';
import { submitAIDecisionOnchain, executeProposalOnchain } from '../services/contract';

const router = Router();

const CONTRACT_ABI_READ = [
  'function getProposal(uint256 proposalId) external view returns (tuple(uint256 id, address citizen, string proposalText, bool hasAction, address actionTarget, uint256 actionValue, bytes32 constitutionHash, uint8 status, string aiDecision, string aiReasoning, bytes32 aiResponseHash, bytes32 requestHash, address teeAddress, uint256 decidedAt, bool executed))',
  'function getProposalHash(uint256 proposalId) external view returns (bytes32)',
  'function constitutionHash() external view returns (bytes32)',
  'function treasuryBalance() external view returns (uint256)',
  'function citizenCount() external view returns (uint256)',
];

function getReadContract() {
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  return new ethers.Contract(process.env.CONTRACT_ADDRESS!, CONTRACT_ABI_READ, provider);
}

/**
 * POST /proposals/evaluate
 * Body: { proposalId: number }
 *
 * This route:
 * 1. Reads proposal data directly from the contract (not from caller — prevents tampering)
 * 2. Builds AI prompt from onchain data
 * 3. Calls RedPill AI
 * 4. Fetches and verifies signature
 * 5. Submits decision onchain
 * 6. If approved + has action, executes the action
 */
router.post('/evaluate', async (req: Request, res: Response) => {
  const { proposalId } = req.body;

  if (!proposalId || typeof proposalId !== 'number') {
    return res.status(400).json({ error: 'proposalId (number) required' });
  }

  try {
    const contract = getReadContract();

    // ── 1. Read proposal from chain — never trust caller-provided data ────
    const [proposal, proposalHash, constitutionHashOnchain, treasuryBalance] =
      await Promise.all([
        contract.getProposal(proposalId),
        contract.getProposalHash(proposalId),
        contract.constitutionHash(),
        contract.treasuryBalance(),
      ]);

    if (proposal.status !== 0) { // 0 = Pending
      return res.status(400).json({ error: 'Proposal is not in Pending status' });
    }

    // ── 2. Build AI input from onchain data only ───────────────────────────
    const aiInput = {
      proposalId,
      proposalHash: proposalHash,           // bytes32 hex
      proposalText: proposal.proposalText,
      hasAction: proposal.hasAction,
      actionTarget: proposal.actionTarget,
      actionValue: proposal.actionValue.toString(), // wei as string
      citizen: proposal.citizen,
      treasuryBalance: treasuryBalance.toString(),
      constitutionHash: constitutionHashOnchain,
    };

    // ── 3. Call AI ─────────────────────────────────────────────────────────
    console.log(`Evaluating proposal ${proposalId}...`);
    const aiResult = await evaluateProposal(aiInput);

    // ── 4. Fetch RedPill signature ─────────────────────────────────────────
    const model = process.env.REDPILL_MODEL || 'openai/gpt-oss-120b';
    const sig = await fetchSignatureWithRetry(aiResult.requestId, model);

    // ── 5. Verify hashes locally ───────────────────────────────────────────
    verifyHashes(aiResult.requestBodyJson, aiResult.responseBodyJson, sig);
    console.log('Hash verification passed');

    // ── 6. Submit decision onchain ─────────────────────────────────────────
    const decisionTxHash = await submitAIDecisionOnchain(
      proposalId,
      aiResult.output,
      sig,
      aiResult.requestBodyJson,
      aiResult.responseBodyJson
    );

    // ── 7. Execute if approved and has action ──────────────────────────────
    let executionTxHash: string | null = null;
    if (aiResult.output.decision === 'approve' && proposal.hasAction) {
      executionTxHash = await executeProposalOnchain(proposalId);
    }

    return res.json({
      proposalId,
      decision: aiResult.output.decision,
      reasoning: aiResult.output.reasoning,
      constitutional_alignment: aiResult.output.constitutional_alignment,
      risk_flags: aiResult.output.risk_flags,
      decisionTxHash,
      executionTxHash,
      teeSigningAddress: sig.signing_address,
    });
  } catch (err: any) {
    console.error('Proposal evaluation failed:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

export default router;
```

---

## Deployment Script

> **SE-2 adaptation**: Uses hardhat-deploy plugin format instead of raw ethers.js script.
> See `packages/hardhat/deploy/00_deploy_example_aim_state.ts`.
> The reference script below is kept for documentation purposes only.

```typescript
import { ethers } from 'ethers';
import { CONSTITUTION } from '../backend/src/constitution';

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  const wallet = new ethers.Wallet(process.env.ADMIN_PRIVATE_KEY!, provider);

  // Hash the constitution — must match what the backend uses
  const constitutionHash = ethers.keccak256(ethers.toUtf8Bytes(CONSTITUTION));
  console.log('Constitution hash:', constitutionHash);

  const model = process.env.REDPILL_MODEL || 'openai/gpt-oss-120b';

  // Deploy
  const factory = new ethers.ContractFactory(ABI, BYTECODE, wallet);
  const contract = await factory.deploy(constitutionHash, model);
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log('ExampleAIMState deployed at:', address);
  console.log('Set CONTRACT_ADDRESS=' + address + ' in your .env files');
}

main().catch(console.error);
```

---

## Frontend — Key Pages

> **SE-2 adaptation**: Uses `useScaffoldReadContract` / `useScaffoldWriteContract`
> instead of raw wagmi hooks. Uses DaisyUI classes. ABI from `deployedContracts.ts`.
> The code below is the reference spec — actual implementation uses SE-2 patterns.

### Dashboard — app/page.tsx

The dashboard shows two things: citizen count and treasury balance.
Reads directly from the contract via wagmi. No backend call needed for these.

```typescript
'use client';
import { useReadContract } from 'wagmi';
import { CONTRACT_ADDRESS, ABI } from '@/lib/contract';
import { formatEther } from 'viem';

export default function Dashboard() {
  const { data: citizenCount } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: ABI,
    functionName: 'citizenCount',
  });

  const { data: treasuryBalance } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: ABI,
    functionName: 'treasuryBalance',
  });

  return (
    <main className="max-w-2xl mx-auto py-16 px-4">
      <h1 className="text-3xl font-bold mb-2">Example AIM State</h1>
      <p className="text-gray-500 mb-12">An equality-first digital state governed by verifiable AI.</p>

      <div className="grid grid-cols-2 gap-6 mb-12">
        <div className="border rounded-lg p-6">
          <div className="text-sm text-gray-500 mb-1">Citizens</div>
          <div className="text-4xl font-bold">
            {citizenCount !== undefined ? citizenCount.toString() : '—'}
          </div>
        </div>
        <div className="border rounded-lg p-6">
          <div className="text-sm text-gray-500 mb-1">Treasury</div>
          <div className="text-4xl font-bold">
            {treasuryBalance !== undefined
              ? parseFloat(formatEther(treasuryBalance)).toFixed(4) + ' ETH'
              : '—'}
          </div>
        </div>
      </div>

      <div className="flex gap-4">
        <a href="/proposals" className="px-4 py-2 border rounded hover:bg-gray-50">
          View Proposals
        </a>
        <a href="/proposals/new" className="px-4 py-2 bg-black text-white rounded hover:bg-gray-800">
          Submit Proposal
        </a>
      </div>
    </main>
  );
}
```

### Submit Proposal — app/proposals/new/page.tsx

The user fills in proposal text and optionally a transfer target + amount.
On submit: calls `submitProposal` on the contract via wagmi `writeContract`,
then calls the backend `/proposals/evaluate` to trigger AI evaluation.

Important: the frontend does NOT pass proposal data to the backend.
The backend reads all proposal data directly from the contract by `proposalId`.
This prevents any tampering between form submission and AI evaluation.

```typescript
'use client';
import { useState } from 'react';
import { useWriteContract, useAccount, useReadContract } from 'wagmi';
import { parseEther } from 'viem';
import { CONTRACT_ADDRESS, ABI } from '@/lib/contract';

export default function NewProposal() {
  const { address, isConnected } = useAccount();
  const [proposalText, setProposalText] = useState('');
  const [hasAction, setHasAction] = useState(false);
  const [actionTarget, setActionTarget] = useState('');
  const [actionValueEth, setActionValueEth] = useState('');
  const [status, setStatus] = useState('');
  const [result, setResult] = useState<any>(null);

  const { data: isCitizen } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: ABI,
    functionName: 'isCitizen',
    args: [address],
    query: { enabled: !!address },
  });

  const { writeContractAsync } = useWriteContract();

  async function handleJoin() {
    setStatus('Joining state...');
    try {
      await writeContractAsync({
        address: CONTRACT_ADDRESS,
        abi: ABI,
        functionName: 'join',
      });
      setStatus('Joined! Refresh the page.');
    } catch (e: any) {
      setStatus('Error: ' + e.message);
    }
  }

  async function handleSubmit() {
    if (!proposalText.trim()) return;

    setStatus('Submitting proposal onchain...');
    setResult(null);

    try {
      // 1. Submit proposal to contract
      // actionTarget defaults to zero address, actionValue to 0 if no action
      const target = hasAction && actionTarget ? actionTarget as `0x${string}` : '0x0000000000000000000000000000000000000000' as `0x${string}`;
      const value = hasAction && actionValueEth ? parseEther(actionValueEth) : BigInt(0);

      const txHash = await writeContractAsync({
        address: CONTRACT_ADDRESS,
        abi: ABI,
        functionName: 'submitProposal',
        args: [proposalText, hasAction, target, value],
      });

      setStatus('Proposal submitted. Waiting for confirmation...');

      // 2. Wait a moment for indexing, then get proposalCount to find our proposalId
      // In production: parse tx receipt logs for ProposalSubmitted event to get proposalId
      // For simplicity here: wait and read proposalCount
      await new Promise(r => setTimeout(r, 3000));

      // Read current proposal count — our proposal is at this ID
      // Note: in production parse the event log from the receipt for exact proposalId
      const response = await fetch(process.env.NEXT_PUBLIC_BACKEND_URL + '/proposals/latest-id');
      const { proposalId } = await response.json();

      setStatus(`Proposal #${proposalId} confirmed. Requesting AI evaluation...`);

      // 3. Trigger backend evaluation — backend reads all data from chain
      const evalResponse = await fetch(
        process.env.NEXT_PUBLIC_BACKEND_URL + '/proposals/evaluate',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ proposalId }),
        }
      );

      const evalResult = await evalResponse.json();
      if (!evalResponse.ok) throw new Error(evalResult.error);

      setResult(evalResult);
      setStatus('');
    } catch (e: any) {
      setStatus('Error: ' + e.message);
    }
  }

  if (!isConnected) {
    return (
      <main className="max-w-2xl mx-auto py-16 px-4">
        <p>Connect your wallet to submit a proposal.</p>
      </main>
    );
  }

  if (!isCitizen) {
    return (
      <main className="max-w-2xl mx-auto py-16 px-4">
        <h1 className="text-2xl font-bold mb-4">Join the State First</h1>
        <p className="text-gray-500 mb-6">You must be a citizen to submit proposals.</p>
        <button
          onClick={handleJoin}
          className="px-4 py-2 bg-black text-white rounded hover:bg-gray-800"
        >
          Join the Example AIM State
        </button>
        {status && <p className="mt-4 text-sm text-gray-600">{status}</p>}
      </main>
    );
  }

  return (
    <main className="max-w-2xl mx-auto py-16 px-4">
      <h1 className="text-2xl font-bold mb-8">Submit a Proposal</h1>

      <div className="space-y-6">
        <div>
          <label className="block text-sm font-medium mb-2">
            Proposal (max 5000 chars)
          </label>
          <textarea
            className="w-full border rounded p-3 h-40 text-sm"
            placeholder="Describe your proposal clearly. If requesting funds, explain the genuine need."
            value={proposalText}
            onChange={e => setProposalText(e.target.value)}
            maxLength={5000}
          />
          <p className="text-xs text-gray-400 mt-1">{proposalText.length}/5000</p>
        </div>

        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            id="hasAction"
            checked={hasAction}
            onChange={e => setHasAction(e.target.checked)}
            className="w-4 h-4"
          />
          <label htmlFor="hasAction" className="text-sm font-medium">
            This proposal requests an ETH transfer from the treasury
          </label>
        </div>

        {hasAction && (
          <div className="space-y-4 pl-4 border-l-2 border-gray-200">
            <div>
              <label className="block text-sm font-medium mb-2">Recipient Address</label>
              <input
                type="text"
                className="w-full border rounded p-3 text-sm font-mono"
                placeholder="0x..."
                value={actionTarget}
                onChange={e => setActionTarget(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Amount (ETH)</label>
              <input
                type="number"
                step="0.001"
                min="0"
                className="w-full border rounded p-3 text-sm"
                placeholder="0.0"
                value={actionValueEth}
                onChange={e => setActionValueEth(e.target.value)}
              />
              <p className="text-xs text-gray-400 mt-1">
                Maximum 10% of current treasury balance per proposal.
              </p>
            </div>
          </div>
        )}

        <button
          onClick={handleSubmit}
          disabled={!proposalText.trim() || !!status}
          className="px-6 py-3 bg-black text-white rounded hover:bg-gray-800 disabled:opacity-50"
        >
          Submit Proposal
        </button>

        {status && (
          <p className="text-sm text-gray-600 animate-pulse">{status}</p>
        )}

        {result && (
          <div className={`border rounded p-4 ${
            result.decision === 'approve' ? 'border-green-400 bg-green-50' :
            result.decision === 'reject' ? 'border-red-400 bg-red-50' :
            'border-yellow-400 bg-yellow-50'
          }`}>
            <div className="font-bold text-lg capitalize mb-2">{result.decision}</div>
            <p className="text-sm mb-3">{result.reasoning}</p>
            <div className="text-xs text-gray-500 space-y-1">
              <div>Constitutional alignment: {result.constitutional_alignment}/100</div>
              <div>TEE signer: {result.teeSigningAddress}</div>
              <div>Decision tx: {result.decisionTxHash}</div>
              {result.executionTxHash && (
                <div>Execution tx: {result.executionTxHash}</div>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
```

---

## lib/contract.ts — Frontend ABI

```typescript
// frontend/lib/contract.ts
import { Address } from 'viem';

export const CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS as Address;

export const ABI = [
  // Read
  { name: 'citizenCount', type: 'function', stateMutability: 'view',
    inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'treasuryBalance', type: 'function', stateMutability: 'view',
    inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'isCitizen', type: 'function', stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }], outputs: [{ type: 'bool' }] },
  { name: 'proposalCount', type: 'function', stateMutability: 'view',
    inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'getProposal', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'proposalId', type: 'uint256' }],
    outputs: [{ type: 'tuple', components: [
      { name: 'id', type: 'uint256' },
      { name: 'citizen', type: 'address' },
      { name: 'proposalText', type: 'string' },
      { name: 'hasAction', type: 'bool' },
      { name: 'actionTarget', type: 'address' },
      { name: 'actionValue', type: 'uint256' },
      { name: 'constitutionHash', type: 'bytes32' },
      { name: 'status', type: 'uint8' },
      { name: 'aiDecision', type: 'string' },
      { name: 'aiReasoning', type: 'string' },
      { name: 'aiResponseHash', type: 'bytes32' },
      { name: 'requestHash', type: 'bytes32' },
      { name: 'teeAddress', type: 'address' },
      { name: 'decidedAt', type: 'uint256' },
      { name: 'executed', type: 'bool' },
    ]}] },
  // Write
  { name: 'join', type: 'function', stateMutability: 'nonpayable',
    inputs: [], outputs: [] },
  { name: 'submitProposal', type: 'function', stateMutability: 'nonpayable',
    inputs: [
      { name: 'proposalText', type: 'string' },
      { name: 'hasAction', type: 'bool' },
      { name: 'actionTarget', type: 'address' },
      { name: 'actionValue', type: 'uint256' },
    ], outputs: [{ type: 'uint256' }] },
] as const;
```

---

## Security Checklist for Claude Code

Before finishing any implementation, verify every item on this list:

**Proposal Submission**
- [ ] `proposalText` length is enforced both in contract (`<= 5000`) and frontend
- [ ] `hasAction = false` forces `actionTarget = address(0)` and `actionValue = 0` in contract
- [ ] Treasury 10% cap is checked at submission AND at execution
- [ ] Cooldown is enforced per citizen address

**AI Evaluation**
- [ ] All AI input data is read from the contract — never from request body
- [ ] `temperature: 0` is set on every AI call
- [ ] AI response is validated for required fields before hashing
- [ ] If AI approves an action, backend verifies AI echoed back exact target + value
- [ ] `requestBodyJson` is the exact string used in the API call (serialized once, reused)

**Signature Verification**
- [ ] Signature fetch retries with backoff — signatures are async
- [ ] `verifyHashes` runs before any onchain submission
- [ ] `sig.text` format is `"sha256_request_hex:sha256_response_hex"` — split on first colon

**Onchain Submission**
- [ ] `submitAIDecision` reads `teeSignedText` segments and compares to `bytes32` values
- [ ] `_bytes32ToHexString` is consistent with how backend produces hex strings
- [ ] `executeProposal` uses stored proposal values only — no calldata parameters for action
- [ ] `nonReentrant` on both `submitAIDecision` and `executeProposal`

**TEE Attestation**
- [ ] Re-attestation cron runs every 23 hours (before 24h TTL expires)
- [ ] `registerTEESigner` is only callable by owner
- [ ] `isTEETrusted` checks both `trusted` flag AND `expiresAt`

**Frontend**
- [ ] After `submitProposal` tx, proposalId is read from the transaction receipt event log
  (not from a guess based on proposalCount — parse the `ProposalSubmitted` event)
- [ ] Backend URL is never exposed as a user-configurable value

---

## Known Limitations and TODOs

These are intentional simplifications for v1. Leave TODO comments in code.

- TODO: Parse `ProposalSubmitted` event from tx receipt to get exact proposalId
  (current placeholder uses a `/proposals/latest-id` endpoint — implement this in backend
  by reading `proposalCount` from contract after a tx is mined)
- TODO: Implement full Intel TDX quote parsing in attestation service
  (current code logs the quote but delegates to `redpill-verify` SDK for full verification)
- TODO: Proposal list page with pagination (read events or maintain offchain index)
- TODO: Proposal detail page showing full proof (teeAddress, hashes, attestation link)
- TODO: Owner admin panel for updating model and constitution
- TODO: Add `proposalCooldown` UI indicator so users know when they can next submit

---

## Reference

- RedPill integration details: `redpill.md` (in this repo)
- RedPill docs: https://docs.redpill.ai
- RedPill signature API: `GET https://api.redpill.ai/v1/signature/{request_id}`
- RedPill attestation API: `GET https://api.redpill.ai/v1/attestation/report`
- OpenZeppelin v5: https://docs.openzeppelin.com/contracts/5.x
- wagmi v2: https://wagmi.sh
- viem: https://viem.sh
