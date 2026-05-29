// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
import {IPyth} from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import {PythStructs} from "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title  PythPriceAdapter
/// @notice Wraps a Pyth Network price feed behind the classic
///         `AggregatorV3Interface` that EquiFlowVault consumes. One adapter
///         per (asset, priceId).
///
///         Only authorized keepers (or the owner) may push price updates.
///         Anyone may push a Pyth update via `updatePrice(bytes[] updateData)`.
///         The adapter:
///           1. Pays the Pyth update fee (`pyth.getUpdateFee` → msg.value).
///           2. Forwards to `pyth.updatePriceFeeds` — on a real Pyth contract
///              this verifies Wormhole signatures; on MockPyth (used on RBN
///              which lacks Pyth deployment) the update is accepted verbatim.
///           3. Reads back via `pyth.getPriceNoOlderThan`.
///           4. Normalises Pyth's `(price, expo)` into 1e8-scaled int256
///              (the convention the vault assumes).
///
///         Migration to real Pyth on Arbitrum Sepolia is a one-line address
///         change at deploy time (`0x4374e5a8b9C22271E9EB878A2AA31DE97DF15DAF`).
/// @notice L-01 fix (2026-05 pass 4): inherits `Ownable2Step` so adapter
///         ownership rotation is two-tx — protects the keeper-admin role
///         under a single-key compromise.
contract PythPriceAdapter is AggregatorV3Interface, Ownable2Step {
    // ─── Immutables ──────────────────────────────────────────────────────
    IPyth public immutable pyth;
    bytes32 public immutable priceId;

    /// @notice Maximum age (seconds) Pyth's `getPriceNoOlderThan` will accept.
    uint64 public immutable maxAge;

    // ─── State ───────────────────────────────────────────────────────────
    string private _description;

    int256 private _price; // 1e8-scaled
    uint256 private _updatedAt; // unix seconds — Pyth publishTime
    uint80 private _round;
    int32 private _lastExpo;
    uint64 private _lastConf;

    /// @notice Audit 2026-05 (completeness fix): wall-clock timestamp of the
    ///         last accepted adapter write. The `forceUpdatePrice` override
    ///         delay is measured against THIS, not the oracle `publishTime`
    ///         (`_updatedAt`). Otherwise a keeper could submit a within-cap
    ///         update carrying a backdated publishTime and instantly satisfy
    ///         the delay, defeating the H-02 anti-compromise guarantee.
    uint256 private _lastWriteAt;

    /// @notice Max allowed price change per update in BPS. 0 = uncapped.
    /// CRIT-8 fix: defaults to 5% (500 bps) on construction so a missed
    /// `setMaxDeviation` at deploy time still produces a sane cap.
    uint256 public maxDeviationBps;

    /// @notice Hard upper bound on `maxDeviationBps`. Owner cannot push the
    /// cap above 20% via `setMaxDeviation`. Keeps the deviation guard
    /// meaningful against a key compromise.
    uint256 public constant MAX_DEVIATION_BPS_CEILING = 2_000;

    /// @notice H-02 fix (2026-05 audit): once the cached price is older than
    /// this delay, a keeper may push a deviation-breaking update via
    /// `forceUpdatePrice`. Recovers liveness after legitimate gap moves
    /// (halts, earnings, market open) without owner intervention. Chosen
    /// to fire BEFORE the typical `staleAfter` (1h) used by the vault so
    /// positions never freeze first. A compromised keeper still cannot
    /// instantly bypass the cap — they would need to wait this long with
    /// the price already aged.
    uint256 public constant DEVIATION_OVERRIDE_DELAY = 30 minutes;

    // ─── Keeper whitelist (C-02 fix) ─────────────────────────────────────
    mapping(address => bool) public authorizedKeepers;

    // ─── Pending refunds (L-06 fix: pull-over-push) ──────────────────────
    mapping(address => uint256) public pendingRefunds;
    uint256 public totalPendingRefunds;

    event PriceUpdated(int256 priceE8, uint64 publishTime, int32 expo, uint80 round);
    event PriceForceUpdated(int256 oldPriceE8, int256 newPriceE8, uint256 ageAtOverride);
    event KeeperAuthorized(address indexed keeper, bool authorized);
    event RefundClaimed(address indexed keeper, uint256 amount);
    event MaxDeviationSet(uint256 oldBps, uint256 newBps);

    error PriceIdMismatch(bytes32 expected, bytes32 got);
    error InvalidPrice(int64 raw);
    error NotAuthorizedKeeper();
    error ExponentOutOfRange(int32 expo);
    error PublishTimeTooOld(uint256 publishTime, uint256 blockTimestamp);

    modifier onlyKeeper() {
        if (msg.sender != owner() && !authorizedKeepers[msg.sender])
            revert NotAuthorizedKeeper();
        _;
    }

    /// @param _pyth          Pyth contract (`IPyth`). On RBN this is MockPyth;
    ///                       on Arbitrum Sepolia this is the real Pyth deployment.
    /// @param _priceId       Pyth price feed id (bytes32).
    /// @param description_   Human-readable, e.g. "TSLA/USD".
    /// @param initialPriceE8 Seed price (8 decimals) so the vault works
    ///                       immediately after deploy without a Pyth roundtrip.
    /// @param _maxAge        Staleness ceiling for `getPriceNoOlderThan` (s).
    constructor(
        IPyth _pyth,
        bytes32 _priceId,
        string memory description_,
        int256 initialPriceE8,
        uint64 _maxAge,
        address _owner
    ) Ownable(_owner) {
        pyth = _pyth;
        priceId = _priceId;
        _description = description_;
        _price = initialPriceE8;
        _updatedAt = block.timestamp;
        _lastWriteAt = block.timestamp;
        _round = 1;
        _lastExpo = -8;
        maxAge = _maxAge;
        // CRIT-8 fix: never leave deviation uncapped on a fresh adapter.
        maxDeviationBps = 500; // 5%
    }

    // ─── Keeper management ───────────────────────────────────────────────
    function setKeeper(address keeper, bool authorized) external onlyOwner {
        authorizedKeepers[keeper] = authorized;
        emit KeeperAuthorized(keeper, authorized);
    }

    function setMaxDeviation(uint256 bps) external onlyOwner {
        require(bps <= MAX_DEVIATION_BPS_CEILING, "deviation>ceiling");
        uint256 old = maxDeviationBps;
        maxDeviationBps = bps;
        emit MaxDeviationSet(old, bps);
    }

    /// @notice Submit one or more Pyth update payloads and cache the resulting
    ///         price. Pass `[bytes]` from Hermes `/v2/updates/price/latest`.
    function updatePrice(bytes[] calldata updateData) external payable onlyKeeper {
        _applyUpdate(updateData, true);
    }

    /// @notice H-02 fix (2026-05 audit): keeper escape hatch when the
    ///         deviation cap would otherwise permanently reject every
    ///         update during a legitimate gap move (e.g. halt re-open,
    ///         earnings shock). Only callable once the cached price has
    ///         aged past `DEVIATION_OVERRIDE_DELAY`, so a compromised
    ///         keeper still cannot bypass the cap on a fresh price. Emits
    ///         a distinct `PriceForceUpdated` event for monitoring.
    function forceUpdatePrice(bytes[] calldata updateData) external payable onlyKeeper {
        // Audit 2026-05 fix: age is wall-clock since the last accepted write
        // (`_lastWriteAt`), NOT the oracle publishTime. A backdated publishTime
        // can no longer manufacture the override window without real elapsed
        // time, so a compromised keeper genuinely must wait the full delay.
        uint256 age = block.timestamp > _lastWriteAt ? block.timestamp - _lastWriteAt : 0;
        require(age >= DEVIATION_OVERRIDE_DELAY, "override too soon");
        int256 oldPriceE8 = _price;
        _applyUpdate(updateData, false);
        emit PriceForceUpdated(oldPriceE8, _price, age);
    }

    /// @dev Shared implementation for `updatePrice` and `forceUpdatePrice`.
    ///      `enforceDeviation` toggles the per-update deviation cap.
    function _applyUpdate(bytes[] calldata updateData, bool enforceDeviation) internal {
        uint256 fee = pyth.getUpdateFee(updateData);
        pyth.updatePriceFeeds{value: fee}(updateData);

        PythStructs.Price memory p = pyth.getPriceNoOlderThan(priceId, maxAge);
        if (p.price <= 0) revert InvalidPrice(p.price);

        // H-01 fix: reject data where publishTime is too old relative to block.timestamp
        if (block.timestamp > p.publishTime && block.timestamp - p.publishTime > maxAge) {
            revert PublishTimeTooOld(p.publishTime, block.timestamp);
        }

        // M-01 fix: bounds check on exponent
        if (p.expo < -18 || p.expo > 18) revert ExponentOutOfRange(p.expo);

        int256 priceE8 = _toE8(p.price, p.expo);
        if (enforceDeviation && maxDeviationBps > 0 && _price > 0) {
            uint256 oldP = uint256(_price);
            uint256 newP = uint256(priceE8);
            uint256 deviation = newP > oldP ? newP - oldP : oldP - newP;
            require(deviation * 10_000 / oldP <= maxDeviationBps, "price deviation too large");
        }
        _price = priceE8;
        _updatedAt = p.publishTime;
        _lastWriteAt = block.timestamp;
        _lastExpo = p.expo;
        // Audit 2026-05 (finding #2 fix): Pyth stores price AND confidence in
        // the same `x * 10^expo` representation, so confidence must be scaled
        // to the fixed 1e8 convention identically to price. Storing raw `conf`
        // left the vault's `conf * BPS / answer` width check dimensionally
        // wrong (off by 10^(expo+8)) for any feed whose expo != -8.
        _lastConf = _confToE8(p.conf, p.expo);
        unchecked {
            _round += 1;
        }

        // L-06 fix: pull-over-push refund pattern
        uint256 remainder = msg.value - fee;
        if (remainder > 0) {
            pendingRefunds[msg.sender] += remainder;
            totalPendingRefunds += remainder;
        }

        emit PriceUpdated(priceE8, uint64(p.publishTime), p.expo, _round);
    }

    /// @notice Claim accumulated refunds from overpaid updatePrice calls.
    function claimRefund() external {
        uint256 amount = pendingRefunds[msg.sender];
        if (amount == 0) return;
        pendingRefunds[msg.sender] = 0;
        totalPendingRefunds -= amount;
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "refund failed");
        emit RefundClaimed(msg.sender, amount);
    }

    /// @dev Convert Pyth `(price, expo)` to a fixed 1e8 scale.
    ///      Pyth's published equity feeds typically use `expo = -8` (so the
    ///      raw `price` is already 1e8-scaled), but the helper handles any
    ///      negative or positive exponent defensively.
    function _toE8(int64 price, int32 expo) internal pure returns (int256) {
        if (expo == -8) return int256(price);
        if (expo < -8) {
            uint256 div = 10 ** uint32(-expo - 8);
            return int256(price) / int256(div);
        }
        uint256 mul = 10 ** uint32(expo + 8);
        return int256(price) * int256(mul);
    }

    /// @dev Normalize a Pyth confidence value to the fixed 1e8 scale, using
    ///      the same exponent transform as `_toE8` (conf shares the price
    ///      exponent in Pyth's representation). Computed in uint256 and bounds
    ///      the result to uint64 so the `confidence()` ABI stays unchanged;
    ///      a normalized confidence exceeding uint64 is pathological and
    ///      reverts rather than silently truncating the breaker's input.
    function _confToE8(uint64 conf, int32 expo) internal pure returns (uint64) {
        if (expo == -8) return conf;
        uint256 c;
        if (expo < -8) {
            c = uint256(conf) / (10 ** uint32(-expo - 8));
        } else {
            c = uint256(conf) * (10 ** uint32(expo + 8));
        }
        require(c <= type(uint64).max, "conf overflow");
        return uint64(c);
    }

    // ─── AggregatorV3Interface ───────────────────────────────────────────
    function decimals() external pure returns (uint8) {
        return 8;
    }

    function description() external view returns (string memory) {
        return _description;
    }

    function version() external pure returns (uint256) {
        return 1;
    }

    function getRoundData(uint80 roundId_)
        external
        view
        returns (uint80, int256, uint256, uint256, uint80)
    {
        return (roundId_, _price, _updatedAt, _updatedAt, roundId_);
    }

    function latestRoundData()
        external
        view
        returns (uint80, int256, uint256, uint256, uint80)
    {
        return (_round, _price, _updatedAt, _updatedAt, _round);
    }

    // ─── Extra views ─────────────────────────────────────────────────────
    function confidence() external view returns (uint64) {
        return _lastConf;
    }

    /// @notice M-03 fix (2026-05 pass 6): companion timestamp for
    ///         `confidence()`. Returns the same `_updatedAt` (= Pyth
    ///         publishTime of the last accepted update) since confidence
    ///         is set in the same `_applyUpdate` call as the price.
    ///         Consumers should require freshness against this stamp
    ///         independently of the price-read path, so a refactor that
    ///         uses a stale-tolerant price helper cannot leave the
    ///         confidence check reading authoritative-looking but stale
    ///         data.
    function confidenceUpdatedAt() external view returns (uint256) {
        return _updatedAt;
    }

    function exponent() external view returns (int32) {
        return _lastExpo;
    }

    /// @notice Recover stranded ETH sent directly to the adapter.
    function recoverEth(address payable to) external onlyOwner {
        uint256 recoverable = address(this).balance - totalPendingRefunds;
        require(recoverable > 0, "no recoverable ETH");
        (bool ok, ) = to.call{value: recoverable}("");
        require(ok, "transfer failed");
    }

    receive() external payable {}
}
