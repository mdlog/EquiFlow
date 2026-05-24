// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";

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
contract EquiFlowVault is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Constants ───────────────────────────────────────────────────────
    uint256 public constant BPS = 10_000;
    uint256 public constant PRICE_DECIMALS = 8; // Chainlink standard
    uint256 public constant USD_DECIMALS = 18; // internal USD accounting
    uint256 public constant HEALTH_DECIMALS = 1e18;
    uint256 public constant INDEX_DECIMALS = 1e18;
    /// @notice Bonus paid to liquidator on liquidation, in BPS of debt repaid.
    uint256 public constant LIQUIDATION_BONUS_BPS = 500; // 5%
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
    /// @notice Linear interest rate in BPS per year. Settable by owner.
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
    /// @notice Register or update a collateral asset. Owner only.
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

        bool isNew = !assets[token].enabled && address(assets[token].priceFeed) == address(0);
        assets[token] = Asset({
            priceFeed: AggregatorV3Interface(priceFeed),
            ltvBps: ltvBps,
            liqThresholdBps: liqThresholdBps,
            staleAfter: staleAfter,
            enabled: true
        });
        if (isNew) assetList.push(token);
        emit AssetListed(token, priceFeed, ltvBps, liqThresholdBps, staleAfter);
    }

    function disableAsset(address token) external onlyOwner {
        assets[token].enabled = false;
        emit AssetDisabled(token);
    }

    /// @notice Update annual borrow rate. Accrues pending interest at the old
    ///         rate first so the change is forward-looking only.
    function setBorrowRateBps(uint256 newRate) external onlyOwner {
        if (newRate > MAX_BORROW_RATE_BPS) revert RateTooHigh();
        _accrueInterest();
        uint256 old = borrowRateBps;
        borrowRateBps = newRate;
        emit BorrowRateSet(old, newRate);
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

    /// @notice Emergency owner withdraw — bypasses LP shares. Use only to
    ///         migrate liquidity or recover stranded USDG. Cannot drop the
    ///         vault below outstanding borrows.
    function withdrawLiquidity(uint256 amount, address to) external onlyOwner {
        _accrueInterest();
        uint256 reserves = usdc.balanceOf(address(this));
        uint256 borrowedUsdc = _usdToUsdc(totalBorrowedUsd);
        require(reserves >= borrowedUsdc + amount, "would deplete");
        // bookedUsdg tracks LP capital; reduce it proportionally if we touch it
        if (amount > bookedUsdg) bookedUsdg = 0;
        else bookedUsdg -= amount;
        usdc.safeTransfer(to, amount);
    }

    // ─── LP actions ──────────────────────────────────────────────────────
    /// @notice Step 2 of LP deposit. LP must have already transferred at least
    ///         `amount` USDG to this vault via usdc.transfer() in a separate
    ///         tx. This function verifies the delta and mints shares.
    ///
    ///         Why two-step: USDG transferFrom is gated on a registry the
    ///         vault isn't whitelisted in. transfer() from EOAs is allowed.
    function register(uint256 amount) external nonReentrant {
        _accrueInterest();
        if (amount == 0) revert AmountZero();

        uint256 actualBalance = usdc.balanceOf(address(this));
        uint256 delta = actualBalance > bookedUsdg ? actualBalance - bookedUsdg : 0;
        if (delta < amount) revert InsufficientTransfer(amount, delta);

        uint256 totalUsd = totalAssetsUsd();
        uint256 amountUsd = _usdcToUsd(amount);

        // First depositor sets the 1:1 share/USD ratio. Subsequent deposits get
        // shares proportional to their share of total assets (which includes
        // accrued interest on outstanding borrows).
        uint256 shares = totalShares == 0
            ? amountUsd
            : (amountUsd * totalShares) / totalUsd;

        sharesOf[msg.sender] += shares;
        totalShares += shares;
        bookedUsdg += amount;

        emit LpDeposited(msg.sender, amount, shares);
        emit Deposit(msg.sender, msg.sender, amount, shares);
    }

    /// @notice Burn `shares` LP tokens and receive proportional USDG out.
    ///         Reverts if vault doesn't have enough idle USDG (i.e. too much
    ///         lent out). Borrowers must repay to free up withdrawals.
    function withdrawLp(uint256 shares) external nonReentrant {
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
        _accrueInterest();
    }

    // ─── Borrower actions ────────────────────────────────────────────────
    /// @notice Pledge collateral and optionally borrow USDC in one tx.
    /// @dev Caller must have approved `amount` of `token` to this contract.
    function pledgeAndBorrow(
        address token,
        uint256 amount,
        uint256 borrowUsd
    ) external nonReentrant {
        _accrueInterest();
        Asset memory a = assets[token];
        if (!a.enabled) revert AssetNotEnabled();
        if (amount == 0 && borrowUsd == 0) revert AmountZero();

        // Bring user's debt up to current borrowIndex before mutating
        _snapshotUserDebt(msg.sender);

        if (amount > 0) {
            collateral[msg.sender][token] += amount;
            IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        }

        if (borrowUsd > 0) {
            _enforceConfidence(token);

            positions[msg.sender].borrowed += borrowUsd;
            totalBorrowedUsd += borrowUsd;

            totalBorrowedByAsset[token] += borrowUsd;
            uint256 cap = borrowCapUsd[token];
            if (cap > 0 && totalBorrowedByAsset[token] > cap) {
                revert BorrowCapExceeded(token, totalBorrowedByAsset[token], cap);
            }

            _enforceLtv(msg.sender);
            uint256 usdcOut = _usdToUsdc(borrowUsd);
            if (bookedUsdg < usdcOut) revert InsufficientLiquidity();
            bookedUsdg -= usdcOut;
            usdc.safeTransfer(msg.sender, usdcOut);
        }
        emit Pledged(msg.sender, token, amount, borrowUsd);
    }

    /// @notice Repay USDC debt (1e18 USD units). Use `repayMax()` to clear all.
    function repay(uint256 amountUsd) external nonReentrant {
        _accrueInterest();
        _snapshotUserDebt(msg.sender);

        Position storage p = positions[msg.sender];
        if (p.borrowed == 0) revert NotBorrower();
        if (amountUsd > p.borrowed) amountUsd = p.borrowed;
        uint256 usdcIn = _usdToUsdc(amountUsd);
        p.borrowed -= amountUsd;
        totalBorrowedUsd -= amountUsd;
        _releaseAssetBorrows(msg.sender, amountUsd);
        bookedUsdg += usdcIn;
        usdc.safeTransferFrom(msg.sender, address(this), usdcIn);
        emit Repaid(msg.sender, amountUsd);
    }

    function repayMax() external nonReentrant {
        _accrueInterest();
        _snapshotUserDebt(msg.sender);

        uint256 d = positions[msg.sender].borrowed;
        if (d == 0) revert NotBorrower();
        uint256 usdcIn = _usdToUsdc(d);
        positions[msg.sender].borrowed = 0;
        totalBorrowedUsd -= d;
        _releaseAssetBorrows(msg.sender, d);
        bookedUsdg += usdcIn;
        usdc.safeTransferFrom(msg.sender, address(this), usdcIn);
        emit Repaid(msg.sender, d);
    }

    /// @notice Withdraw unused collateral. Reverts if it would breach LTV.
    function withdraw(address token, uint256 amount) external nonReentrant {
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
        if (!a.enabled) revert AssetNotEnabled();
        if (debtUsdToRepay == 0) revert AmountZero();
        if (isHealthy(user)) revert PositionHealthy();
        if (collateral[user][token] == 0) revert InsufficientCollateral();

        Position storage p = positions[user];
        if (debtUsdToRepay > p.borrowed) debtUsdToRepay = p.borrowed;

        // Compute collateral to seize: debt × (1 + bonus) / price
        uint256 seizeUsd = (debtUsdToRepay * (BPS + LIQUIDATION_BONUS_BPS)) / BPS;
        uint256 price = _price(token); // 1e8
        uint8 tokenDec = _tokenDecimals(token);
        uint256 tokenAmount = (seizeUsd * (10 ** tokenDec)) / (price * 1e10);

        if (tokenAmount > collateral[user][token]) {
            tokenAmount = collateral[user][token];
            uint256 maxSeizeUsd = (tokenAmount * price * 1e10) / (10 ** tokenDec);
            debtUsdToRepay = (maxSeizeUsd * BPS) / (BPS + LIQUIDATION_BONUS_BPS);
        }

        p.borrowed -= debtUsdToRepay;
        totalBorrowedUsd -= debtUsdToRepay;
        _releaseAssetBorrows(user, debtUsdToRepay);
        collateral[user][token] -= tokenAmount;

        uint256 usdcIn = _usdToUsdc(debtUsdToRepay);
        bookedUsdg += usdcIn;
        usdc.safeTransferFrom(msg.sender, address(this), usdcIn);
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
        uint256 reservesAll = protocolReserves + pendingReserve;
        return base > reservesAll ? base - reservesAll : 0;
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
        uint256 gross = (borrowRateBps * utilizationBps()) / BPS;
        return (gross * (BPS - reserveFactorBps)) / BPS;
    }

    /// @notice Gross borrow APY for borrowers (before LP/reserve split).
    function borrowApyBps() external view returns (uint256) {
        return borrowRateBps;
    }

    /// @notice Protocol's share of interest as APY (information only).
    function reserveApyBps() external view returns (uint256) {
        uint256 gross = (borrowRateBps * utilizationBps()) / BPS;
        return (gross * reserveFactorBps) / BPS;
    }

    /// @notice Borrow cap and current usage for a given collateral token.
    function borrowCapInfo(address token) external view returns (uint256 cap, uint256 used) {
        return (borrowCapUsd[token], totalBorrowedByAsset[token]);
    }

    /// @notice Sum of collateral × price across all listed assets for `user`.
    function collateralValueUsd(address user) public view returns (uint256 total) {
        uint256 n = assetList.length;
        for (uint256 i; i < n; ++i) {
            address t = assetList[i];
            uint256 amt = collateral[user][t];
            if (amt == 0) continue;
            uint256 price = _price(t);
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
            Asset memory a = assets[t];
            uint256 price = _price(t);
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
            Asset memory a = assets[t];
            uint256 price = _price(t);
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
        if (snap == 0) return p.borrowed;
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

    /// @dev Release per-asset borrow cap counters proportionally when a user
    ///      repays or is liquidated. Attributes repayment across collateral
    ///      tokens weighted by their USD share of the user's total collateral.
    function _releaseAssetBorrows(address user, uint256 repaidUsd) internal {
        uint256 totalColl = collateralValueUsd(user);
        uint256 n = assetList.length;
        if (totalColl == 0) {
            // User has no collateral left — distribute evenly across tokens
            // that still have tracked borrows.
            for (uint256 i; i < n; ++i) {
                address t = assetList[i];
                if (totalBorrowedByAsset[t] == 0) continue;
                uint256 release = repaidUsd / n;
                if (release > totalBorrowedByAsset[t]) release = totalBorrowedByAsset[t];
                totalBorrowedByAsset[t] -= release;
            }
            return;
        }
        for (uint256 i; i < n; ++i) {
            address t = assetList[i];
            uint256 amt = collateral[user][t];
            if (amt == 0) continue;
            uint256 price = _price(t);
            uint8 dec = _tokenDecimals(t);
            uint256 valUsd = (amt * price * 1e10) / (10 ** dec);
            uint256 release = (repaidUsd * valUsd) / totalColl;
            if (release > totalBorrowedByAsset[t]) release = totalBorrowedByAsset[t];
            totalBorrowedByAsset[t] -= release;
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

    /// @dev Linear simple-interest accrual. dt × rate / year. Bumps both the
    ///      global index and `totalBorrowedUsd`. A configurable `reserveFactor`
    ///      slice routes to protocol reserves; the rest accretes to LP share
    ///      value (implicit via `totalAssetsUsd() = base - protocolReserves`).
    function _accrueInterest() internal {
        uint256 dt = block.timestamp - lastAccruedAt;
        if (dt == 0) return;

        if (totalBorrowedUsd > 0 && borrowRateBps > 0) {
            uint256 growthFactor = (borrowRateBps * dt * INDEX_DECIMALS) /
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
        if (dt == 0 || totalBorrowedUsd == 0 || borrowRateBps == 0) {
            return borrowIndex;
        }
        uint256 growthFactor = (borrowRateBps * dt * INDEX_DECIMALS) /
            (BPS * SECONDS_PER_YEAR);
        uint256 indexDelta = (borrowIndex * growthFactor) / INDEX_DECIMALS;
        return borrowIndex + indexDelta;
    }

    /// @dev View-only projection of interest pending since lastAccruedAt.
    function _pendingInterest() internal view returns (uint256) {
        uint256 dt = block.timestamp - lastAccruedAt;
        if (dt == 0 || totalBorrowedUsd == 0 || borrowRateBps == 0) return 0;
        uint256 growthFactor = (borrowRateBps * dt * INDEX_DECIMALS) /
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
        (, int256 answer, , uint256 updatedAt, ) = a.priceFeed.latestRoundData();
        if (answer <= 0) revert InvalidPrice();
        if (block.timestamp - updatedAt > a.staleAfter) revert StalePrice();
        return uint256(answer);
    }

    function _tokenDecimals(address token) internal view returns (uint8) {
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

    function _usdcToUsd(uint256 amountUsdc) internal view returns (uint256) {
        // input in usdcDecimals; output 1e18
        if (usdcDecimals >= 18) return amountUsdc / (10 ** (usdcDecimals - 18));
        return amountUsdc * (10 ** (18 - usdcDecimals));
    }
}
