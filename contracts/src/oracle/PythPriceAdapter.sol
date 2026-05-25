// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
import {IPyth} from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import {PythStructs} from "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

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
contract PythPriceAdapter is AggregatorV3Interface, Ownable {
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

    /// @notice Max allowed price change per update in BPS. 0 = uncapped.
    uint256 public maxDeviationBps;

    // ─── Keeper whitelist (C-02 fix) ─────────────────────────────────────
    mapping(address => bool) public authorizedKeepers;

    // ─── Pending refunds (L-06 fix: pull-over-push) ──────────────────────
    mapping(address => uint256) public pendingRefunds;
    uint256 public totalPendingRefunds;

    event PriceUpdated(int256 priceE8, uint64 publishTime, int32 expo, uint80 round);
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
        _round = 1;
        _lastExpo = -8;
        maxAge = _maxAge;
    }

    // ─── Keeper management ───────────────────────────────────────────────
    function setKeeper(address keeper, bool authorized) external onlyOwner {
        authorizedKeepers[keeper] = authorized;
        emit KeeperAuthorized(keeper, authorized);
    }

    function setMaxDeviation(uint256 bps) external onlyOwner {
        maxDeviationBps = bps;
    }

    /// @notice Submit one or more Pyth update payloads and cache the resulting
    ///         price. Pass `[bytes]` from Hermes `/v2/updates/price/latest`.
    function updatePrice(bytes[] calldata updateData) external payable onlyKeeper {
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
        if (maxDeviationBps > 0 && _price > 0) {
            uint256 oldP = uint256(_price);
            uint256 newP = uint256(priceE8);
            uint256 deviation = newP > oldP ? newP - oldP : oldP - newP;
            require(deviation * 10_000 / oldP <= maxDeviationBps, "price deviation too large");
        }
        _price = priceE8;
        _updatedAt = p.publishTime;
        _lastExpo = p.expo;
        _lastConf = p.conf;
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
