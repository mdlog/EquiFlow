// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
import {IInterestRateModel} from "./interest/IInterestRateModel.sol";

interface IConfidenceOracle {
    function confidence() external view returns (uint64);
}

/// @title EquiFlowVault — pledge tokenized stocks, borrow USDC against them
/// @notice Hackquest Arbitrum / Robinhood Chain Track.
///         One position per user. Multi-collateral. Chainlink-priced.
///         Liquidation when LTV exceeds asset's liquidation threshold.
///
///         v2: open LP deposits with proportional shares + linear interest
///         accrual on borrows. LP share value grows as borrowers pay interest.
///         Compound-style `borrowIndex` keeps per-user accounting cheap.
///
///         Deposit path uses transfer+register because Robinhood-Chain USDG
///         (PYUSD-grade regulated stablecoin) gates transferFrom on a registry
///         the vault isn't whitelisted in. LP transfers USDG to vault via
///         their wallet first, then calls register(amount) to mint shares.
contract EquiFlowVault is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ─── Constants ───────────────────────────────────────────────────────
    uint256 public constant BPS = 10_000;
    uint256 public constant PRICE_DECIMALS = 8; // Chainlink standard
    uint256 public constant USD_DECIMALS = 18; // internal USD accounting
    uint256 public constant HEALTH_DECIMALS = 1e18;
    uint256 public constant INDEX_DECIMALS = 1e18;
    uint256 public constant MIN_BORROW_USD = 10e18; // $10 minimum borrow
    uint256 public constant DEAD_SHARES = 1_000_000; // virtual shares burned on first deposit
    uint256 public constant MIN_POKE_INTERVAL = 15; // seconds between pokeInterest calls
    uint256 public constant SECONDS_PER_YEAR = 365 days;
    /// @notice Hard ceiling so misconfig can't insta-balloon debt.
    uint256 public constant MAX_BORROW_RATE_BPS = 5_000; // 50% APR
    /// @notice Hard ceiling on protocol's interest cut. Aave/Compound typically 10-30%.
    uint256 public constant MAX_RESERVE_FACTOR_BPS = 5_000; // 50%

    // ─── Types ───────────────────────────────────────────────────────────
    struct Asset {
        AggregatorV3Interface priceFeed; // Chainlink USD price feed
        uint64 ltvBps; // e.g. 7200 = 72% max borrow against collateral
        uint64 liqThresholdBps; // e.g. 7800 = liquidate above 78%
        uint64 staleAfter; // seconds — round must be fresher than this
        bool enabled;
    }

    /// @dev borrowed USDC stored in 1e18 USD units (not USDC decimals)
    struct Position {
        uint256 borrowed; // scaled by borrowSnapshotIndex[user]
    }

    // ─── State ───────────────────────────────────────────────────────────
    IERC20 public immutable usdc;
    uint8 public immutable usdcDecimals;

    mapping(address token => Asset) public assets;
    address[] public assetList;

    mapping(address user => Position) public positions;
    mapping(address user => mapping(address token => uint256)) public collateral;

    /// @notice Total USDC currently lent out (1e18 USD units), grows with interest.
    uint256 public totalBorrowedUsd;

    // ── LP shares ──
    /// @notice USDG balance that has been registered as LP capital (raw USDG units).
    uint256 public bookedUsdg;
    /// @notice Total LP shares outstanding (1e18 scale).
    uint256 public totalShares;
    mapping(address user => uint256) public sharesOf;

    // ── Interest model ──
    /// @notice Pluggable interest rate model. When unset (address(0)) the
    ///         vault falls back to the legacy flat `borrowRateBps` so the
    ///         contract remains deployable before an IRM is published.
    IInterestRateModel public irm;
    /// @notice Pending IRM swap, executable after `OWNER_WITHDRAW_DELAY`.
    struct PendingIrm {
        address irm;
        uint256 readyAt;
    }
    PendingIrm public pendingIrm;
    /// @notice Legacy flat rate. Still used when `irm` is unset. Owner-set
    ///         via `setBorrowRateBps`. Kept for backwards compatibility
    ///         with existing deploys; once an IRM is wired this value is
    ///         no longer consulted.
    uint256 public borrowRateBps;
    /// @notice Compound-style borrow index. Starts at 1e18, grows over time.
    uint256 public borrowIndex = INDEX_DECIMALS;
    /// @notice Each borrower's snapshot of borrowIndex at their last interaction.
    mapping(address user => uint256) public borrowSnapshotIndex;
    /// @notice Last time interest was accrued globally.
    uint256 public lastAccruedAt;

    // ── Reserve factor (protocol revenue) ──
    /// @notice Fraction of borrower interest routed to protocol treasury, in BPS.
    ///         Remainder accrues to LP share value. Aave/Compound use 10-30%.
    uint256 public reserveFactorBps;
    /// @notice Accumulated protocol revenue in 1e18 USD units. Treasury can claim.
    uint256 public protocolReserves;
    /// @notice Recipient of protocol reserves on claim.
    address public treasury;
    /// @notice CRIT-11 fix: bad debt socialized to LPs after `writeOffBadDebt`
    ///         exhausts `protocolReserves`. Subtracted from `totalAssetsUsd`
    ///         so the share price reflects the loss.
    uint256 public socializedBadDebtUsd;

    // ── Liquidation bonus ──
    uint256 public liquidationBonusBps = 500; // 5%, configurable

    uint256 public closeFactorBps = 5_000; // 50% — only repay up to half the debt per liquidation
    uint256 public constant CRITICAL_HF = 5e17; // HF < 0.5 allows full liquidation

    // ── Interest poke limiter ──
    uint256 public lastPokedAt;

    // ── LP deposit intent (anti front-run) ──
    struct DepositIntent {
        uint256 amount;
        uint256 deadline;
        uint256 snapshotBalance;
    }
    mapping(address => DepositIntent) public depositIntents;
    uint256 public constant DEPOSIT_INTENT_TTL = 10 minutes;

    /// @notice CRIT-6 fix: only ONE LP may have an open intent at a time.
    ///         The original snapshot-based check was vulnerable because two
    ///         simultaneous intents both snapshotted the pre-transfer balance
    ///         and either could claim the other's incoming USDG via the
    ///         delta-since-announce check. Serialising intents removes that
    ///         ambiguity at the cost of a small UX queue (max DEPOSIT_INTENT_TTL).
    ///         An intent past its deadline is treated as inactive; any LP can
    ///         `pruneExpiredIntent(victim)` to clear it.
    address public activeIntentLp;

    // ── Oracle confidence circuit-breaker ──
    /// @notice Per-asset max confidence-interval width as fraction of price (BPS).
    ///         0 = uncapped (no check). E.g. 150 = conf must be < 1.5% of price.
    mapping(address token => uint64) public maxConfWidthBps;

    // ── Per-asset borrow cap ──
    /// @notice Max total USD borrowable via pledgeAndBorrow against this token.
    ///         0 = unlimited. Units: 1e18 USD.
    mapping(address token => uint256) public borrowCapUsd;
    /// @notice Running total of borrows attributed to each token. 1e18 USD.
    mapping(address token => uint256) public totalBorrowedByAsset;
    /// @notice Per-user per-token borrow attribution (principal only, used as weights).
    mapping(address user => mapping(address token => uint256)) public userBorrowByAsset;

    // ── Owner-controlled withdrawLiquidity timelock (H-2) ──
    struct PendingWithdraw {
        uint256 amount;
        address to;
        uint256 readyAt;
    }
    PendingWithdraw public pendingOwnerWithdraw;
    /// @notice Delay between scheduleWithdrawLiquidity and executeWithdrawLiquidity.
    uint256 public constant OWNER_WITHDRAW_DELAY = 24 hours;

    // ── Asset listing protection (H-3) ──
    /// @notice Once an asset is listed, only narrowing edits (lower LTV, lower
    ///         liqThreshold, longer staleAfter) are permitted via
    ///         `updateAssetRiskParams`. Widening requires `scheduleAssetWiden`
    ///         + delay (same OWNER_WITHDRAW_DELAY).
    struct PendingAssetWiden {
        uint64 ltvBps;
        uint64 liqThresholdBps;
        uint64 staleAfter;
        uint256 readyAt;
    }
    mapping(address token => PendingAssetWiden) public pendingAssetWiden;

    /// @notice Cached token decimals, set during listAsset.
    mapping(address token => uint8) public tokenDecimals;

    // ─── Events ──────────────────────────────────────────────────────────
    event AssetListed(
        address indexed token,
        address priceFeed,
        uint64 ltvBps,
        uint64 liqThresholdBps,
        uint64 staleAfter
    );
    event AssetDisabled(address indexed token);
    event Pledged(
        address indexed user,
        address indexed token,
        uint256 amount,
        uint256 borrowedUsd
    );
    event Repaid(address indexed user, uint256 amount);
    event Withdrawn(
        address indexed user,
        address indexed token,
        uint256 amount
    );
    event Liquidated(
        address indexed user,
        address indexed liquidator,
        address indexed token,
        uint256 collateralSeized,
        uint256 debtRepaid
    );
    event LpDeposited(address indexed lp, uint256 usdgAmount, uint256 sharesMinted);
    event LpWithdrawn(address indexed lp, uint256 usdgAmount, uint256 sharesBurned);
    event InterestAccrued(uint256 deltaUsd, uint256 reserveCutUsd, uint256 newIndex, uint256 newTotal);
    event BorrowRateSet(uint256 oldBps, uint256 newBps);
    event ReserveFactorSet(uint256 oldBps, uint256 newBps);
    event TreasurySet(address indexed oldTreasury, address indexed newTreasury);
    event ReservesClaimed(address indexed to, uint256 usdgAmount, uint256 usdValue);
    event MaxConfidenceWidthSet(address indexed token, uint64 oldBps, uint64 newBps);
    event BorrowCapSet(address indexed token, uint256 oldCap, uint256 newCap);
    event BorrowCapReleased(address indexed token, uint256 released, uint256 remaining);
    event LiquidationBonusSet(uint256 oldBps, uint256 newBps);
    event CloseFactorSet(uint256 oldBps, uint256 newBps);
    event DepositIntentCreated(address indexed lp, uint256 amount, uint256 deadline);
    event DepositIntentCancelled(address indexed lp);
    event BadDebtWrittenOff(address indexed user, uint256 debtUsd, uint256 fromReserves, uint256 fromLp);
    event IrmScheduled(address indexed irm, uint256 readyAt);
    event IrmExecuted(address indexed previous, address indexed current);
    event IrmCancelled();
    event OwnerWithdrawScheduled(uint256 amount, address indexed to, uint256 readyAt);
    event OwnerWithdrawExecuted(uint256 amount, address indexed to);
    event OwnerWithdrawCancelled();
    event AssetWidenScheduled(address indexed token, uint64 ltvBps, uint64 liqThresholdBps, uint64 staleAfter, uint256 readyAt);
    event AssetWidenExecuted(address indexed token);
    event AssetWidenCancelled(address indexed token);
    event AssetRiskNarrowed(address indexed token, uint64 ltvBps, uint64 liqThresholdBps, uint64 staleAfter);
    /// @notice ERC4626 standard deposit event (mirrors LpDeposited; emitted alongside).
    event Deposit(
        address indexed sender,
        address indexed owner,
        uint256 assets,
        uint256 shares
    );
    /// @notice ERC4626 standard withdraw event (mirrors LpWithdrawn).
    event Withdraw(
        address indexed sender,
        address indexed receiver,
        address indexed owner,
        uint256 assets,
        uint256 shares
    );

    // ─── Errors ──────────────────────────────────────────────────────────
    error AssetNotEnabled();
    error AmountZero();
    error ExceedsLtv(uint256 wouldLtvBps, uint256 capBps);
    error PositionHealthy();
    error InsufficientCollateral();
    error InsufficientLiquidity();
    error StalePrice();
    error InvalidPrice();
    error NotBorrower();
    error InsufficientTransfer(uint256 expected, uint256 actual);
    error InsufficientShares();
    error RateTooHigh();
    error ReserveFactorTooHigh();
    error NotTreasury();
    error ZeroAddress();
    error OracleConfidenceTooWide(uint64 actualBps, uint64 maxBps);
    error BorrowCapExceeded(address token, uint256 wouldTotal, uint256 cap);
    error BorrowTooSmall(uint256 amount, uint256 minimum);
    error PokeTooFrequent();
    error NoDepositIntent();
    error DepositIntentExpired();
    error DepositIntentAmountMismatch(uint256 intended, uint256 requested);
    error IntentConflict(address activeLp);
    error BadDebtUnbacked();
    error NoCollateral();
    error WidenNotReady();
    error NarrowOnly();
    error WithdrawNotReady();
    error IrmNotReady();
    error IrmInvalid();

    // ─── Constructor ─────────────────────────────────────────────────────
    constructor(
        IERC20 _usdc,
        uint8 _usdcDecimals,
        uint256 _borrowRateBps,
        uint256 _reserveFactorBps,
        address _treasury,
        address _owner
    ) Ownable(_owner) {
        require(address(_usdc) != address(0), "usdc=0");
        require(_usdcDecimals <= 18, "usdc>18");
        if (_borrowRateBps > MAX_BORROW_RATE_BPS) revert RateTooHigh();
        if (_reserveFactorBps > MAX_RESERVE_FACTOR_BPS) revert ReserveFactorTooHigh();
        if (_treasury == address(0)) revert ZeroAddress();
        usdc = _usdc;
        usdcDecimals = _usdcDecimals;
        borrowRateBps = _borrowRateBps;
        reserveFactorBps = _reserveFactorBps;
        treasury = _treasury;
        lastAccruedAt = block.timestamp;
    }

    // ─── Admin ───────────────────────────────────────────────────────────
    /// @notice Register a new collateral asset. Owner only. **New listings
    ///         only** — to change parameters on an already-listed asset use
    ///         `updateAssetRiskParams` (narrow only) or `scheduleAssetWiden`
    ///         (24h delay) per the H-3 fix from the security audit.
    function listAsset(
        address token,
        address priceFeed,
        uint64 ltvBps,
        uint64 liqThresholdBps,
        uint64 staleAfter
    ) external onlyOwner {
        require(token != address(0), "token=0");
        require(priceFeed != address(0), "feed=0");
        require(ltvBps > 0 && ltvBps < liqThresholdBps, "bad ltv");
        require(liqThresholdBps < BPS, "liq>=100%");
        require(staleAfter > 0, "stale=0");
        require(
            address(assets[token].priceFeed) == address(0),
            "already listed - use updateAssetRiskParams"
        );

        assets[token] = Asset({
            priceFeed: AggregatorV3Interface(priceFeed),
            ltvBps: ltvBps,
            liqThresholdBps: liqThresholdBps,
            staleAfter: staleAfter,
            enabled: true
        });
        assetList.push(token);
        tokenDecimals[token] = _queryDecimals(token);
        emit AssetListed(token, priceFeed, ltvBps, liqThresholdBps, staleAfter);
    }

    /// @notice Narrow risk parameters for an already-listed asset. Owner only.
    ///         Only LOWER LTV / LOWER liqThreshold / LONGER staleAfter are
    ///         permitted instantly. Widening any parameter must go through
    ///         the 24h `scheduleAssetWiden` queue so a key compromise can't
    ///         immediately weaken protections on existing positions.
    function updateAssetRiskParams(
        address token,
        uint64 ltvBps,
        uint64 liqThresholdBps,
        uint64 staleAfter
    ) external onlyOwner {
        Asset storage a = assets[token];
        require(address(a.priceFeed) != address(0), "not listed");
        require(ltvBps > 0 && ltvBps < liqThresholdBps, "bad ltv");
        require(liqThresholdBps < BPS, "liq>=100%");
        require(staleAfter > 0, "stale=0");
        if (ltvBps > a.ltvBps) revert NarrowOnly();
        if (liqThresholdBps > a.liqThresholdBps) revert NarrowOnly();
        if (staleAfter < a.staleAfter) revert NarrowOnly();
        a.ltvBps = ltvBps;
        a.liqThresholdBps = liqThresholdBps;
        a.staleAfter = staleAfter;
        emit AssetRiskNarrowed(token, ltvBps, liqThresholdBps, staleAfter);
    }

    /// @notice Queue a widening change to an asset's risk parameters. The
    ///         change becomes executable after `OWNER_WITHDRAW_DELAY`.
    function scheduleAssetWiden(
        address token,
        uint64 ltvBps,
        uint64 liqThresholdBps,
        uint64 staleAfter
    ) external onlyOwner {
        Asset storage a = assets[token];
        require(address(a.priceFeed) != address(0), "not listed");
        require(ltvBps > 0 && ltvBps < liqThresholdBps, "bad ltv");
        require(liqThresholdBps < BPS, "liq>=100%");
        require(staleAfter > 0, "stale=0");
        pendingAssetWiden[token] = PendingAssetWiden({
            ltvBps: ltvBps,
            liqThresholdBps: liqThresholdBps,
            staleAfter: staleAfter,
            readyAt: block.timestamp + OWNER_WITHDRAW_DELAY
        });
        emit AssetWidenScheduled(token, ltvBps, liqThresholdBps, staleAfter, block.timestamp + OWNER_WITHDRAW_DELAY);
    }

    function executeAssetWiden(address token) external onlyOwner {
        PendingAssetWiden memory p = pendingAssetWiden[token];
        if (p.readyAt == 0 || block.timestamp < p.readyAt) revert WidenNotReady();
        Asset storage a = assets[token];
        a.ltvBps = p.ltvBps;
        a.liqThresholdBps = p.liqThresholdBps;
        a.staleAfter = p.staleAfter;
        delete pendingAssetWiden[token];
        emit AssetWidenExecuted(token);
    }

    function cancelAssetWiden(address token) external onlyOwner {
        delete pendingAssetWiden[token];
        emit AssetWidenCancelled(token);
    }

    function disableAsset(address token) external onlyOwner {
        assets[token].enabled = false;
        emit AssetDisabled(token);
    }

    /// @notice Update annual borrow rate. Accrues pending interest at the old
    ///         rate first so the change is forward-looking only.
    ///
    ///         Legacy path: only meaningful when `irm == address(0)`. Once a
    ///         pluggable IRM is wired in (`executeIrm`), `_currentBorrowRateBps`
    ///         reads from the IRM instead and this setter has no observable
    ///         effect on accrual.
    function setBorrowRateBps(uint256 newRate) external onlyOwner {
        if (newRate > MAX_BORROW_RATE_BPS) revert RateTooHigh();
        _accrueInterest();
        uint256 old = borrowRateBps;
        borrowRateBps = newRate;
        emit BorrowRateSet(old, newRate);
    }

    /// @notice Schedule a swap of the active interest rate model. Goes
    ///         through the same `OWNER_WITHDRAW_DELAY` queue used by other
    ///         risk-affecting parameter changes so borrowers can observe
    ///         and react before the new curve goes live.
    ///
    ///         The proposed model is sanity-called once (getBorrowRate(0))
    ///         at schedule time to reject obviously-broken deploys early.
    function scheduleIrm(address newIrm) external onlyOwner {
        if (newIrm == address(0)) revert IrmInvalid();
        // Sanity probe: any conforming model must accept utilization=0.
        IInterestRateModel(newIrm).getBorrowRate(0);
        pendingIrm = PendingIrm({
            irm: newIrm,
            readyAt: block.timestamp + OWNER_WITHDRAW_DELAY
        });
        emit IrmScheduled(newIrm, block.timestamp + OWNER_WITHDRAW_DELAY);
    }

    /// @notice Execute a previously-scheduled IRM swap. Settles pending
    ///         interest at the OLD model first so the change is
    ///         forward-looking and the historical accrual stays correct.
    function executeIrm() external onlyOwner {
        PendingIrm memory p = pendingIrm;
        if (p.irm == address(0) || block.timestamp < p.readyAt) revert IrmNotReady();
        _accrueInterest();
        address prev = address(irm);
        irm = IInterestRateModel(p.irm);
        delete pendingIrm;
        emit IrmExecuted(prev, p.irm);
    }

    function cancelIrm() external onlyOwner {
        delete pendingIrm;
        emit IrmCancelled();
    }

    /// @dev Resolves the rate to use for the current accrual step.
    ///      When an IRM is wired in, this delegates to it and clamps the
    ///      result against MAX_BORROW_RATE_BPS regardless of what the
    ///      model returns (defense in depth — a buggy IRM cannot push
    ///      rates above the protocol cap).
    function _currentBorrowRateBps() internal view returns (uint256) {
        if (address(irm) == address(0)) return borrowRateBps;
        uint256 raw = irm.getBorrowRate(utilizationBps());
        return raw > MAX_BORROW_RATE_BPS ? MAX_BORROW_RATE_BPS : raw;
    }

    /// @notice Update protocol's interest cut. Accrues at the old factor first.
    function setReserveFactorBps(uint256 newBps) external onlyOwner {
        if (newBps > MAX_RESERVE_FACTOR_BPS) revert ReserveFactorTooHigh();
        _accrueInterest();
        uint256 old = reserveFactorBps;
        reserveFactorBps = newBps;
        emit ReserveFactorSet(old, newBps);
    }

    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert ZeroAddress();
        address old = treasury;
        treasury = newTreasury;
        emit TreasurySet(old, newTreasury);
    }

    /// @notice Set max oracle confidence-interval width for a collateral token.
    ///         When conf/price exceeds this ratio, new borrows against this token
    ///         are blocked. 0 = uncapped (no check). Does not affect liquidations.
    function setMaxConfidenceWidth(address token, uint64 maxWidthBps) external onlyOwner {
        uint64 old = maxConfWidthBps[token];
        maxConfWidthBps[token] = maxWidthBps;
        emit MaxConfidenceWidthSet(token, old, maxWidthBps);
    }

    /// @notice Set the maximum total USD borrowable against a given collateral
    ///         token. 0 = unlimited. Units: 1e18 USD.
    function setBorrowCap(address token, uint256 capUsd) external onlyOwner {
        uint256 old = borrowCapUsd[token];
        borrowCapUsd[token] = capUsd;
        emit BorrowCapSet(token, old, capUsd);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function setLiquidationBonus(uint256 newBps) external onlyOwner {
        require(newBps <= 2_000, "bonus>20%");
        uint256 old = liquidationBonusBps;
        liquidationBonusBps = newBps;
        emit LiquidationBonusSet(old, newBps);
    }

    function setCloseFactor(uint256 newBps) external onlyOwner {
        require(newBps > 0 && newBps <= BPS, "bad close factor");
        uint256 old = closeFactorBps;
        closeFactorBps = newBps;
        emit CloseFactorSet(old, newBps);
    }

    /// @notice Treasury claims accumulated protocol reserves. Pays out in USDG
    ///         from the vault's idle balance. Cannot drain LP share-backed
    ///         liquidity below outstanding borrows.
    function claimReserves(uint256 amountUsd) external nonReentrant {
        _accrueInterest();
        if (msg.sender != treasury) revert NotTreasury();
        if (amountUsd == 0) revert AmountZero();
        if (amountUsd > protocolReserves) amountUsd = protocolReserves;

        uint256 amountUsdg = _usdToUsdc(amountUsd);
        if (amountUsdg > bookedUsdg) revert InsufficientLiquidity();

        protocolReserves -= amountUsd;
        bookedUsdg -= amountUsdg;
        usdc.safeTransfer(treasury, amountUsdg);
        emit ReservesClaimed(treasury, amountUsdg, amountUsd);
    }

    /// @notice CRIT-11 fix: write off uncollectible debt for a user whose
    ///         collateral is zero across all assets. Charges
    ///         `protocolReserves` first (so the protocol's cut takes the hit
    ///         before LPs), then socializes any remainder to LP share value
    ///         via `socializedBadDebtUsd`.
    ///
    ///         Sequence:
    ///           1. Accrue interest so the write-off includes any pending
    ///              accumulation.
    ///           2. Snapshot the user so we see their current debt.
    ///           3. Require all collateral mappings == 0 (no asset they
    ///              still backstop is left to seize).
    ///           4. Subtract the user's debt from totalBorrowedUsd and
    ///              clear it from the user's Position.
    ///           5. Charge reserves first, then bump socializedBadDebtUsd.
    function writeOffBadDebt(address user) external onlyOwner nonReentrant {
        _accrueInterest();
        _snapshotUserDebt(user);

        uint256 debt = positions[user].borrowed;
        if (debt == 0) revert NotBorrower();

        uint256 n = assetList.length;
        for (uint256 i; i < n; ++i) {
            if (collateral[user][assetList[i]] != 0) revert NoCollateral();
        }

        // Clear debt from global and per-asset counters before charging.
        positions[user].borrowed = 0;
        totalBorrowedUsd -= debt;
        _releaseAssetBorrows(user, debt);

        uint256 fromReserves = debt > protocolReserves ? protocolReserves : debt;
        if (fromReserves > 0) {
            protocolReserves -= fromReserves;
        }
        uint256 socialized = debt - fromReserves;
        if (socialized > 0) {
            socializedBadDebtUsd += socialized;
        }

        emit BadDebtWrittenOff(user, debt, fromReserves, socialized);
    }

    /// @notice Zero out totalBorrowedUsd when no individual debts remain.
    ///         Cleans up rounding dust from compound index divergence.
    function sweepBorrowDust() external onlyOwner {
        _accrueInterest();
        require(totalBorrowedUsd < 1e18, "debt > $1 dust");
        totalBorrowedUsd = 0;
        uint256 n = assetList.length;
        for (uint256 i; i < n; ++i) {
            totalBorrowedByAsset[assetList[i]] = 0;
        }
    }

    /// @notice H-2 fix: emergency owner withdraw goes through a 24h queue so
    ///         a single compromised key cannot instantly rug LP shares. Use
    ///         `scheduleWithdrawLiquidity` then wait OWNER_WITHDRAW_DELAY
    ///         seconds and call `executeWithdrawLiquidity`. The intent and
    ///         timing are public on-chain — LPs have time to withdraw first.
    function scheduleWithdrawLiquidity(uint256 amount, address to)
        external
        onlyOwner
    {
        require(to != address(0), "to=0");
        require(amount > 0, "amount=0");
        pendingOwnerWithdraw = PendingWithdraw({
            amount: amount,
            to: to,
            readyAt: block.timestamp + OWNER_WITHDRAW_DELAY
        });
        emit OwnerWithdrawScheduled(amount, to, block.timestamp + OWNER_WITHDRAW_DELAY);
    }

    function cancelWithdrawLiquidity() external onlyOwner {
        delete pendingOwnerWithdraw;
        emit OwnerWithdrawCancelled();
    }

    function executeWithdrawLiquidity() external onlyOwner {
        PendingWithdraw memory p = pendingOwnerWithdraw;
        if (p.readyAt == 0 || block.timestamp < p.readyAt) revert WithdrawNotReady();
        _accrueInterest();
        uint256 reserves = usdc.balanceOf(address(this));
        uint256 borrowedUsdc = _usdToUsdc(totalBorrowedUsd);
        require(reserves >= borrowedUsdc + p.amount, "would deplete");
        require(p.amount <= bookedUsdg, "exceeds booked");
        bookedUsdg -= p.amount;
        delete pendingOwnerWithdraw;
        usdc.safeTransfer(p.to, p.amount);
        emit OwnerWithdrawExecuted(p.amount, p.to);
    }

    /// @notice Recover USDG that was transferred to the vault without going
    ///         through the announce→register flow (i.e. not booked as LP capital).
    ///         Can only withdraw the surplus above bookedUsdg + outstanding borrows.
    function rescueUnbooked(address to) external onlyOwner {
        uint256 balance = usdc.balanceOf(address(this));
        uint256 borrowedUsdc = _usdToUsdc(totalBorrowedUsd);
        uint256 committed = bookedUsdg + borrowedUsdc;
        require(balance > committed, "nothing to rescue");
        uint256 surplus = balance - committed;
        usdc.safeTransfer(to, surplus);
    }

    // ─── LP actions ──────────────────────────────────────────────────────

    /// @notice Step 1 of LP deposit. CRIT-6 fix: serialise — only one LP may
    ///         have an open intent at a time. Combined with the per-intent
    ///         balance-snapshot check at `register`, this blocks the front-run
    ///         where an attacker rides on the victim's transfer.
    function announceDeposit(uint256 amount) external whenNotPaused {
        if (amount == 0) revert AmountZero();
        if (activeIntentLp != address(0) && activeIntentLp != msg.sender) {
            DepositIntent memory other = depositIntents[activeIntentLp];
            if (other.amount > 0 && block.timestamp <= other.deadline) {
                revert IntentConflict(activeIntentLp);
            }
            // Expired — silently reclaim the slot for ourselves.
            delete depositIntents[activeIntentLp];
        }
        uint256 deadline = block.timestamp + DEPOSIT_INTENT_TTL;
        depositIntents[msg.sender] = DepositIntent({
            amount: amount,
            deadline: deadline,
            snapshotBalance: usdc.balanceOf(address(this))
        });
        activeIntentLp = msg.sender;
        emit DepositIntentCreated(msg.sender, amount, deadline);
    }

    /// @notice Cancel a pending deposit intent.
    function cancelDeposit() external {
        delete depositIntents[msg.sender];
        if (activeIntentLp == msg.sender) {
            activeIntentLp = address(0);
        }
        emit DepositIntentCancelled(msg.sender);
    }

    /// @notice Permissionlessly clear an expired intent so the queue resumes.
    function pruneExpiredIntent(address lp) external {
        DepositIntent memory intent = depositIntents[lp];
        if (intent.amount == 0) revert NoDepositIntent();
        if (block.timestamp <= intent.deadline) revert DepositIntentExpired();
        delete depositIntents[lp];
        if (activeIntentLp == lp) {
            activeIntentLp = address(0);
        }
        emit DepositIntentCancelled(lp);
    }

    /// @notice Step 3 of LP deposit (after announceDeposit + USDG transfer).
    ///         With the CRIT-6 serialisation in `announceDeposit`, the
    ///         snapshot-delta check below is now unambiguous: only one LP
    ///         can have an open intent at any moment, so the increase in the
    ///         vault's USDG balance since announce can only be from this LP.
    function register(uint256 amount) external nonReentrant whenNotPaused {
        _accrueInterest();
        if (amount == 0) revert AmountZero();

        DepositIntent memory intent = depositIntents[msg.sender];
        if (intent.amount == 0) revert NoDepositIntent();
        if (block.timestamp > intent.deadline) revert DepositIntentExpired();
        if (intent.amount < amount) revert DepositIntentAmountMismatch(intent.amount, amount);

        uint256 actualBalance = usdc.balanceOf(address(this));
        uint256 deltaSinceAnnounce = actualBalance > intent.snapshotBalance
            ? actualBalance - intent.snapshotBalance
            : 0;
        if (deltaSinceAnnounce < amount) revert InsufficientTransfer(amount, deltaSinceAnnounce);
        uint256 globalDelta = actualBalance > bookedUsdg ? actualBalance - bookedUsdg : 0;
        if (globalDelta < amount) revert InsufficientTransfer(amount, globalDelta);

        // Effects.
        delete depositIntents[msg.sender];
        if (activeIntentLp == msg.sender) {
            activeIntentLp = address(0);
        }

        uint256 totalUsd = totalAssetsUsd();
        uint256 amountUsd = _usdcToUsd(amount);

        uint256 shares;
        if (totalShares == 0) {
            shares = amountUsd;
            // Burn dead shares to address(1) to prevent share inflation attack.
            // This makes the cost of the attack proportional to DEAD_SHARES.
            sharesOf[address(1)] += DEAD_SHARES;
            totalShares += DEAD_SHARES;
        } else {
            require(totalUsd > 0, "vault empty");
            shares = (amountUsd * totalShares) / totalUsd;
        }
        require(shares > 0, "deposit too small");

        sharesOf[msg.sender] += shares;
        totalShares += shares;
        bookedUsdg += amount;

        emit LpDeposited(msg.sender, amount, shares);
        emit Deposit(msg.sender, msg.sender, amount, shares);
    }

    /// @notice Burn `shares` LP tokens and receive proportional USDG out.
    ///         Reverts if vault doesn't have enough idle USDG (i.e. too much
    ///         lent out). Borrowers must repay to free up withdrawals.
    function withdrawLp(uint256 shares) external nonReentrant whenNotPaused {
        _accrueInterest();
        if (shares == 0) revert AmountZero();
        if (sharesOf[msg.sender] < shares) revert InsufficientShares();

        uint256 totalUsd = totalAssetsUsd();
        uint256 amountUsd = (shares * totalUsd) / totalShares;
        uint256 amountUsdg = _usdToUsdc(amountUsd);

        if (amountUsdg > bookedUsdg) revert InsufficientLiquidity();

        sharesOf[msg.sender] -= shares;
        totalShares -= shares;
        bookedUsdg -= amountUsdg;

        usdc.safeTransfer(msg.sender, amountUsdg);
        emit LpWithdrawn(msg.sender, amountUsdg, shares);
        emit Withdraw(msg.sender, msg.sender, msg.sender, amountUsdg, shares);
    }

    /// @notice Anyone can ping accrual to refresh totalBorrowedUsd / borrowIndex.
    ///         Useful for view-only displays before mutations.
    function pokeInterest() external {
        if (block.timestamp - lastPokedAt < MIN_POKE_INTERVAL) revert PokeTooFrequent();
        lastPokedAt = block.timestamp;
        _accrueInterest();
    }

    // ─── Borrower actions ────────────────────────────────────────────────
    /// @notice Pledge collateral and optionally borrow USDC in one tx.
    /// @dev Caller must have approved `amount` of `token` to this contract.
    function pledgeAndBorrow(
        address token,
        uint256 amount,
        uint256 borrowUsd
    ) external nonReentrant whenNotPaused {
        _accrueInterest();
        Asset memory a = assets[token];
        if (!a.enabled) revert AssetNotEnabled();
        if (amount == 0 && borrowUsd == 0) revert AmountZero();

        // Bring user's debt up to current borrowIndex before mutating
        _snapshotUserDebt(msg.sender);

        if (amount > 0) {
            IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
            collateral[msg.sender][token] += amount;
        }

        if (borrowUsd > 0) {
            if (borrowUsd < MIN_BORROW_USD) revert BorrowTooSmall(borrowUsd, MIN_BORROW_USD);
            // CRIT-7 fix: enforce confidence on every collateral asset whose
            // cap we'll touch via attribution, not just the one being pledged.
            _enforceConfidenceForUser(msg.sender);

            positions[msg.sender].borrowed += borrowUsd;
            totalBorrowedUsd += borrowUsd;

            // CRIT-7 fix: distribute the new borrow across ALL the user's
            // collateral tokens pro-rata by USD value. The single-token
            // attribution this used to do let an attacker pledge 1 wei of a
            // capless token and direct the entire borrow there, bypassing
            // caps on the *real* collateral they were borrowing against.
            _attributeBorrow(msg.sender, borrowUsd);

            _enforceLtv(msg.sender);
            uint256 usdcOut = _usdToUsdc(borrowUsd);
            if (bookedUsdg < usdcOut) revert InsufficientLiquidity();
            bookedUsdg -= usdcOut;
            usdc.safeTransfer(msg.sender, usdcOut);
        }
        emit Pledged(msg.sender, token, amount, borrowUsd);
    }

    /// @dev Pro-rata-attribute a new borrow across the user's collateral. The
    ///      sum of attributions equals `borrowUsd` (the last token absorbs
    ///      any rounding remainder). Reverts if any token's running total
    ///      would exceed its cap.
    function _attributeBorrow(address user, uint256 borrowUsd) internal {
        uint256 n = assetList.length;
        // Compute total collateral USD and per-token USD value in one pass.
        uint256 totalCollUsd;
        uint256[] memory collUsds = new uint256[](n);
        for (uint256 i; i < n; ++i) {
            address t = assetList[i];
            uint256 amt = collateral[user][t];
            if (amt == 0) continue;
            uint256 price = _price(t);
            uint8 dec = _tokenDecimals(t);
            collUsds[i] = (amt * price * 1e10) / (10 ** dec);
            totalCollUsd += collUsds[i];
        }
        require(totalCollUsd > 0, "no collateral");

        uint256 remaining = borrowUsd;
        for (uint256 i; i < n; ++i) {
            if (collUsds[i] == 0) continue;
            address t = assetList[i];
            uint256 share;
            // The last contributing token absorbs the rounding remainder.
            if (i == _lastContributorIndex(collUsds, n)) {
                share = remaining;
            } else {
                share = (borrowUsd * collUsds[i]) / totalCollUsd;
                if (share > remaining) share = remaining;
            }
            if (share == 0) continue;
            totalBorrowedByAsset[t] += share;
            userBorrowByAsset[user][t] += share;
            uint256 cap = borrowCapUsd[t];
            if (cap > 0 && totalBorrowedByAsset[t] > cap) {
                revert BorrowCapExceeded(t, totalBorrowedByAsset[t], cap);
            }
            remaining -= share;
        }
        // The `last contributor takes remainder` rule guarantees remaining==0.
        require(remaining == 0, "attribution underflow");
    }

    function _lastContributorIndex(uint256[] memory collUsds, uint256 n) internal pure returns (uint256) {
        uint256 last;
        for (uint256 i; i < n; ++i) {
            if (collUsds[i] > 0) last = i;
        }
        return last;
    }

    function _enforceConfidenceForUser(address user) internal view {
        uint256 n = assetList.length;
        for (uint256 i; i < n; ++i) {
            address t = assetList[i];
            if (collateral[user][t] == 0) continue;
            _enforceConfidence(t);
        }
    }

    /// @notice Repay USDC debt (1e18 USD units). Use `repayMax()` to clear all.
    ///         M-5 fix: balance-delta accounting so fee-on-transfer or
    ///         rebasing USDG cannot inflate `bookedUsdg` beyond what arrived.
    function repay(uint256 amountUsd) external nonReentrant {
        _accrueInterest();
        _snapshotUserDebt(msg.sender);

        Position storage p = positions[msg.sender];
        if (p.borrowed == 0) revert NotBorrower();
        if (amountUsd > p.borrowed) amountUsd = p.borrowed;
        uint256 usdcIn = _usdToUsdcCeil(amountUsd);
        uint256 before = usdc.balanceOf(address(this));
        usdc.safeTransferFrom(msg.sender, address(this), usdcIn);
        uint256 received = usdc.balanceOf(address(this)) - before;
        if (received < usdcIn) revert InsufficientTransfer(usdcIn, received);
        p.borrowed -= amountUsd;
        totalBorrowedUsd -= amountUsd;
        _releaseAssetBorrows(msg.sender, amountUsd);
        bookedUsdg += received;
        emit Repaid(msg.sender, amountUsd);
    }

    function repayMax() external nonReentrant {
        _accrueInterest();
        _snapshotUserDebt(msg.sender);

        uint256 d = positions[msg.sender].borrowed;
        if (d == 0) revert NotBorrower();
        uint256 usdcIn = _usdToUsdcCeil(d);
        uint256 before = usdc.balanceOf(address(this));
        usdc.safeTransferFrom(msg.sender, address(this), usdcIn);
        uint256 received = usdc.balanceOf(address(this)) - before;
        if (received < usdcIn) revert InsufficientTransfer(usdcIn, received);
        positions[msg.sender].borrowed = 0;
        totalBorrowedUsd -= d;
        _releaseAssetBorrows(msg.sender, d);
        bookedUsdg += received;
        emit Repaid(msg.sender, d);
    }

    /// @notice Withdraw unused collateral. Reverts if it would breach LTV.
    ///         M-1 fix: now blocked while the vault is paused so an emergency
    ///         halt prevents users from front-running an upcoming oracle
    ///         re-pricing or asset disable.
    function withdraw(address token, uint256 amount) external nonReentrant whenNotPaused {
        _accrueInterest();
        _snapshotUserDebt(msg.sender);

        if (amount == 0) revert AmountZero();
        if (collateral[msg.sender][token] < amount) revert InsufficientCollateral();
        collateral[msg.sender][token] -= amount;
        _enforceLtv(msg.sender);
        IERC20(token).safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, token, amount);
    }

    /// @notice Liquidate an unhealthy position.
    function liquidate(
        address user,
        address token,
        uint256 debtUsdToRepay
    ) external nonReentrant {
        _accrueInterest();
        _snapshotUserDebt(user);

        Asset memory a = assets[token];
        // H-6 fix: liquidations against an asset whose `enabled` flag has
        // been flipped off must still proceed — otherwise disabling an asset
        // traps positions backed by it in permanent bad-debt accrual. We
        // still require the asset to have been listed at some point
        // (priceFeed != 0) so a typo can't accidentally drain a wrong token.
        if (address(a.priceFeed) == address(0)) revert AssetNotEnabled();
        if (debtUsdToRepay == 0) revert AmountZero();
        if (isHealthy(user)) revert PositionHealthy();
        if (collateral[user][token] == 0) revert InsufficientCollateral();
        require(msg.sender != user, "no self-liquidation");

        Position storage p = positions[user];
        if (debtUsdToRepay > p.borrowed) debtUsdToRepay = p.borrowed;

        // Close factor: limit repayment to closeFactorBps of debt unless critically underwater
        uint256 hf = healthFactor(user);
        if (hf >= CRITICAL_HF) {
            uint256 maxRepay = (p.borrowed * closeFactorBps) / BPS;
            if (debtUsdToRepay > maxRepay) debtUsdToRepay = maxRepay;
        }

        // H-4 fix: enforce oracle confidence on the seized token before
        // pricing the seizure. Wide-confidence Pyth data must not drive
        // liquidations or the 5% bonus.
        _enforceConfidence(token);

        uint256 seizeUsd = (debtUsdToRepay * (BPS + liquidationBonusBps)) / BPS;
        uint256 price = _price(token); // 1e8
        uint8 tokenDec = _tokenDecimals(token);
        uint256 tokenAmount = (seizeUsd * (10 ** tokenDec)) / (price * 1e10);

        if (tokenAmount > collateral[user][token]) {
            tokenAmount = collateral[user][token];
            uint256 maxSeizeUsd = (tokenAmount * price * 1e10) / (10 ** tokenDec);
            debtUsdToRepay = (maxSeizeUsd * BPS) / (BPS + liquidationBonusBps);
        }

        p.borrowed -= debtUsdToRepay;
        totalBorrowedUsd -= debtUsdToRepay;
        _releaseAssetBorrows(user, debtUsdToRepay);
        collateral[user][token] -= tokenAmount;

        uint256 usdcIn = _usdToUsdc(debtUsdToRepay);
        // M-5 fix: balance-delta accounting for fee-on-transfer safety.
        uint256 before = usdc.balanceOf(address(this));
        usdc.safeTransferFrom(msg.sender, address(this), usdcIn);
        uint256 received = usdc.balanceOf(address(this)) - before;
        if (received < usdcIn) revert InsufficientTransfer(usdcIn, received);
        bookedUsdg += received;
        IERC20(token).safeTransfer(msg.sender, tokenAmount);

        emit Liquidated(user, msg.sender, token, tokenAmount, debtUsdToRepay);
    }

    // ─── Views ───────────────────────────────────────────────────────────
    /// @notice Total assets backing LP shares, in 1e18 USD units.
    ///         = idle USDG (booked) + outstanding loans + pending interest
    ///           − protocol reserves (settled + pending)
    function totalAssetsUsd() public view returns (uint256) {
        uint256 pending = _pendingInterest();
        uint256 pendingReserve = (pending * reserveFactorBps) / BPS;
        uint256 base = _usdcToUsd(bookedUsdg) + totalBorrowedUsd + pending;
        // CRIT-11 fix: subtract socialized bad debt so LP shares price in
        // realized losses.
        uint256 deductions = protocolReserves + pendingReserve + socializedBadDebtUsd;
        return base > deductions ? base - deductions : 0;
    }

    /// @notice 1e18 USD per LP share. 1e18 = par. Grows with accrued interest.
    function sharePriceUsd() external view returns (uint256) {
        if (totalShares == 0) return INDEX_DECIMALS;
        return (totalAssetsUsd() * INDEX_DECIMALS) / totalShares;
    }

    /// @notice LP utilization in BPS. 100% = all USDG is lent out.
    function utilizationBps() public view returns (uint256) {
        uint256 idle = _usdcToUsd(bookedUsdg);
        uint256 total = idle + totalBorrowedUsd;
        if (total == 0) return 0;
        return (totalBorrowedUsd * BPS) / total;
    }

    /// @notice Estimated LP APY in BPS. Equals borrowRate × utilization ×
    ///         (1 − reserveFactor). Interest flows from borrowers to LPs net
    ///         of the protocol's cut.
    function lpApyBps() external view returns (uint256) {
        uint256 rate = _currentBorrowRateBps();
        uint256 gross = (rate * utilizationBps()) / BPS;
        return (gross * (BPS - reserveFactorBps)) / BPS;
    }

    /// @notice Gross borrow APY for borrowers (before LP/reserve split).
    ///         Reads from the active IRM (or legacy flat rate when IRM is
    ///         unwired).
    function borrowApyBps() external view returns (uint256) {
        return _currentBorrowRateBps();
    }

    /// @notice Protocol's share of interest as APY (information only).
    function reserveApyBps() external view returns (uint256) {
        uint256 rate = _currentBorrowRateBps();
        uint256 gross = (rate * utilizationBps()) / BPS;
        return (gross * reserveFactorBps) / BPS;
    }

    /// @notice Borrow cap and current usage for a given collateral token.
    function borrowCapInfo(address token) external view returns (uint256 cap, uint256 used) {
        return (borrowCapUsd[token], totalBorrowedByAsset[token]);
    }

    /// @notice Sum of collateral × price across all listed assets for `user`.
    ///         H-1 fix: a stale feed on ONE asset must not block valuation of
    ///         the others. Stale assets get priced at zero — conservative
    ///         for the protocol (lower HF, easier liquidation, restricted
    ///         withdraw/borrow), the safe direction.
    function collateralValueUsd(address user) public view returns (uint256 total) {
        uint256 n = assetList.length;
        for (uint256 i; i < n; ++i) {
            address t = assetList[i];
            uint256 amt = collateral[user][t];
            if (amt == 0) continue;
            uint256 price = _safePriceOrZero(t);
            if (price == 0) continue;
            uint8 dec = _tokenDecimals(t);
            total += (amt * price * 1e10) / (10 ** dec); // 1e18 USD
        }
    }

    function ltvCapBps(address user) public view returns (uint256) {
        uint256 totalUsd;
        uint256 weightedCap;
        uint256 n = assetList.length;
        for (uint256 i; i < n; ++i) {
            address t = assetList[i];
            uint256 amt = collateral[user][t];
            if (amt == 0) continue;
            uint256 price = _safePriceOrZero(t);
            if (price == 0) continue;
            Asset memory a = assets[t];
            uint8 dec = _tokenDecimals(t);
            uint256 v = (amt * price * 1e10) / (10 ** dec);
            totalUsd += v;
            weightedCap += v * a.ltvBps;
        }
        return totalUsd == 0 ? 0 : weightedCap / totalUsd;
    }

    function liquidationThresholdBps(address user) public view returns (uint256) {
        uint256 totalUsd;
        uint256 weightedThresh;
        uint256 n = assetList.length;
        for (uint256 i; i < n; ++i) {
            address t = assetList[i];
            uint256 amt = collateral[user][t];
            if (amt == 0) continue;
            uint256 price = _safePriceOrZero(t);
            if (price == 0) continue;
            Asset memory a = assets[t];
            uint8 dec = _tokenDecimals(t);
            uint256 v = (amt * price * 1e10) / (10 ** dec);
            totalUsd += v;
            weightedThresh += v * a.liqThresholdBps;
        }
        return totalUsd == 0 ? 0 : weightedThresh / totalUsd;
    }

    /// @notice Current borrowed amount for a user (includes accrued interest
    ///         relative to their last snapshot).
    function borrowedOf(address user) public view returns (uint256) {
        Position memory p = positions[user];
        if (p.borrowed == 0) return 0;
        uint256 snap = borrowSnapshotIndex[user];
        uint256 idx = _projectedBorrowIndex();
        if (snap == 0) return (p.borrowed * idx) / INDEX_DECIMALS;
        return (p.borrowed * idx) / snap;
    }

    function healthFactor(address user) public view returns (uint256) {
        uint256 borrowed = borrowedOf(user);
        if (borrowed == 0) return type(uint256).max;
        uint256 collUsd = collateralValueUsd(user);
        uint256 thresh = liquidationThresholdBps(user);
        return (collUsd * thresh * HEALTH_DECIMALS) / (borrowed * BPS);
    }

    function isHealthy(address user) public view returns (bool) {
        return healthFactor(user) > HEALTH_DECIMALS;
    }

    function maxBorrow(address user) external view returns (uint256) {
        uint256 collUsd = collateralValueUsd(user);
        uint256 cap = ltvCapBps(user);
        uint256 ceiling = (collUsd * cap) / BPS;
        uint256 borrowed = borrowedOf(user);
        if (ceiling <= borrowed) return 0;
        return ceiling - borrowed;
    }

    function positionOf(address user)
        external
        view
        returns (
            uint256 collateralUsd,
            uint256 borrowedUsd,
            uint256 health
        )
    {
        collateralUsd = collateralValueUsd(user);
        borrowedUsd = borrowedOf(user);
        health = healthFactor(user);
    }

    function listedAssets() external view returns (address[] memory) {
        return assetList;
    }

    /// @notice LP position summary for a user.
    function lpPositionOf(address lp)
        external
        view
        returns (uint256 shares, uint256 usdValue, uint256 usdgValue)
    {
        shares = sharesOf[lp];
        if (shares == 0 || totalShares == 0) return (0, 0, 0);
        usdValue = (shares * totalAssetsUsd()) / totalShares;
        usdgValue = _usdToUsdc(usdValue);
    }

    // ─── ERC4626 (view-only compliance) ──────────────────────────────────
    /// Standard interface for tooling (vault aggregators, DefiLlama, etc).
    /// Mutating deposit/mint go through `register()` because regulated USDG
    /// blocks transferFrom; `withdraw/redeem` ERC4626 functions wrap
    /// `withdrawLp()`. All view functions follow EIP-4626 verbatim, returning
    /// asset amounts in USDG raw units and shares in 1e18.

    /// @notice ERC4626: underlying asset address.
    function asset() external view returns (address) {
        return address(usdc);
    }

    /// @notice ERC4626: total managed assets in asset units (USDG raw).
    function totalAssets() public view returns (uint256) {
        return _usdToUsdc(totalAssetsUsd());
    }

    /// @notice ERC4626 alias of `totalShares` for tooling that expects ERC20.
    function totalSupply() external view returns (uint256) {
        return totalShares;
    }

    /// @notice ERC4626 alias of `sharesOf` for tooling that expects ERC20.
    function balanceOf(address account) external view returns (uint256) {
        return sharesOf[account];
    }

    /// @notice ERC4626 share decimals (matches share scaling).
    function decimals() external pure returns (uint8) {
        return 18;
    }

    /// @notice ERC4626: shares minted for a given asset deposit at current price.
    function convertToShares(uint256 assets) public view returns (uint256) {
        uint256 assetsUsd = _usdcToUsd(assets);
        if (totalShares == 0) return assetsUsd;
        uint256 total = totalAssetsUsd();
        if (total == 0) return assetsUsd;
        return (assetsUsd * totalShares) / total;
    }

    /// @notice ERC4626: assets returned for a given share redemption.
    function convertToAssets(uint256 shares) public view returns (uint256) {
        if (totalShares == 0) return 0;
        uint256 usdValue = (shares * totalAssetsUsd()) / totalShares;
        return _usdToUsdc(usdValue);
    }

    function maxDeposit(address) external pure returns (uint256) {
        return type(uint256).max;
    }

    function previewDeposit(uint256 assets) external view returns (uint256) {
        return convertToShares(assets);
    }

    function maxMint(address) external pure returns (uint256) {
        return type(uint256).max;
    }

    function previewMint(uint256 shares) external view returns (uint256) {
        if (totalShares == 0) return _usdToUsdc(shares);
        uint256 usdValue = (shares * totalAssetsUsd()) / totalShares;
        return _usdToUsdc(usdValue);
    }

    function maxWithdraw(address owner_) external view returns (uint256) {
        if (sharesOf[owner_] == 0 || totalShares == 0) return 0;
        uint256 userAssets = convertToAssets(sharesOf[owner_]);
        return userAssets > bookedUsdg ? bookedUsdg : userAssets;
    }

    function previewWithdraw(uint256 assets) external view returns (uint256) {
        uint256 total = totalAssetsUsd();
        if (total == 0) return 0;
        uint256 assetsUsd = _usdcToUsd(assets);
        // ceil division so the user's share-burn matches assets received
        return (assetsUsd * totalShares + total - 1) / total;
    }

    function maxRedeem(address owner_) external view returns (uint256) {
        return sharesOf[owner_];
    }

    function previewRedeem(uint256 shares) external view returns (uint256) {
        return convertToAssets(shares);
    }

    // ─── Internal ────────────────────────────────────────────────────────

    /// @dev Reverts if the Pyth confidence interval is too wide relative to
    ///      the asset's price. Only called for new borrows — never for
    ///      liquidations, repayments, or withdrawals.
    function _enforceConfidence(address token) internal view {
        uint64 maxWidth = maxConfWidthBps[token];
        if (maxWidth == 0) return;
        Asset memory a = assets[token];
        uint64 conf = IConfidenceOracle(address(a.priceFeed)).confidence();
        (, int256 answer, , , ) = a.priceFeed.latestRoundData();
        if (answer <= 0) revert InvalidPrice();
        uint64 actualBps = uint64((uint256(conf) * BPS) / uint256(answer));
        if (actualBps > maxWidth) revert OracleConfidenceTooWide(actualBps, maxWidth);
    }

    /// @dev Release per-asset borrow cap counters when a user repays or is
    ///      liquidated. Uses the user's own per-token borrow attribution as
    ///      weights so cap release matches where the borrow originated.
    function _releaseAssetBorrows(address user, uint256 repaidUsd) internal {
        uint256 n = assetList.length;
        if (n == 0) return;

        uint256 userTotal;
        for (uint256 i; i < n; ++i) {
            userTotal += userBorrowByAsset[user][assetList[i]];
        }
        if (userTotal == 0) return;

        for (uint256 i; i < n; ++i) {
            address t = assetList[i];
            uint256 userAmt = userBorrowByAsset[user][t];
            if (userAmt == 0) continue;
            uint256 release = (repaidUsd * userAmt) / userTotal;
            if (release > userAmt) release = userAmt;
            if (release > totalBorrowedByAsset[t]) release = totalBorrowedByAsset[t];
            userBorrowByAsset[user][t] -= release;
            totalBorrowedByAsset[t] -= release;
            emit BorrowCapReleased(t, release, totalBorrowedByAsset[t]);
        }
    }

    function _enforceLtv(address user) internal view {
        uint256 borrowed = borrowedOf(user);
        if (borrowed == 0) return;
        uint256 collUsd = collateralValueUsd(user);
        if (collUsd == 0) revert ExceedsLtv(type(uint256).max, ltvCapBps(user));
        uint256 ltv = (borrowed * BPS) / collUsd;
        uint256 cap = ltvCapBps(user);
        if (ltv > cap) revert ExceedsLtv(ltv, cap);
    }

    /// @dev Discrete compound interest accrual via multiplicative index. Bumps both the
    ///      global index and `totalBorrowedUsd`. A configurable `reserveFactor`
    ///      slice routes to protocol reserves; the rest accretes to LP share
    ///      value (implicit via `totalAssetsUsd() = base - protocolReserves`).
    function _accrueInterest() internal {
        uint256 dt = block.timestamp - lastAccruedAt;
        if (dt == 0) return;

        uint256 rate = _currentBorrowRateBps();
        if (totalBorrowedUsd > 0 && rate > 0) {
            uint256 growthFactor = (rate * dt * INDEX_DECIMALS) /
                (BPS * SECONDS_PER_YEAR);
            uint256 indexDelta = (borrowIndex * growthFactor) / INDEX_DECIMALS;
            uint256 interest = (totalBorrowedUsd * growthFactor) / INDEX_DECIMALS;
            uint256 reserveCut = (interest * reserveFactorBps) / BPS;

            borrowIndex += indexDelta;
            totalBorrowedUsd += interest;
            protocolReserves += reserveCut;
            emit InterestAccrued(interest, reserveCut, borrowIndex, totalBorrowedUsd);
        }
        lastAccruedAt = block.timestamp;
    }

    /// @dev View-only projection of borrowIndex up to current block. Used by
    ///      `borrowedOf` etc so reads reflect accrual even before a mutation.
    function _projectedBorrowIndex() internal view returns (uint256) {
        uint256 dt = block.timestamp - lastAccruedAt;
        uint256 rate = _currentBorrowRateBps();
        if (dt == 0 || totalBorrowedUsd == 0 || rate == 0) {
            return borrowIndex;
        }
        uint256 growthFactor = (rate * dt * INDEX_DECIMALS) /
            (BPS * SECONDS_PER_YEAR);
        uint256 indexDelta = (borrowIndex * growthFactor) / INDEX_DECIMALS;
        return borrowIndex + indexDelta;
    }

    /// @dev View-only projection of interest pending since lastAccruedAt.
    function _pendingInterest() internal view returns (uint256) {
        uint256 dt = block.timestamp - lastAccruedAt;
        uint256 rate = _currentBorrowRateBps();
        if (dt == 0 || totalBorrowedUsd == 0 || rate == 0) return 0;
        uint256 growthFactor = (rate * dt * INDEX_DECIMALS) /
            (BPS * SECONDS_PER_YEAR);
        return (totalBorrowedUsd * growthFactor) / INDEX_DECIMALS;
    }

    /// @dev Roll a user's stored debt forward to the current borrowIndex.
    ///      Must be called before any mutation to that user's position.
    function _snapshotUserDebt(address user) internal {
        Position storage p = positions[user];
        if (p.borrowed == 0) {
            borrowSnapshotIndex[user] = borrowIndex;
            return;
        }
        uint256 snap = borrowSnapshotIndex[user];
        if (snap != 0 && snap != borrowIndex) {
            p.borrowed = (p.borrowed * borrowIndex) / snap;
        }
        borrowSnapshotIndex[user] = borrowIndex;
    }

    function _price(address token) internal view returns (uint256) {
        Asset memory a = assets[token];
        (uint80 roundId, int256 answer, , uint256 updatedAt, uint80 answeredInRound) =
            a.priceFeed.latestRoundData();
        if (roundId == 0) revert InvalidPrice();
        if (answer <= 0) revert InvalidPrice();
        if (updatedAt == 0) revert StalePrice();
        if (answeredInRound < roundId) revert StalePrice();
        if (block.timestamp - updatedAt > a.staleAfter) revert StalePrice();
        return uint256(answer);
    }

    /// @dev H-1 fix: stale-tolerant variant of `_price`. Returns 0 when the
    ///      feed is stale / invalid instead of reverting. Used by valuation
    ///      helpers so a single bad feed cannot block liquidations or HF
    ///      reads across multi-collateral positions. Always conservative:
    ///      the stale leg counts as worthless, never as inflated.
    function _safePriceOrZero(address token) internal view returns (uint256) {
        Asset memory a = assets[token];
        if (address(a.priceFeed) == address(0)) return 0;
        try a.priceFeed.latestRoundData() returns (
            uint80 roundId,
            int256 answer,
            uint256,
            uint256 updatedAt,
            uint80 answeredInRound
        ) {
            if (roundId == 0) return 0;
            if (answer <= 0) return 0;
            if (updatedAt == 0) return 0;
            if (answeredInRound < roundId) return 0;
            if (block.timestamp > updatedAt && block.timestamp - updatedAt > a.staleAfter) return 0;
            return uint256(answer);
        } catch {
            return 0;
        }
    }

    function _tokenDecimals(address token) internal view returns (uint8) {
        uint8 cached = tokenDecimals[token];
        if (cached > 0) return cached;
        return _queryDecimals(token);
    }

    function _queryDecimals(address token) internal view returns (uint8) {
        (bool ok, bytes memory ret) = token.staticcall(
            abi.encodeWithSignature("decimals()")
        );
        if (!ok || ret.length < 32) return 18;
        return abi.decode(ret, (uint8));
    }

    function _usdToUsdc(uint256 amountUsd) internal view returns (uint256) {
        // amountUsd is 1e18; output in usdcDecimals
        if (usdcDecimals >= 18) return amountUsd * (10 ** (usdcDecimals - 18));
        return amountUsd / (10 ** (18 - usdcDecimals));
    }

    function _usdToUsdcCeil(uint256 amountUsd) internal view returns (uint256) {
        if (usdcDecimals >= 18) return amountUsd * (10 ** (usdcDecimals - 18));
        uint256 divisor = 10 ** (18 - usdcDecimals);
        return (amountUsd + divisor - 1) / divisor;
    }

    function _usdcToUsd(uint256 amountUsdc) internal view returns (uint256) {
        // input in usdcDecimals; output 1e18
        if (usdcDecimals >= 18) return amountUsdc / (10 ** (usdcDecimals - 18));
        return amountUsdc * (10 ** (18 - usdcDecimals));
    }
}
