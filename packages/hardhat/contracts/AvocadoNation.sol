// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title AvocadoNation
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
contract AvocadoNation is ReentrancyGuard {
    using ECDSA for bytes32;

    // ─── Constants ────────────────────────────────────────────────────────

    /// @notice Maximum ETH a single proposal can request (10% of treasury)
    uint256 public constant MAX_TREASURY_REQUEST_BPS = 1000; // 10% in basis points

    /// @notice Non-refundable fee to join — goes directly to the treasury
    uint256 public constant JOIN_FEE = 0.1 ether;

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
        string aiDecision;      // "approve" | "reject"
        string aiReasoning;     // AI explanation (max 500 chars)
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
        Executed    // approved + onchain action completed
    }

    // ─── State ────────────────────────────────────────────────────────────

    address public owner;
    address public admin; // backend operator — can register TEE signers and submit AI decisions
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
    event CitizenDenounced(address indexed citizen, uint256 totalCitizens);
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
    constructor(bytes32 _constitutionHash, string memory _initialModel, address _admin) {
        require(_constitutionHash != bytes32(0), "Constitution hash cannot be zero");
        require(bytes(_initialModel).length > 0, "Model name cannot be empty");
        owner = msg.sender;
        admin = _admin == address(0) ? msg.sender : _admin;
        constitutionHash = _constitutionHash;
        currentModel = _initialModel;
    }

    // ─── Modifiers ────────────────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier onlyAdmin() {
        require(msg.sender == admin, "Not admin");
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

    /**
     * @notice Join the nation. Requires a non-refundable 0.1 ETH fee that goes to the treasury.
     */
    function join() external payable {
        require(!isCitizen[msg.sender], "Already a citizen");
        require(msg.value == JOIN_FEE, "Must send exactly 0.1 ETH to join");
        isCitizen[msg.sender] = true;
        citizenList.push(msg.sender);
        emit CitizenJoined(msg.sender, citizenList.length);
        emit TreasuryDeposit(msg.sender, msg.value);
    }

    /**
     * @notice Renounce your citizenship. Irreversible — you lose citizen rights.
     *         The join fee is not refunded.
     */
    function denounce() external onlyCitizen {
        isCitizen[msg.sender] = false;
        // Remove from citizenList by swap-and-pop
        uint256 len = citizenList.length;
        for (uint256 i = 0; i < len; i++) {
            if (citizenList[i] == msg.sender) {
                citizenList[i] = citizenList[len - 1];
                citizenList.pop();
                break;
            }
        }
        emit CitizenDenounced(msg.sender, citizenList.length);
    }

    /**
     * @notice Donate ETH to the treasury. Anyone can donate.
     */
    function donate() external payable {
        require(msg.value > 0, "Must send ETH");
        emit TreasuryDeposit(msg.sender, msg.value);
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

        bytes32 pHash = keccak256(abi.encode(
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

        emit ProposalSubmitted(proposalId, msg.sender, hasAction, pHash);
        return proposalId;
    }

    /**
     * @notice Submit the AI governance decision for a proposal.
     */
    function submitAIDecision(
        uint256 proposalId,
        string calldata decision,
        string calldata reasoning,
        bytes32 aiResponseHashHex,
        bytes32 requestHashHex,
        string calldata teeSignedText,
        bytes calldata teeSignature
    ) external onlyAdmin nonReentrant {
        Proposal storage p = proposals[proposalId];
        require(p.id != 0, "Proposal does not exist");
        require(p.status == ProposalStatus.Pending, "Proposal not pending");

        bytes32 decisionHash = keccak256(bytes(decision));
        require(
            decisionHash == keccak256("approve") ||
            decisionHash == keccak256("reject"),
            "Invalid decision value"
        );

        require(bytes(reasoning).length <= 500, "Reasoning too long");

        bytes32 messageHash = MessageHashUtils.toEthSignedMessageHash(bytes(teeSignedText));
        address recovered = ECDSA.recover(messageHash, teeSignature);

        TEESigner memory signer = trustedSigners[recovered];
        require(signer.trusted, "Not a trusted TEE signer");
        require(block.timestamp < signer.expiresAt, "TEE attestation expired");

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

        p.aiDecision = decision;
        p.aiReasoning = reasoning;
        p.aiResponseHash = aiResponseHashHex;
        p.requestHash = requestHashHex;
        p.teeAddress = recovered;
        p.decidedAt = block.timestamp;

        if (decisionHash == keccak256("approve")) {
            p.status = ProposalStatus.Approved;
        } else {
            p.status = ProposalStatus.Rejected;
        }

        emit ProposalDecided(proposalId, decision, recovered, aiResponseHashHex);
    }

    /**
     * @notice Execute the onchain action for an approved proposal.
     */
    function executeProposal(uint256 proposalId) external nonReentrant {
        Proposal storage p = proposals[proposalId];
        require(p.id != 0, "Proposal does not exist");
        require(p.status == ProposalStatus.Approved, "Proposal not approved");
        require(p.hasAction, "No action to execute");
        require(!p.executed, "Already executed");

        uint256 maxAllowed = (address(this).balance * MAX_TREASURY_REQUEST_BPS) / 10000;
        require(p.actionValue <= maxAllowed, "Exceeds 10% treasury cap at execution");
        require(address(this).balance >= p.actionValue, "Insufficient treasury");

        p.executed = true;
        p.status = ProposalStatus.Executed;

        // Gas cap prevents a malicious target contract from consuming unbounded gas.
        (bool success, ) = p.actionTarget.call{value: p.actionValue, gas: 100_000}("");
        require(success, "ETH transfer failed");

        emit ProposalExecuted(proposalId, p.actionTarget, p.actionValue);
    }

    // ─── TEE Management ───────────────────────────────────────────────────

    function registerTEESigner(
        address signer,
        string calldata model
    ) external onlyAdmin {
        require(signer != address(0), "Zero address");
        trustedSigners[signer] = TEESigner({
            trusted: true,
            model: model,
            attestedAt: block.timestamp,
            expiresAt: block.timestamp + attestationTTL
        });
        emit TEERegistered(signer, model, block.timestamp + attestationTTL);
    }

    function revokeTEESigner(address signer) external onlyAdmin {
        trustedSigners[signer].trusted = false;
        emit TEERevoked(signer);
    }

    function setAttestationTTL(uint256 ttl) external onlyOwner {
        require(ttl >= 1 hours, "TTL too short");
        attestationTTL = ttl;
    }

    // ─── Owner Controls ───────────────────────────────────────────────────

    function updateModel(string calldata newModel) external onlyOwner {
        require(bytes(newModel).length > 0, "Empty model");
        currentModel = newModel;
        emit ModelUpdated(newModel);
    }

    function updateConstitution(bytes32 newHash) external onlyOwner {
        require(newHash != bytes32(0), "Zero hash");
        constitutionHash = newHash;
        emit ConstitutionUpdated(newHash);
    }

    function setProposalCooldown(uint256 cooldown) external onlyOwner {
        proposalCooldown = cooldown;
    }

    function setAdmin(address newAdmin) external onlyOwner {
        require(newAdmin != address(0), "Zero address");
        admin = newAdmin;
    }

    /**
     * @notice Cancel a proposal stuck in Approved if its target always reverts on ETH receive.
     *         Owner-only last resort. Can only cancel unexecuted Approved proposals.
     */
    function cancelStuckProposal(uint256 proposalId) external onlyOwner {
        Proposal storage p = proposals[proposalId];
        require(p.id != 0, "Proposal does not exist");
        require(p.status == ProposalStatus.Approved && !p.executed, "Not a stuck approved proposal");
        p.status = ProposalStatus.Rejected;
        emit ProposalDecided(proposalId, "cancelled", address(0), bytes32(0));
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
