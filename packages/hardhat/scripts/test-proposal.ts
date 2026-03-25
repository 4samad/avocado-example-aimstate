import { ethers } from "hardhat";

async function main() {
  const [owner] = await ethers.getSigners();
  const contract = await ethers.getContractAt("AvocadoNation", "0x5FbDB2315678afecb367f032d93F642f64180aa3");

  let tx = await owner.sendTransaction({ to: await contract.getAddress(), value: ethers.parseEther("1") });
  await tx.wait();
  console.log("Funded treasury with 1 ETH");

  tx = await contract.join({ gasLimit: 200000 });
  await tx.wait();
  console.log("Joined as citizen:", owner.address);

  tx = await contract.submitProposal(
    "Allocate 0.1 ETH from treasury to fund community documentation improvements",
    false,
    ethers.ZeroAddress,
    0n,
    { gasLimit: 500000 },
  );
  const receipt = await tx.wait();
  const log = receipt!.logs.find((l: any) => {
    try {
      return contract.interface.parseLog(l as any)?.name === "ProposalSubmitted";
    } catch {
      return false;
    }
  });
  const parsed = contract.interface.parseLog(log as any);
  console.log("Proposal ID:", parsed!.args.proposalId.toString());
}

main().catch(console.error);
