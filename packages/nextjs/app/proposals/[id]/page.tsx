"use client";

import { use } from "react";
import Link from "next/link";
import { Address } from "@scaffold-ui/components";
import type { NextPage } from "next";
import { formatEther } from "viem";
import { useScaffoldReadContract, useScaffoldWriteContract, useTargetNetwork } from "~~/hooks/scaffold-eth";
import { notification } from "~~/utils/scaffold-eth";

const STATUS_LABELS: Record<number, string> = {
  0: "Pending",
  1: "Approved",
  2: "Rejected",
  3: "Executed",
};

const STATUS_BADGE: Record<number, string> = {
  0: "badge-warning",
  1: "badge-success",
  2: "badge-error",
  3: "badge-neutral",
};

const ProposalDetail: NextPage<{ params: Promise<{ id: string }> }> = ({ params }) => {
  const { id } = use(params);
  const proposalId = BigInt(id);
  const { targetNetwork } = useTargetNetwork();

  const {
    data: proposal,
    isLoading,
    refetch,
  } = useScaffoldReadContract({
    contractName: "AvocadoNation",
    functionName: "getProposal",
    args: [proposalId],
  });

  const { writeContractAsync: executeProposal, isPending: isExecuting } = useScaffoldWriteContract({
    contractName: "AvocadoNation",
  });

  async function handleExecute() {
    try {
      await executeProposal({ functionName: "executeProposal", args: [proposalId] });
      await refetch();
      notification.success("Proposal executed!");
    } catch (e: unknown) {
      notification.error(e instanceof Error ? e.message : "Execution failed");
    }
  }

  if (isLoading) {
    return (
      <div className="flex justify-center pt-20">
        <span className="loading loading-spinner loading-lg" />
      </div>
    );
  }

  if (!proposal || (proposal as { id: bigint }).id === 0n) {
    return (
      <div className="flex flex-col items-center grow pt-10 px-4">
        <div className="max-w-2xl w-full">
          <p className="text-base-content/50">Proposal #{id} not found.</p>
          <Link href="/proposals" className="btn btn-outline btn-sm mt-4">
            Back to Proposals
          </Link>
        </div>
      </div>
    );
  }

  const p = proposal as {
    id: bigint;
    citizen: `0x${string}`;
    proposalText: string;
    hasAction: boolean;
    actionTarget: `0x${string}`;
    actionValue: bigint;
    constitutionHash: `0x${string}`;
    status: number;
    aiDecision: string;
    aiReasoning: string;
    aiResponseHash: `0x${string}`;
    requestHash: `0x${string}`;
    teeAddress: `0x${string}`;
    decidedAt: bigint;
    executed: boolean;
  };

  const statusNum = Number(p.status);
  const isDecided = statusNum > 0;
  const canExecute = statusNum === 1 && p.hasAction && !p.executed; // Approved (1) + has action + not yet executed

  return (
    <div className="flex flex-col items-center grow pt-10 px-4">
      <div className="max-w-2xl w-full space-y-6">
        <div className="mb-2">
          <Link href="/proposals" className="text-sm text-base-content/50 hover:text-base-content">
            ← Proposals
          </Link>
        </div>

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Proposal #{id}</h1>
            <div className="flex items-center gap-2 mt-2">
              <span className={`badge ${STATUS_BADGE[statusNum]}`}>{STATUS_LABELS[statusNum]}</span>
              {p.hasAction && <span className="badge badge-outline">ETH transfer</span>}
            </div>
          </div>
          {canExecute && (
            <button className="btn btn-success btn-sm" onClick={handleExecute} disabled={isExecuting}>
              {isExecuting ? <span className="loading loading-spinner loading-xs" /> : "Execute"}
            </button>
          )}
        </div>

        {/* Proposal text */}
        <div className="card bg-base-200">
          <div className="card-body py-4 px-5">
            <h2 className="text-sm font-semibold text-base-content/50 mb-2">Proposal Text</h2>
            <p className="text-sm whitespace-pre-wrap">{p.proposalText}</p>
          </div>
        </div>

        {/* Submitter + action */}
        <div className="grid grid-cols-2 gap-4">
          <div className="card bg-base-200">
            <div className="card-body py-4 px-5">
              <h2 className="text-sm font-semibold text-base-content/50 mb-1">Submitted by</h2>
              <Address
                address={p.citizen}
                chain={targetNetwork}
                size="sm"
                blockExplorerAddressLink={
                  targetNetwork.id === 31337 ? `/blockexplorer/address/${p.citizen}` : undefined
                }
              />
            </div>
          </div>
          {p.hasAction && (
            <div className="card bg-base-200">
              <div className="card-body py-4 px-5">
                <h2 className="text-sm font-semibold text-base-content/50 mb-1">Requested transfer</h2>
                <p className="text-sm font-mono">{formatEther(p.actionValue)} ETH</p>
                <p className="text-xs font-mono text-base-content/50 truncate">to {p.actionTarget}</p>
              </div>
            </div>
          )}
        </div>

        {/* AI Decision */}
        {isDecided && (
          <div
            className={`card ${p.aiDecision === "approve" ? "bg-success/10 border border-success/30" : "bg-error/10 border border-error/30"}`}
          >
            <div className="card-body py-4 px-5 space-y-3">
              <h2 className="text-sm font-semibold text-base-content/50">AI Decision</h2>
              <div className="flex items-center gap-2">
                <span
                  className={`badge badge-lg capitalize ${p.aiDecision === "approve" ? "badge-success" : "badge-error"}`}
                >
                  {p.aiDecision}
                </span>
                <span className="text-sm text-base-content/60">
                  {new Date(Number(p.decidedAt) * 1000).toLocaleString()}
                </span>
              </div>
              {p.aiReasoning && <p className="text-sm">{p.aiReasoning}</p>}
            </div>
          </div>
        )}

        {/* Cryptographic Proof */}
        {isDecided && (
          <div className="card bg-base-200">
            <div className="card-body py-4 px-5 space-y-3">
              <h2 className="text-sm font-semibold text-base-content/50">Cryptographic Proof</h2>
              <p className="text-xs text-base-content/60">
                The AI decision is verified onchain via ECDSA signature from a TEE-attested instance. Every hash is
                stored permanently.
              </p>
              <div className="space-y-2 text-xs font-mono">
                <div>
                  <span className="text-base-content/50">TEE signer: </span>
                  <Address
                    address={p.teeAddress}
                    chain={targetNetwork}
                    size="xs"
                    blockExplorerAddressLink={
                      targetNetwork.id === 31337 ? `/blockexplorer/address/${p.teeAddress}` : undefined
                    }
                  />
                </div>
                <div>
                  <span className="text-base-content/50">Request hash: </span>
                  <span className="break-all">{p.requestHash}</span>
                </div>
                <div>
                  <span className="text-base-content/50">Response hash: </span>
                  <span className="break-all">{p.aiResponseHash}</span>
                </div>
                <div>
                  <span className="text-base-content/50">Constitution hash: </span>
                  <span className="break-all">{p.constitutionHash}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {!isDecided && (
          <div className="card bg-base-200">
            <div className="card-body py-4 px-5 text-sm text-base-content/60">
              This proposal is awaiting AI evaluation.
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ProposalDetail;
