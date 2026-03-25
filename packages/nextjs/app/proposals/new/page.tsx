"use client";

import { useState } from "react";
import Link from "next/link";
import type { NextPage } from "next";
import { isAddress, parseEther, parseEventLogs } from "viem";
import { useAccount, usePublicClient } from "wagmi";
import { useDeployedContractInfo, useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { notification } from "~~/utils/scaffold-eth";

const JOIN_FEE = parseEther("0.1");

type EvalResult = {
  proposalId: number;
  decision: "approve" | "reject";
  reasoning: string;
  constitutional_alignment: number;
  risk_flags: string[];
  decisionTxHash: string;
  executionTxHash: string | null;
  teeSigningAddress: string;
};

const NewProposal: NextPage = () => {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();

  const [proposalText, setProposalText] = useState("");
  const [hasAction, setHasAction] = useState(false);
  const [actionTarget, setActionTarget] = useState("");
  const [actionValueEth, setActionValueEth] = useState("");
  const [status, setStatus] = useState("");
  const [result, setResult] = useState<EvalResult | null>(null);

  const { data: isCitizen, refetch: refetchCitizen } = useScaffoldReadContract({
    contractName: "AvocadoNation",
    functionName: "isCitizen",
    args: [address],
    query: { enabled: !!address },
  });

  const { data: deployedContract } = useDeployedContractInfo({ contractName: "AvocadoNation" });

  const { writeContractAsync: join, isPending: isJoining } = useScaffoldWriteContract({
    contractName: "AvocadoNation",
  });

  const { writeContractAsync: submitProposal, isPending: isSubmitting } = useScaffoldWriteContract({
    contractName: "AvocadoNation",
  });

  async function handleJoin() {
    try {
      await join({ functionName: "join", value: JOIN_FEE });
      await refetchCitizen();
      notification.success("You are now a citizen!");
    } catch (e: unknown) {
      notification.error(e instanceof Error ? e.message : "Failed to join");
    }
  }

  async function handleSubmit() {
    if (!proposalText.trim() || !deployedContract || !publicClient) return;

    setStatus("Submitting proposal onchain...");
    setResult(null);

    try {
      if (hasAction && actionTarget && !isAddress(actionTarget)) {
        notification.error("Invalid recipient address");
        setStatus("");
        return;
      }

      const target = (
        hasAction && actionTarget ? actionTarget : "0x0000000000000000000000000000000000000000"
      ) as `0x${string}`;
      const value = hasAction && actionValueEth ? parseEther(actionValueEth) : 0n;

      const txHash = await submitProposal({
        functionName: "submitProposal",
        args: [proposalText, hasAction, target, value],
      });

      setStatus("Waiting for confirmation...");

      // Parse the ProposalSubmitted event from the receipt to get the exact proposalId
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash as `0x${string}` });

      const logs = parseEventLogs({
        abi: deployedContract.abi,
        logs: receipt.logs,
        eventName: "ProposalSubmitted",
      });

      if (!logs.length) throw new Error("ProposalSubmitted event not found in receipt");

      const proposalId = Number((logs[0].args as { proposalId: bigint }).proposalId);

      setStatus(`Proposal #${proposalId} confirmed. Requesting AI evaluation...`);

      // Trigger backend evaluation — backend reads all data from the contract
      const evalResponse = await fetch("/api/proposals/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposalId }),
      });

      const evalResult = await evalResponse.json();
      if (!evalResponse.ok) throw new Error(evalResult.error);

      setResult(evalResult);
      setStatus("");

      if (evalResult.decision === "approve") {
        notification.success(`Proposal #${proposalId} approved!`);
      } else {
        notification.error(`Proposal #${proposalId} rejected.`);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setStatus("");
      notification.error(msg);
    }
  }

  if (!isConnected) {
    return (
      <div className="flex flex-col items-center grow pt-10 px-4">
        <div className="max-w-2xl w-full text-center py-16">
          <p className="text-lg mb-4">Connect your wallet to submit a proposal.</p>
        </div>
      </div>
    );
  }

  if (isCitizen === false) {
    return (
      <div className="flex flex-col items-center grow pt-10 px-4">
        <div className="max-w-2xl w-full">
          <h1 className="text-2xl font-bold mb-4">Join the State First</h1>
          <p className="text-base-content/60 mb-6">You must be a citizen to submit proposals.</p>
          <button className="btn btn-secondary" onClick={handleJoin} disabled={isJoining}>
            {isJoining ? <span className="loading loading-spinner loading-sm" /> : "Join Avocado Nation (0.1 ETH)"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center grow pt-10 px-4">
      <div className="max-w-2xl w-full">
        <div className="mb-6">
          <Link href="/proposals" className="text-sm text-base-content/50 hover:text-base-content">
            ← Proposals
          </Link>
        </div>

        <h1 className="text-2xl font-bold mb-8">Submit a Proposal</h1>

        <div className="space-y-6">
          <div className="form-control">
            <label className="label">
              <span className="label-text font-medium">Proposal (max 5000 chars)</span>
              <span className="label-text-alt text-base-content/50">{proposalText.length}/5000</span>
            </label>
            <textarea
              className="textarea textarea-bordered h-40 text-sm"
              placeholder="Describe your proposal clearly. If requesting funds, explain the genuine need."
              value={proposalText}
              onChange={e => setProposalText(e.target.value)}
              maxLength={5000}
              disabled={!!status}
            />
          </div>

          <div className="form-control">
            <label className="label cursor-pointer justify-start gap-3">
              <input
                type="checkbox"
                className="checkbox checkbox-sm"
                checked={hasAction}
                onChange={e => setHasAction(e.target.checked)}
                disabled={!!status}
              />
              <span className="label-text">This proposal requests an ETH transfer from the treasury</span>
            </label>
          </div>

          {hasAction && (
            <div className="space-y-4 pl-4 border-l-2 border-base-300">
              <div className="form-control">
                <label className="label">
                  <span className="label-text font-medium">Recipient Address</span>
                </label>
                <input
                  type="text"
                  className="input input-bordered font-mono text-sm"
                  placeholder="0x..."
                  value={actionTarget}
                  onChange={e => setActionTarget(e.target.value)}
                  disabled={!!status}
                />
              </div>
              <div className="form-control">
                <label className="label">
                  <span className="label-text font-medium">Amount (ETH)</span>
                  <span className="label-text-alt text-base-content/50">Max 10% of treasury</span>
                </label>
                <input
                  type="number"
                  step="0.001"
                  min="0"
                  className="input input-bordered text-sm"
                  placeholder="0.0"
                  value={actionValueEth}
                  onChange={e => setActionValueEth(e.target.value)}
                  disabled={!!status}
                />
              </div>
            </div>
          )}

          <button
            className="btn btn-primary w-full"
            onClick={handleSubmit}
            disabled={!proposalText.trim() || !!status || isSubmitting}
          >
            {status ? <span className="loading loading-spinner loading-sm" /> : "Submit Proposal"}
          </button>

          {status && <p className="text-sm text-base-content/60 text-center">{status}</p>}

          {result && (
            <div
              className={`card ${result.decision === "approve" ? "bg-success/10 border border-success/30" : "bg-error/10 border border-error/30"}`}
            >
              <div className="card-body py-5 px-6 space-y-3">
                <div className="flex items-center gap-2">
                  <span
                    className={`badge ${result.decision === "approve" ? "badge-success" : "badge-error"} badge-lg capitalize`}
                  >
                    {result.decision}
                  </span>
                  <span className="text-sm text-base-content/60">
                    Constitutional alignment: {result.constitutional_alignment}/100
                  </span>
                </div>

                <p className="text-sm">{result.reasoning}</p>

                {result.risk_flags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {result.risk_flags.map((flag, i) => (
                      <span key={i} className="badge badge-outline badge-sm">
                        {flag}
                      </span>
                    ))}
                  </div>
                )}

                <div className="text-xs text-base-content/50 space-y-1 pt-1 border-t border-base-content/10">
                  <div>
                    TEE signer: <span className="font-mono">{result.teeSigningAddress}</span>
                  </div>
                  <div>
                    Decision tx: <span className="font-mono">{result.decisionTxHash}</span>
                  </div>
                  {result.executionTxHash && (
                    <div>
                      Execution tx: <span className="font-mono">{result.executionTxHash}</span>
                    </div>
                  )}
                </div>

                <Link href={`/proposals/${result.proposalId}`} className="btn btn-sm btn-outline w-full mt-1">
                  View Proposal Detail
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default NewProposal;
