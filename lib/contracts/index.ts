/// Barrel re-export. Existing `import { ... } from "@/lib/contracts"` sites
/// continue to work; new code is encouraged to import from the leaf modules
/// (`@/lib/contracts/abi`, `@/lib/contracts/addresses`, `@/lib/contracts/explorer`)
/// for explicitness.

export { ERC20_ABI, EQUIFLOW_VAULT_ABI } from "./abi";
export {
  STOCK_TOKEN_ADDRESSES,
  EQUIFLOW_VAULT_ADDRESS,
  USDC_ADDRESS,
} from "./addresses";
export { shortAddr, explorerTx, explorerAddr } from "./explorer";
