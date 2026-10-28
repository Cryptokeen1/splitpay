// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {PayoutVault} from "../PayoutVault.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";

abstract contract PayoutVaultTestBase is Test {
    PayoutVault internal vault;
    MockERC20 internal usdc;

    address internal payer = makeAddr("payer");
    address internal seller = makeAddr("seller");
    address internal arbiter = makeAddr("arbiter");
    address internal stranger = makeAddr("stranger");
    address internal feeRecipient = makeAddr("feeRecipient");
    address internal funder = makeAddr("funder");
    address internal recipient = makeAddr("recipient");
    address internal dest = makeAddr("dest");

    uint256 internal constant T0 = 1_700_000_000;
    uint256 internal constant AMOUNT = 1_000e6;
    uint256 internal constant BIG = 1e30;
    bytes32 internal constant REF = keccak256("ref");

    function setUp() public virtual {
        vm.warp(T0);
        usdc = new MockERC20("Mock USDC", "mUSDC", 6);
        vault = new PayoutVault(address(usdc), feeRecipient);
        _fund(payer);
        _fund(funder);
        _fund(seller);
        _fund(stranger);
    }

    function _fund(address who) internal {
        usdc.mint(who, BIG);
        vm.prank(who);
        usdc.approve(address(vault), type(uint256).max);
    }

    function _fee(uint256 x) internal pure returns (uint256) {
        return (x * 20) / 10_000;
    }

    function _newEscrow(address arb, uint256 amount, uint256 deadlineOffset, bool releaseOnDeadline)
        internal
        returns (uint256 id)
    {
        vm.prank(payer);
        id = vault.createEscrow(seller, arb, amount, uint64(block.timestamp + deadlineOffset), releaseOnDeadline, REF);
    }

    function _vesting(uint256 amount, uint64 start, uint64 cliffDur, uint64 duration, bool revocable)
        internal
        returns (uint256 id)
    {
        vm.prank(funder);
        id = vault.createVesting(recipient, amount, start, cliffDur, duration, revocable, REF);
    }

    function _scheduled(uint256 amount, uint64 unlock, bool revocable) internal returns (uint256 id) {
        vm.prank(funder);
        id = vault.createScheduled(recipient, amount, unlock, revocable, REF);
    }

    function _payroll(uint256 amount, uint64 start, uint64 periodLen, uint32 periods, bool revocable)
        internal
        returns (uint256 id)
    {
        vm.prank(funder);
        id = vault.createPayroll(recipient, amount, start, periodLen, periods, revocable, REF);
    }

    function _claim(uint256 id) internal {
        vm.prank(recipient);
        vault.claim(id, dest);
    }

    function _now() internal view returns (uint64) {
        return uint64(block.timestamp);
    }
}
