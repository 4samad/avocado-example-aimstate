// Single source of truth lives at the workspace root: /constitution.json
// Both this file and the hardhat deploy script import from there.
// To update the constitution: edit constitution.json, then run `yarn deploy`.
import constitutionJson from "../../../constitution.json";

export const CONSTITUTION: string = constitutionJson.text;
