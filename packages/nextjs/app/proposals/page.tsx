"use client";

import Link from "next/link";
import { Address } from "@scaffold-ui/components";
import type { NextPage } from "next";
import { useReadContracts } from "wagmi";
import { useDeployedContractInfo, useScaffoldReadContract, useTargetNetwork } from "~~/hooks/scaffold-eth";

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

const Proposals: NextPage = () => {
  const { targetNetwork } = useTargetNetwork();

  const { data: proposalCount, isLoading: isCountLoading } = useScaffoldReadContract({
    contractName: "AvocadoNation",
    functionName: "proposalCount",
  });

  const { data: deployedContract } = useDeployedContractInfo({ contractName: "AvocadoNation" });

  const count = proposalCount ? Number(proposalCount) : 0;
  const ids = Array.from({ length: count }, (_, i) => i + 1);

  const { data: proposals, isLoading: isProposalsLoading } = useReadContracts({
    contracts: ids.map(id => ({
      address: deployedContract?.address,
      abi: deployedContract?.abi,
      functionName: "getProposal",
      args: [BigInt(id)],
    })),
    query: { enabled: count > 0 && !!deployedContract },
  });

  const isLoading = isCountLoading || (count > 0 && isProposalsLoading);

  return (
    <div className="flex flex-col items-center grow pt-10 px-4">
      <div className="max-w-3xl w-full">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-bold">Proposals</h1>
          <Link href="/proposals/new" className="btn btn-primary btn-sm">
            Submit Proposal
          </Link>
        </div>

        {isLoading && (
          <div className="flex justify-center py-16">
            <span className="loading loading-spinner loading-lg" />
          </div>
        )}

        {!isLoading && count === 0 && (
          <div className="text-center py-16 text-base-content/50">
            <p className="text-lg mb-4">No proposals yet.</p>
            <Link href="/proposals/new" className="btn btn-outline btn-sm">
              Be the first to submit
            </Link>
          </div>
        )}

        {!isLoading && proposals && proposals.length > 0 && (
          <div className="space-y-3">
            {[...proposals].reverse().map(result => {
              if (result.status !== "success" || !result.result) return null;
              const p = result.result as {
                id: bigint;
                citizen: `0x${string}`;
                proposalText: string;
                hasAction: boolean;
                status: number;
              };
              const proposalId = Number(p.id);
              const statusNum = Number(p.status);

              return (
                <Link
                  key={proposalId}
                  href={`/proposals/${proposalId}`}
                  className="card bg-base-200 hover:bg-base-300 transition-colors cursor-pointer block"
                >
                  <div className="card-body py-4 px-5">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-sm text-base-content/50">#{proposalId}</span>
                        <span className={`badge badge-sm ${STATUS_BADGE[statusNum]}`}>{STATUS_LABELS[statusNum]}</span>
                        {p.hasAction && <span className="badge badge-sm badge-outline">ETH transfer</span>}
                      </div>
                      <div className="flex items-center gap-2 text-sm text-base-content/60">
                        <span>by</span>
                        <Address address={p.citizen} chain={targetNetwork} size="sm" disableAddressLink />
                      </div>
                    </div>
                    <p className="text-sm text-base-content/70 line-clamp-2">
                      {p.proposalText.length > 120 ? p.proposalText.slice(0, 120) + "…" : p.proposalText}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default Proposals;
