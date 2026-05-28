// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {EquiFlowVault} from "../src/EquiFlowVault.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";
import {MockStockToken} from "../src/mocks/MockStockToken.sol";
import {MockPyth} from "@pythnetwork/pyth-sdk-solidity/MockPyth.sol";
import {IPyth} from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import {PythPriceAdapter} from "../src/oracle/PythPriceAdapter.sol";
import {PythAdapterRegistry} from "../src/oracle/PythAdapterRegistry.sol";
import {KinkedRateModel} from "../src/interest/KinkedRateModel.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice EquiFlow deploy script for Robinhood Chain Testnet (chainId 46630).
///
/// Price oracle: Pyth Network (via PythPriceAdapter).
/// - If PYTH_ADDRESS env is set, the script binds to that Pyth deployment
///   (used when deploying on a chain where Pyth is live, e.g. Arbitrum
///   Sepolia 0x4374e5a8b9C22271E9EB878A2AA31DE97DF15DAF).
/// - Otherwise it deploys MockPyth — wire-compatible, used on Robinhood Chain
///   which has no Pyth deployment.
///
/// Token / feed sources:
///   USDC_ADDRESS=<addr>              → live stablecoin (USDG on RBN); else MockUSDC
///   TOKEN_<SYM>=<addr>               → live RBN stock token; else MockStockToken
///   PRICE_ID_<SYM>=<bytes32>         → Pyth priceId (US equity, regular hours)
///
/// Usage:
///   source .env && forge script script/Deploy.s.sol \
///     --rpc-url $RBN_RPC_URL --private-key $DEPLOYER_PK --broadcast
contract DeployScript is Script {
    struct AssetSpec {
        string symbol;
        string name;
        bytes32 priceId; // Pyth Network price feed id (US equity regular hours)
        int256 initialPriceE8;
        uint64 ltvBps;
        uint64 liqThresholdBps;
    }

    AssetSpec[] specs;

    function setUp() public {
        // Pyth priceIds for US equity feeds (regular hours).
        // Source: hermes.pyth.network/v2/price_feeds?asset_type=equity
        //
        // The 5 stocks live on Robinhood Chain testnet (faucet-issued tokens).
        specs.push(
            AssetSpec({
                symbol: "TSLA",
                name: "Tesla, Inc.",
                priceId: 0x16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1,
                initialPriceE8: 348_51000000,
                ltvBps: 5500,
                liqThresholdBps: 6500
            })
        );
        specs.push(
            AssetSpec({
                symbol: "AMZN",
                name: "Amazon.com, Inc.",
                priceId: 0xb5d0e0fa58a1f8b81498ae670ce93c872d14434b72c364885d4fa1b257cbb07a,
                initialPriceE8: 232_18000000,
                ltvBps: 7000,
                liqThresholdBps: 7800
            })
        );
        specs.push(
            AssetSpec({
                symbol: "PLTR",
                name: "Palantir Tech.",
                priceId: 0x11a70634863ddffb71f2b11f2cff29f73f3db8f6d0b78c49f2b5f4ad36e885f0,
                initialPriceE8: 156_04000000,
                ltvBps: 5000,
                liqThresholdBps: 6000
            })
        );
        specs.push(
            AssetSpec({
                symbol: "NFLX",
                name: "Netflix, Inc.",
                priceId: 0x8376cfd7ca8bcdf372ced05307b24dced1f15b1afafdeff715664598f15a3dd2,
                initialPriceE8: 821_45000000,
                ltvBps: 6200,
                liqThresholdBps: 7200
            })
        );
        specs.push(
            AssetSpec({
                symbol: "AMD",
                name: "Adv. Micro Devices",
                priceId: 0x3622e381dbca2efd1859253763b1adc63f7f9abb8e76da1aa8e638a57ccde93e,
                initialPriceE8: 198_62000000,
                ltvBps: 6000,
                liqThresholdBps: 7000
            })
        );
    }

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PK");
        address deployer = vm.addr(pk);
        console2.log("Deployer:", deployer);

        vm.startBroadcast(pk);

        // ─── 1. Stablecoin (live USDG on RBN, or MockUSDC for local) ─────
        address envUsdc = _envAddrOr("USDC_ADDRESS", address(0));
        bool usdcWasDeployed = (envUsdc == address(0));
        address usdcAddr;
        uint8 usdcDec;
        if (usdcWasDeployed) {
            MockUSDC mock = new MockUSDC();
            usdcAddr = address(mock);
            usdcDec = 6;
            console2.log("MockUSDC deployed:", usdcAddr);
        } else {
            usdcAddr = envUsdc;
            usdcDec = _readDecimalsOr(envUsdc, 18);
            console2.log("Using live stablecoin:", usdcAddr);
            console2.log("  decimals:", uint256(usdcDec));
        }

        // ─── 2. Pyth oracle (mock on RBN, live elsewhere) ────────────────
        // Robinhood Chain has no Pyth deployment; deploy MockPyth.
        // To bind to a real Pyth (e.g. Arbitrum Sepolia), set PYTH_ADDRESS.
        address envPyth = _envAddrOr("PYTH_ADDRESS", address(0));
        IPyth pyth;
        if (envPyth == address(0)) {
            // (validTimePeriod, singleUpdateFeeInWei)
            // 1h freshness, 0 wei fee for the mock — keeper-friendly on RBN.
            MockPyth mock = new MockPyth(1 hours, 0);
            pyth = IPyth(address(mock));
            console2.log("MockPyth deployed:", address(mock));
        } else {
            pyth = IPyth(envPyth);
            console2.log("Using live Pyth:", envPyth);
        }

        // ─── 3. EquiFlowVault ────────────────────────────────────────────
        // Defaults: 5% borrow APR, 10% protocol cut, deployer as treasury.
        uint256 borrowRateBps = vm.envOr("BORROW_RATE_BPS", uint256(500));
        uint256 reserveFactorBps = vm.envOr(
            "RESERVE_FACTOR_BPS",
            uint256(1_000)
        );
        address treasury = vm.envOr("TREASURY_ADDRESS", deployer);
        EquiFlowVault vault = new EquiFlowVault(
            IERC20(usdcAddr),
            usdcDec,
            borrowRateBps,
            reserveFactorBps,
            treasury,
            deployer
        );
        console2.log("EquiFlowVault deployed:", address(vault));
        console2.log("  borrowRateBps:", borrowRateBps);
        console2.log("  reserveFactorBps:", reserveFactorBps);
        console2.log("  treasury:", treasury);

        // ─── 3b. PythAdapterRegistry (T-4 fix — pass 5) ─────────────────
        // Deploy a fresh registry per deploy run so the WETH-vault deploy
        // can later resolve adapters by priceId. Address goes into the
        // exported env block at the bottom of this script.
        PythAdapterRegistry adapterRegistry = new PythAdapterRegistry(deployer);
        console2.log("PythAdapterRegistry deployed:", address(adapterRegistry));

        // ─── 4. Per-asset: token + Pyth adapter + listing ────────────────
        for (uint256 i; i < specs.length; ++i) {
            AssetSpec memory s = specs[i];

            // Token — env address (live on RBN) or MockStockToken (local)
            string memory tokenKey = string.concat("TOKEN_", s.symbol);
            address envToken = _envAddrOr(tokenKey, address(0));
            address tokenAddr;
            if (envToken == address(0)) {
                MockStockToken tok = new MockStockToken(s.name, s.symbol);
                tokenAddr = address(tok);
                console2.log(string.concat("MockStock ", s.symbol, ":"), tokenAddr);
                tok.mint(deployer, 10_000e18);
            } else {
                tokenAddr = envToken;
                console2.log(string.concat("Using live RBN ", s.symbol, ":"), tokenAddr);
            }

            // Pyth priceId — env override (rare) or spec default.
            string memory priceIdKey = string.concat("PRICE_ID_", s.symbol);
            bytes32 priceId = _envBytes32Or(priceIdKey, s.priceId);

            PythPriceAdapter adapter = new PythPriceAdapter(
                pyth,
                priceId,
                string.concat(s.symbol, "/USD"),
                s.initialPriceE8,
                1 hours,
                deployer
            );
            adapter.setKeeper(deployer, true);
            // CRIT-8 fix: explicitly set the deviation cap even though the
            // constructor now defaults to 500 bps. Belt-and-suspenders so a
            // future constructor refactor cannot regress the protection.
            adapter.setMaxDeviation(500);
            // T-4 fix (pass 5): register so the WETH-vault deploy reuses
            // this exact adapter (one adapter per priceId, one keeper push
            // per priceId, no duplication).
            adapterRegistry.register(priceId, address(adapter));
            console2.log(string.concat("PythAdapter ", s.symbol, ":"), address(adapter));

            vault.listAsset(
                tokenAddr,
                address(adapter),
                s.ltvBps,
                s.liqThresholdBps,
                1 hours
            );

            // Oracle confidence circuit-breaker: 1.5% max width
            vault.setMaxConfidenceWidth(tokenAddr, 150);

            // Per-asset borrow cap (env override, 0 = unlimited)
            uint256 capRaw = vm.envOr(string.concat("BORROW_CAP_", s.symbol), uint256(0));
            if (capRaw > 0) {
                vault.setBorrowCap(tokenAddr, capRaw * 1e18);
                console2.log(string.concat("  BorrowCap ", s.symbol, ":"), capRaw);
            }
        }

        // ─── 4b. Deploy + schedule the kinked IRM ────────────────────────
        // Curve picked to mirror lib/web3/irm.ts DEFAULT_RATE_CONFIG with
        // slope2 clamped so that base + slope1 + slope2 ≤ BPS (constructor
        // requirement) AND so the resulting U=100% rate stays within the
        // vault's MAX_BORROW_RATE_BPS = 5_000 (50% APR cap, defense in depth):
        //
        //   base   = 1.00%    (100 bps)
        //   slope1 = 5.00%    (500 bps)
        //   slope2 = 49.00%   (4900 bps)
        //   U_opt  = 85%
        //
        // → rate(0)   = 1%
        // → rate(85%) = 6%
        // → rate(100%) = 55%, clamped to 50% at the vault.
        KinkedRateModel kinkedIrm = new KinkedRateModel(
            "EquiFlow Kinked v1",
            100,
            500,
            4900,
            8500
        );
        console2.log("KinkedRateModel deployed:", address(kinkedIrm));

        // Schedule the swap. In production the operator (multisig) must
        // call vault.executeIrm() after OWNER_WITHDRAW_DELAY (24h). Until
        // then the vault keeps using `borrowRateBps` (legacy flat rate).
        vault.scheduleIrm(address(kinkedIrm));
        console2.log("IRM scheduled - execute after OWNER_WITHDRAW_DELAY (24h)");
        console2.log("  Multisig action:  vault.executeIrm()");

        // ─── 5. Seed liquidity (only if we deployed MockUSDC ourselves) ──
        uint256 initLiq = vm.envOr("INIT_LIQUIDITY_USDC", uint256(1_000_000));
        if (usdcWasDeployed && initLiq > 0) {
            // For mock USDC: transfer then register (no transferFrom gating).
            uint256 raw = initLiq * 10 ** usdcDec;
            MockUSDC(usdcAddr).mint(deployer, raw);
            vault.announceDeposit(raw);
            IERC20(usdcAddr).transfer(address(vault), raw);
            vault.register(raw);
            console2.log("Seeded liquidity (MockUSDC, registered):", initLiq);
        } else if (!usdcWasDeployed) {
            console2.log("Live USDG is transferFrom-gated. Fund vault as LP:");
            console2.log("  1. Acquire USDG via faucet/swap");
            console2.log("  2. usdg.transfer(vault, amount)");
            console2.log("  3. vault.register(amount)  // anyone can call");
        }

        vm.stopBroadcast();

        // ─── 6. Print env block for app/.env.local ───────────────────────
        console2.log("");
        console2.log("================================================================");
        console2.log(" Copy into app/.env.local:");
        console2.log("================================================================");
        console2.log("NEXT_PUBLIC_VAULT_ADDRESS=", address(vault));
        console2.log("NEXT_PUBLIC_USDC_ADDRESS=", usdcAddr);
        console2.log("NEXT_PUBLIC_PYTH_ADDRESS=", address(pyth));
        console2.log("NEXT_PUBLIC_IRM_ADDRESS=", address(kinkedIrm));
        console2.log("NEXT_PUBLIC_ADAPTER_REGISTRY=", address(adapterRegistry));
        console2.log("");
        console2.log("Pass to DeployWethVault.s.sol as:");
        console2.log("  ADAPTER_REGISTRY=", address(adapterRegistry));
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
