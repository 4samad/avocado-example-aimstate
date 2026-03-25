import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { ethers } from "ethers";
import constitutionJson from "../../../constitution.json";

const DEFAULT_MODEL = "openai/gpt-oss-120b";

const deployAvocadoNation: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  const constitutionHash = ethers.keccak256(ethers.toUtf8Bytes(constitutionJson.text));
  const model = process.env.REDPILL_MODEL || DEFAULT_MODEL;
  const adminAddress = process.env.ADMIN_ADDRESS || deployer;

  console.log("Constitution hash:", constitutionHash);
  console.log("Model:", model);
  console.log("Admin address:", adminAddress);

  await deploy("AvocadoNation", {
    from: deployer,
    args: [constitutionHash, model, adminAddress],
    log: true,
    autoMine: true,
  });
};

export default deployAvocadoNation;

deployAvocadoNation.tags = ["AvocadoNation"];
