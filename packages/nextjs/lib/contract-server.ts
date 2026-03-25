// Server-only — never import this in client components
// Uses ethers.js directly for server-side contract writes.
// Frontend uses useScaffoldReadContract / useScaffoldWriteContract instead.
import type { AIOutput } from "./ai";
import { type RedPillSignature, extractResponseHash, sha256Hex } from "./signature";
import { ethers } from "ethers";
import deployedContracts from "~~/contracts/deployedContracts";

// Minimal ABI — only what the server-side backend needs
const ABI = [
  "function submitAIDecision(uint256 proposalId, string decision, string reasoning, bytes32 aiResponseHashHex, bytes32 requestHashHex, string teeSignedText, bytes teeSignature) external",
  "function executeProposal(uint256 proposalId) external",
  "function registerTEESigner(address signer, string model) external",
  "function isTEETrusted(address signer) external view returns (bool)",
  "function admin() external view returns (address)",
  "function getProposal(uint256 proposalId) external view returns (tuple(uint256 id, address citizen, string proposalText, bool hasAction, address actionTarget, uint256 actionValue, bytes32 constitutionHash, uint8 status, string aiDecision, string aiReasoning, bytes32 aiResponseHash, bytes32 requestHash, address teeAddress, uint256 decidedAt, bool executed))",
  "function getProposalHash(uint256 proposalId) external view returns (bytes32)",
  "function constitutionHash() external view returns (bytes32)",
  "function treasuryBalance() external view returns (uint256)",
  "function citizenCount() external view returns (uint256)",
];

function getRpcUrl(): string {
  if (process.env.RPC_URL) return process.env.RPC_URL;
  const alchemyKey = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY;
  if (alchemyKey) return `https://eth-sepolia.g.alchemy.com/v2/${alchemyKey}`;
  throw new Error("No RPC URL configured. Set RPC_URL or NEXT_PUBLIC_ALCHEMY_API_KEY.");
}

function getProvider() {
  return new ethers.JsonRpcProvider(getRpcUrl());
}

function getSigner() {
  return new ethers.Wallet(process.env.ADMIN_PRIVATE_KEY!, getProvider());
}

async function getContractAddress(): Promise<string> {
  // Prefer explicit env var (e.g. for testnet) — falls back to deployedContracts.ts
  if (process.env.CONTRACT_ADDRESS) return process.env.CONTRACT_ADDRESS;

  const provider = getProvider();
  const { chainId } = await provider.getNetwork();
  const chainContracts = (deployedContracts as Record<string, Record<string, { address: string }>>)[chainId.toString()];
  const address = chainContracts?.["AvocadoNation"]?.address;
  if (!address) throw new Error(`AvocadoNation not deployed on chain ${chainId}. Run yarn deploy first.`);
  return address;
}

export async function getGovernanceContract(write = true) {
  const address = await getContractAddress();
  return write ? new ethers.Contract(address, ABI, getSigner()) : new ethers.Contract(address, ABI, getProvider());
}

/**
 * Convert a SHA-256 hex string (64 chars) to a bytes32 hex string.
 */
function hexStringToBytes32(hex: string): string {
  const clean = hex.replace(/^0x/, "").padStart(64, "0");
  return "0x" + clean;
}

export async function submitAIDecisionOnchain(
  proposalId: number,
  output: AIOutput,
  sig: RedPillSignature,
  requestBodyJson: string,
): Promise<string> {
  const contract = await getGovernanceContract();

  const requestHashHex = hexStringToBytes32(sha256Hex(requestBodyJson));
  // Use the TEE-signed response hash directly — gateway transforms the raw response
  // before delivery, so we cannot recompute it locally.
  const responseHashHex = hexStringToBytes32(extractResponseHash(sig));
  const sigBytes = ethers.getBytes(sig.signature);

  const reasoning = output.reasoning.slice(0, 500);

  const tx = await contract.submitAIDecision(
    proposalId,
    output.decision,
    reasoning,
    responseHashHex,
    requestHashHex,
    sig.text,
    sigBytes,
  );

  const receipt = await tx.wait();
  console.log(`AI decision submitted onchain. Tx: ${receipt.hash}`);
  return receipt.hash;
}

export async function executeProposalOnchain(proposalId: number): Promise<string> {
  const contract = await getGovernanceContract();
  const tx = await contract.executeProposal(proposalId);
  const receipt = await tx.wait();
  console.log(`Proposal executed onchain. Tx: ${receipt.hash}`);
  return receipt.hash;
}
