// ABI fragments the keeper needs. Custom-error fragments are included so viem
// can decode revert NAMES (ContractFunctionRevertedError.data.errorName) — see
// docs/contracts/keeper-relay-spec.md §7/§11.

export const ADAPTER_ABI = [
  { type: "function", name: "updatePrice", stateMutability: "payable", inputs: [{ name: "updateData", type: "bytes[]" }], outputs: [] },
  { type: "function", name: "forceUpdatePrice", stateMutability: "payable", inputs: [{ name: "updateData", type: "bytes[]" }], outputs: [] },
  {
    type: "function", name: "latestRoundData", stateMutability: "view", inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
  { type: "function", name: "priceId", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "confidence", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
  // ── custom errors (so viem decodes the revert name) ──
  { type: "error", name: "PublishTimeTooOld", inputs: [{ name: "publishTime", type: "uint256" }, { name: "blockTimestamp", type: "uint256" }] },
  { type: "error", name: "InvalidPrice", inputs: [{ name: "raw", type: "int64" }] },
  { type: "error", name: "ExponentOutOfRange", inputs: [{ name: "expo", type: "int32" }] },
  { type: "error", name: "NotAuthorizedKeeper", inputs: [] },
  { type: "error", name: "StalePrice", inputs: [] }, // bubbled from Pyth.getPriceNoOlderThan
] as const;

export const REGISTRY_ABI = [
  { type: "function", name: "adapterOf", stateMutability: "view", inputs: [{ name: "priceId", type: "bytes32" }], outputs: [{ type: "address" }] },
] as const;
