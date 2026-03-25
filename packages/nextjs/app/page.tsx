"use client";

import { useState } from "react";
import Link from "next/link";
import type { NextPage } from "next";
import { formatEther, parseEther } from "viem";
import { useAccount } from "wagmi";
import { useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { notification } from "~~/utils/scaffold-eth";

const JOIN_FEE = parseEther("0.1");

const Home: NextPage = () => {
  const { address, isConnected } = useAccount();
  const [donateAmount, setDonateAmount] = useState("");
  const [isDonating, setIsDonating] = useState(false);

  const { data: citizenCount } = useScaffoldReadContract({
    contractName: "AvocadoNation",
    functionName: "citizenCount",
  });

  const { data: treasuryBalance, refetch: refetchTreasury } = useScaffoldReadContract({
    contractName: "AvocadoNation",
    functionName: "treasuryBalance",
  });

  const { data: isCitizen, refetch: refetchCitizen } = useScaffoldReadContract({
    contractName: "AvocadoNation",
    functionName: "isCitizen",
    args: [address],
    query: { enabled: !!address },
  });

  const { writeContractAsync, isPending } = useScaffoldWriteContract({
    contractName: "AvocadoNation",
  });

  async function handleJoin() {
    try {
      await writeContractAsync({ functionName: "join", value: JOIN_FEE });
      await Promise.all([refetchCitizen(), refetchTreasury()]);
      notification.success("Welcome to Avocado Nation!");
    } catch (e: unknown) {
      notification.error(e instanceof Error ? e.message : "Failed to join");
    }
  }

  async function handleDenounce() {
    try {
      await writeContractAsync({ functionName: "denounce" });
      await refetchCitizen();
      notification.success("You have renounced your citizenship.");
    } catch (e: unknown) {
      notification.error(e instanceof Error ? e.message : "Failed to denounce");
    }
  }

  async function handleDonate() {
    const amount = parseFloat(donateAmount);
    if (!donateAmount || isNaN(amount) || amount <= 0) {
      notification.error("Enter a valid ETH amount");
      return;
    }
    setIsDonating(true);
    try {
      await writeContractAsync({ functionName: "donate", value: parseEther(donateAmount) });
      await refetchTreasury();
      setDonateAmount("");
      notification.success(`Donated ${donateAmount} ETH to the treasury!`);
    } catch (e: unknown) {
      notification.error(e instanceof Error ? e.message : "Donation failed");
    } finally {
      setIsDonating(false);
    }
  }

  return (
    <div className="flex flex-col items-center grow pt-10 px-4">
      <div className="max-w-2xl w-full">
        <h1 className="text-4xl font-bold mb-2">Avocado Nation</h1>
        <p className="text-base-content/60 mb-10">
          An equality-first nation governed by verifiable AI. No human voting. No multisig.
        </p>

        <div className="grid grid-cols-2 gap-4 mb-10">
          <div className="stat bg-base-200 rounded-box">
            <div className="stat-title">Citizens</div>
            <div className="stat-value">{citizenCount !== undefined ? citizenCount.toString() : "—"}</div>
          </div>
          <div className="stat bg-base-200 rounded-box">
            <div className="stat-title">Treasury</div>
            <div className="stat-value text-2xl">
              {treasuryBalance !== undefined ? parseFloat(formatEther(treasuryBalance)).toFixed(4) + " ETH" : "—"}
            </div>
          </div>
        </div>

        <div className="flex gap-3 mb-10">
          <Link href="/proposals" className="btn btn-outline">
            View Proposals
          </Link>
          <Link href="/proposals/new" className="btn btn-primary">
            Submit Proposal
          </Link>
        </div>

        {isConnected && (
          <div className="space-y-4 mb-10">
            {/* Citizenship card */}
            <div className="card bg-base-200 rounded-box p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Citizenship Status</p>
                  <p className="text-sm text-base-content/60">
                    {isCitizen === undefined
                      ? "Checking..."
                      : isCitizen
                        ? "You are a citizen"
                        : "Not yet a citizen — costs 0.1 ETH (non-refundable)"}
                  </p>
                </div>
                <div className="flex gap-2 items-center">
                  {isCitizen === false && (
                    <button className="btn btn-sm btn-secondary" onClick={handleJoin} disabled={isPending}>
                      {isPending ? <span className="loading loading-spinner loading-sm" /> : "Join (0.1 ETH)"}
                    </button>
                  )}
                  {isCitizen && (
                    <>
                      <div className="badge badge-success">Active</div>
                      <button className="btn btn-sm btn-ghost text-error" onClick={handleDenounce} disabled={isPending}>
                        Denounce
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Donate card */}
            <div className="card bg-base-200 rounded-box p-6">
              <p className="font-medium mb-3">Donate to Treasury</p>
              <div className="flex gap-2">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="ETH amount"
                  className="input input-bordered input-sm flex-1"
                  value={donateAmount}
                  onChange={e => setDonateAmount(e.target.value)}
                />
                <button className="btn btn-sm btn-outline" onClick={handleDonate} disabled={isDonating || isPending}>
                  {isDonating ? <span className="loading loading-spinner loading-sm" /> : "Donate"}
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="divider my-6" />

        <div className="space-y-4 text-sm text-base-content/70">
          <h2 className="text-base font-semibold text-base-content">How it works</h2>
          <ol className="list-decimal list-inside space-y-2">
            <li>Join the state — pay 0.1 ETH (non-refundable) to register as a citizen</li>
            <li>Submit a proposal — text-only or with an ETH transfer request (max 10% of treasury)</li>
            <li>The AI evaluates it against the constitution and makes a final decision</li>
            <li>The AI&#39;s decision is cryptographically signed by a TEE and verified onchain</li>
            <li>Approved proposals with actions execute automatically — no human can block or modify them</li>
          </ol>
        </div>
      </div>
    </div>
  );
};

export default Home;
