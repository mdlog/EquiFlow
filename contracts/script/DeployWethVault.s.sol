// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {EquiFlowVault} from "../src/EquiFlowVault.sol";
import {PythAdapterRegistry} from "../src/oracle/PythAdapterRegistry.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Deploy a second EquiFlowVault with WETH as the borrowable asset.
///
/// Reuses the same contract bytecode as the USDG vault — only the underlying
/// token changes. Collateral assets (stock tokens) are shared; each vault
/// maintains its own utilization, rates, and LP pool.
///
/// Required env:
///   DEPLOYER_PK              — deployer private key
///   WETH_ADDRESS              — L2 WETH (0x7943e237c7F95DA44E0301572D358911207852Fa on RBN)
///   ADAPTER_REGISTRY          — T-4 fix (2026-05 pass 5): `PythAdapterRegistry`
///                                deployed by `Deploy.s.sol`. Each listed
///                                asset's adapter is looked up by priceId
///                                so this script CANNOT silently fall back
///                                to deploying duplicate adapters. The
///                                registry guarantees one adapter per
///                                priceId across all vault deployments —
///                                the keeper pushes once and both vaults
///                                see the fresh price atomically.
///
/// Optional env:
///   WETH_BORROW_RATE_BPS      — borrow rate (default 800 = 8%)
///   WETH_RESERVE_FACTOR_BPS   — reserve factor (default 1500 = 15%)
///   TREASURY_ADDRESS           — treasury recipient (default deployer)
///   TOKEN_<SYM>=<addr>         — live RBN stock token addresses
///
/// Usage:
///   source .env && forge script script/DeployWethVault.s.sol \
///     --rpc-url $RBN_RPC_URL --private-key $DEPLOYER_PK --broadcast
contract DeployWethVaultScript is Script {
    struct AssetSpec {
        string symbol;
        bytes32 priceId;
        int256 initialPriceE8;
        uint64 ltvBps;
        uint64 liqThresholdBps;
    }

    AssetSpec[] specs;

    function setUp() public {
        // Same collateral assets as the USDG vault, but with slightly more
        // conservative LTV caps since WETH is more volatile than USDG.
        specs.push(AssetSpec({
            symbol: "TSLA",
            priceId: 0x16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1,
            initialPriceE8: 348_51000000,
            ltvBps: 5000,
            liqThresholdBps: 6000
        }));
        specs.push(AssetSpec({
            symbol: "AMZN",
            priceId: 0xb5d0e0fa58a1f8b81498ae670ce93c872d14434b72c364885d4fa1b257cbb07a,
            initialPriceE8: 232_18000000,
            ltvBps: 6500,
            liqThresholdBps: 7500
        }));
        specs.push(AssetSpec({
            symbol: "PLTR",
            priceId: 0x11a70634863ddffb71f2b11f2cff29f73f3db8f6d0b78c49f2b5f4ad36e885f0,
            initialPriceE8: 156_04000000,
            ltvBps: 4500,
            liqThresholdBps: 5500
        }));
        specs.push(AssetSpec({
            symbol: "NFLX",
            priceId: 0x8376cfd7ca8bcdf372ced05307b24dced1f15b1afafdeff715664598f15a3dd2,
            initialPriceE8: 821_45000000,
            ltvBps: 5700,
            liqThresholdBps: 6700
        }));
        specs.push(AssetSpec({
            symbol: "AMD",
            priceId: 0x3622e381dbca2efd1859253763b1adc63f7f9abb8e76da1aa8e638a57ccde93e,
            initialPriceE8: 198_62000000,
            ltvBps: 5500,
            liqThresholdBps: 6500
        }));
    }

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PK");
        address deployer = vm.addr(pk);
        console2.log("Deployer:", deployer);

        vm.startBroadcast(pk);

        // ─── 1. WETH token (must be set, no mock fallback) ──────────────
        address wethAddr = vm.envAddress("WETH_ADDRESS");
        require(wethAddr != address(0), "WETH_ADDRESS required");
        uint8 wethDec = _readDecimalsOr(wethAddr, 18);
        console2.log("WETH address:", wethAddr);
        console2.log("  decimals:", uint256(wethDec));

        // ─── 2. Adapter registry from the USDG-vault deploy ────────────
        address registryAddr = vm.envAddress("ADAPTER_REGISTRY");
        require(registryAddr != address(0), "ADAPTER_REGISTRY required");
        PythAdapterRegistry adapterRegistry = PythAdapterRegistry(registryAddr);
        console2.log("Adapter registry:", registryAddr);

        // ─── 3. Deploy WETH Vault ───────────────────────────────────────
        uint256 borrowRateBps = vm.envOr("WETH_BORROW_RATE_BPS", uint256(800));
        uint256 reserveFactorBps = vm.envOr("WETH_RESERVE_FACTOR_BPS", uint256(1500));
        address treasury = vm.envOr("TREASURY_ADDRESS", deployer);

        EquiFlowVault wethVault = new EquiFlowVault(
            IERC20(wethAddr),
            wethDec,
            borrowRateBps,
            reserveFactorBps,
            treasury,
            deployer
        );
        console2.log("WETH EquiFlowVault deployed:", address(wethVault));
        console2.log("  borrowRateBps:", borrowRateBps);
        console2.log("  reserveFactorBps:", reserveFactorBps);

        // ─── 4. Per-asset: reuse stock tokens + adapter (or deploy new) ──
        for (uint256 i; i < specs.length; ++i) {
            AssetSpec memory s = specs[i];

            string memory tokenKey = string.concat("TOKEN_", s.symbol);
            address tokenAddr = _envAddrOr(tokenKey, address(0));
            require(tokenAddr != address(0), string.concat("Missing ", tokenKey));
            console2.log(string.concat("Stock ", s.symbol, ":"), tokenAddr);

            // T-4 fix (2026-05 pass 5): resolve the canonical adapter via
            // the registry. There is no fallback — if the registry has no
            // entry for this priceId, the deploy reverts. Forces the
            // operator to register the adapter first (via the USDG-vault
            // deploy or a manual `registry.register(...)` call).
            bytes32 priceId = _envBytes32Or(
                string.concat("PRICE_ID_", s.symbol),
                s.priceId
            );
            address adapterAddr = adapterRegistry.adapterOf(priceId);
            require(
                adapterAddr != address(0),
                string.concat(
                    "Adapter not registered for ",
                    s.symbol,
                    " - run Deploy.s.sol first or call registry.register()"
                )
            );
            console2.log(string.concat("  Adapter ", s.symbol, ":"), adapterAddr);

            wethVault.listAsset(
                tokenAddr,
                adapterAddr,
                s.ltvBps,
                s.liqThresholdBps,
                1 hours
            );

            wethVault.setMaxConfidenceWidth(tokenAddr, 150);
        }

        vm.stopBroadcast();

        // ─── 5. Print env block ─────────────────────────────────────────
        console2.log("");
        console2.log("================================================================");
        console2.log(" Add to app/.env.local:");
        console2.log("================================================================");
        console2.log("NEXT_PUBLIC_WETH_VAULT_ADDRESS=", address(wethVault));
        console2.log("NEXT_PUBLIC_WETH_ADDRESS=", wethAddr);
    }

    function _envAddrOr(string memory key, address fallback_) internal view returns (address) {
        try vm.envAddress(key) returns (address v) {
            return v == address(0) ? fallback_ : v;
        } catch {
            return fallback_;
        }
    }

    function _envBytes32Or(string memory key, bytes32 fallback_) internal view returns (bytes32) {
        try vm.envBytes32(key) returns (bytes32 v) {
            return v == bytes32(0) ? fallback_ : v;
        } catch {
            return fallback_;
        }
    }

    function _readDecimalsOr(address token, uint8 fallback_) internal view returns (uint8) {
        (bool ok, bytes memory ret) = token.staticcall(abi.encodeWithSignature("decimals()"));
        if (!ok || ret.length < 32) return fallback_;
        return abi.decode(ret, (uint8));
    }
}
