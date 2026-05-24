// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Stand-in tokenized equity (e.g. TSLA, AAPL). 18 decimals, open mint.
///         Use only when Robinhood Chain's faucet tokens are unavailable.
contract MockStockToken is ERC20 {
    constructor(string memory name_, string memory symbol_)
        ERC20(name_, symbol_)
    {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
