// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Test-only 6-decimal ERC20. Optionally burns a fee on every transfer
///         (fee-on-transfer) or mints a bonus to the receiver (excess receipt).
contract MockERC20 is ERC20 {
    uint8 private immutable _dec;
    uint256 public burnBps;
    uint256 public bonusBps;

    constructor(string memory n, string memory s, uint8 d) ERC20(n, s) {
        _dec = d;
    }

    function decimals() public view override returns (uint8) {
        return _dec;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setBurnBps(uint256 bps) external {
        burnBps = bps;
    }

    function setBonusBps(uint256 bps) external {
        bonusBps = bps;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0) && (burnBps != 0 || bonusBps != 0)) {
            uint256 burnt = (value * burnBps) / 10_000;
            uint256 bonus = (value * bonusBps) / 10_000;
            super._update(from, to, value - burnt);
            if (burnt != 0) super._update(from, address(0), burnt);
            if (bonus != 0) super._update(address(0), to, bonus);
        } else {
            super._update(from, to, value);
        }
    }
}
