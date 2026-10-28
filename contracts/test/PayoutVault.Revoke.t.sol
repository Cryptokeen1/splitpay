// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {PayoutVault} from "../PayoutVault.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";
import {PayoutVaultTestBase} from "./PayoutVault.Base.t.sol";

contract PayoutVaultRevokeTest is PayoutVaultTestBase {
    uint64 internal constant HUNDRED = 100 days;

    function _revoke(uint256 id) internal {
        vm.prank(funder);
        vault.revoke(id);
    }

    // ---------- revoke ----------
    function test_Revoke_CreditsUnvestedToFunderWithoutFee() public {
        uint256 id = _vesting(AMOUNT, _now(), 0, HUNDRED, true);
        skip(40 days);
        vm.expectEmit(true, true, false, true, address(vault));
        emit PayoutVault.PlanRevoked(id, funder, 600e6, 400e6);
        _revoke(id);
        assertEq(vault.balanceOf(funder), 600e6);
        assertEq(vault.balanceOf(feeRecipient), 0, "no fee on revoke");
        PayoutVault.Plan memory p = vault.getPlan(id);
        assertEq(uint256(p.revokedAt), T0 + 40 days);
        assertEq(p.total, AMOUNT);
        assertEq(usdc.balanceOf(address(vault)), AMOUNT, "revoke moves no tokens");
    }

    function test_Revoke_VestedIsFrozen() public {
        uint256 id = _vesting(AMOUNT, _now(), 0, HUNDRED, true);
        skip(40 days);
        _revoke(id);
        skip(500 days);
        assertEq(vault.vestedAmount(id), 400e6);
        assertEq(vault.releasable(id), 400e6);
    }

    function test_Revoke_RecipientKeepsVestedAndCanStillClaim() public {
        uint256 id = _vesting(AMOUNT, _now(), 0, HUNDRED, true);
        skip(40 days);
        _revoke(id);
        skip(200 days);
        _claim(id);
        assertEq(usdc.balanceOf(dest), 400e6 - _fee(400e6));
        assertEq(vault.balanceOf(feeRecipient), _fee(400e6));
        vm.prank(recipient);
        vm.expectRevert(abi.encodeWithSelector(PayoutVault.NothingToClaim.selector, id));
        vault.claim(id, dest);
        // funder can pull the refund, vault left empty except fees
        vm.prank(funder);
        vault.withdraw(funder);
        assertEq(usdc.balanceOf(address(vault)), vault.balanceOf(feeRecipient));
    }

    function test_Revoke_AfterPartialClaim() public {
        uint256 id = _vesting(AMOUNT, _now(), 0, HUNDRED, true);
        skip(20 days);
        _claim(id);
        skip(20 days);
        _revoke(id);
        assertEq(vault.releasable(id), 200e6);
        _claim(id);
        assertEq(vault.getPlan(id).claimed, 400e6);
        assertEq(vault.balanceOf(funder), 600e6);
    }

    function test_Revoke_BeforeCliffRefundsEverything() public {
        uint256 id = _vesting(AMOUNT, _now(), 30 days, HUNDRED, true);
        skip(10 days);
        _revoke(id);
        assertEq(vault.balanceOf(funder), AMOUNT);
        assertEq(vault.vestedAmount(id), 0);
        vm.prank(recipient);
        vm.expectRevert(abi.encodeWithSelector(PayoutVault.NothingToClaim.selector, id));
        vault.claim(id, dest);
    }

    function test_Revoke_BeforeStartRefundsEverything() public {
        uint256 id = _vesting(AMOUNT, _now() + 5 days, 0, HUNDRED, true);
        _revoke(id);
        assertEq(vault.balanceOf(funder), AMOUNT);
        skip(300 days);
        assertEq(vault.vestedAmount(id), 0);
    }

    function test_Revoke_AfterEndCreditsNothing() public {
        uint256 id = _vesting(AMOUNT, _now(), 0, HUNDRED, true);
        skip(HUNDRED + 1);
        _revoke(id);
        assertEq(vault.balanceOf(funder), 0);
        assertEq(vault.releasable(id), AMOUNT);
    }

    function test_Revoke_ScheduledBeforeUnlockRefundsAll() public {
        uint256 id = _scheduled(AMOUNT, _now() + 1 days, true);
        _revoke(id);
        assertEq(vault.balanceOf(funder), AMOUNT);
        skip(2 days);
        assertEq(vault.vestedAmount(id), 0);
    }

    function test_Revoke_ScheduledAfterUnlockRefundsNothing() public {
        uint256 id = _scheduled(AMOUNT, _now() + 1 days, true);
        skip(1 days);
        _revoke(id);
        assertEq(vault.balanceOf(funder), 0);
        assertEq(vault.releasable(id), AMOUNT);
    }

    function test_Revoke_PayrollMidStep() public {
        uint256 amount = 1_000_000_007;
        uint256 step = amount / 3;
        uint256 id = _payroll(amount, _now(), 30 days, 3, true);
        skip(45 days);
        _revoke(id);
        assertEq(vault.vestedAmount(id), step);
        assertEq(vault.balanceOf(funder), amount - step);
    }

    function test_Revoke_FunderWithdrawsRefund() public {
        uint256 id = _vesting(AMOUNT, _now(), 0, HUNDRED, true);
        skip(40 days);
        _revoke(id);
        uint256 before = usdc.balanceOf(dest);
        vm.prank(funder);
        vault.withdraw(dest);
        assertEq(usdc.balanceOf(dest) - before, 600e6);
    }

    function test_RevertRevoke_NotFunder() public {
        uint256 id = _vesting(AMOUNT, _now(), 0, HUNDRED, true);
        address[3] memory bad = [recipient, stranger, payer];
        for (uint256 i; i < bad.length; ++i) {
            vm.prank(bad[i]);
            vm.expectRevert(abi.encodeWithSelector(PayoutVault.Unauthorized.selector, bad[i]));
            vault.revoke(id);
        }
    }

    function test_RevertRevoke_NotRevocable() public {
        uint256 id = _vesting(AMOUNT, _now(), 0, HUNDRED, false);
        vm.prank(funder);
        vm.expectRevert(abi.encodeWithSelector(PayoutVault.NotRevocable.selector, id));
        vault.revoke(id);
        uint256 s = _scheduled(AMOUNT, _now() + 1 days, false);
        vm.prank(funder);
        vm.expectRevert(abi.encodeWithSelector(PayoutVault.NotRevocable.selector, s));
        vault.revoke(s);
        uint256 r = _payroll(AMOUNT, _now(), 1 days, 3, false);
        vm.prank(funder);
        vm.expectRevert(abi.encodeWithSelector(PayoutVault.NotRevocable.selector, r));
        vault.revoke(r);
    }

    function test_RevertRevoke_Twice() public {
        uint256 id = _vesting(AMOUNT, _now(), 0, HUNDRED, true);
        skip(10 days);
        _revoke(id);
        skip(1 days);
        vm.prank(funder);
        vm.expectRevert(abi.encodeWithSelector(PayoutVault.AlreadyRevoked.selector, id, uint64(T0 + 10 days)));
        vault.revoke(id);
        assertEq(vault.balanceOf(funder), 900e6);
    }

    function test_RevertRevoke_UnknownPlan() public {
        vm.prank(funder);
        vm.expectRevert(abi.encodeWithSelector(PayoutVault.UnknownPlan.selector, 1));
        vault.revoke(1);
    }

    // ---------- withdraw ----------
    function test_Withdraw_PaysFullBalanceAndZeroes() public {
        uint256 id = _newEscrow(address(0), AMOUNT, 1 days, true);
        vm.prank(payer);
        vault.release(id);
        uint256 net = AMOUNT - _fee(AMOUNT);
        vm.expectEmit(true, false, false, true, address(vault));
        emit PayoutVault.Withdrawn(seller, dest, net);
        vm.prank(seller);
        vault.withdraw(dest);
        assertEq(usdc.balanceOf(dest), net);
        assertEq(vault.balanceOf(seller), 0);
        assertEq(usdc.balanceOf(address(vault)), _fee(AMOUNT));
    }

    function test_Withdraw_FeeRecipientWithdrawsFees() public {
        uint256 id = _scheduled(AMOUNT, _now() + 1 hours, false);
        skip(1 hours);
        _claim(id);
        vm.prank(feeRecipient);
        vault.withdraw(feeRecipient);
        assertEq(usdc.balanceOf(feeRecipient), _fee(AMOUNT));
        assertEq(usdc.balanceOf(address(vault)), 0);
    }

    function test_RevertWithdraw_ZeroBalance() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(PayoutVault.NoBalance.selector, stranger));
        vault.withdraw(dest);
    }

    function test_RevertWithdraw_SecondTimeEmpty() public {
        uint256 id = _newEscrow(address(0), AMOUNT, 1 days, true);
        vm.prank(seller);
        vault.refund(id);
        vm.startPrank(payer);
        vault.withdraw(payer);
        vm.expectRevert(abi.encodeWithSelector(PayoutVault.NoBalance.selector, payer));
        vault.withdraw(payer);
        vm.stopPrank();
    }

    function test_RevertWithdraw_ZeroAddress() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(PayoutVault.ZeroAddress.selector, bytes32("to")));
        vault.withdraw(address(0));
    }

    function test_RevertWithdraw_ZeroAddressEvenWithBalance() public {
        uint256 id = _newEscrow(address(0), AMOUNT, 1 days, true);
        vm.prank(seller);
        vault.refund(id);
        vm.prank(payer);
        vm.expectRevert(abi.encodeWithSelector(PayoutVault.ZeroAddress.selector, bytes32("to")));
        vault.withdraw(address(0));
        assertEq(vault.balanceOf(payer), AMOUNT, "balance untouched");
    }

    // ---------- exact-receipt funding ----------
    function _freshVault(MockERC20 t) internal returns (PayoutVault v) {
        v = new PayoutVault(address(t), feeRecipient);
        t.mint(funder, BIG);
        vm.prank(funder);
        t.approve(address(v), type(uint256).max);
    }

    function test_RevertFunding_FeeOnTransferToken() public {
        MockERC20 fot = new MockERC20("FoT", "FOT", 6);
        fot.setBurnBps(100); // 1%
        PayoutVault v = _freshVault(fot);
        bytes memory err = abi.encodeWithSelector(PayoutVault.UnexpectedReceivedAmount.selector, AMOUNT, 990e6);
        vm.startPrank(funder);
        vm.expectRevert(err);
        v.createEscrow(seller, address(0), AMOUNT, uint64(T0 + 1 days), true, REF);
        vm.expectRevert(err);
        v.createVesting(recipient, AMOUNT, _now(), 0, HUNDRED, true, REF);
        vm.expectRevert(err);
        v.createScheduled(recipient, AMOUNT, uint64(T0 + 1 days), true, REF);
        vm.expectRevert(err);
        v.createPayroll(recipient, AMOUNT, _now(), 1 days, 3, true, REF);
        vm.stopPrank();
        assertEq(v.escrowCount(), 0);
        assertEq(v.planCount(), 0);
        assertEq(fot.balanceOf(address(v)), 0, "reverted funding leaves nothing behind");
    }

    function test_RevertFunding_ExcessReceiptToken() public {
        MockERC20 bonus = new MockERC20("Bonus", "BON", 6);
        bonus.setBonusBps(100);
        PayoutVault v = _freshVault(bonus);
        vm.prank(funder);
        vm.expectRevert(abi.encodeWithSelector(PayoutVault.UnexpectedReceivedAmount.selector, AMOUNT, 1010e6));
        v.createEscrow(seller, address(0), AMOUNT, uint64(T0 + 1 days), true, REF);
    }

    function test_Funding_PlainTokenExactReceiptSucceeds() public {
        MockERC20 plain = new MockERC20("Plain", "PLN", 6);
        PayoutVault v = _freshVault(plain);
        vm.prank(funder);
        v.createEscrow(seller, address(0), AMOUNT, uint64(T0 + 1 days), true, REF);
        assertEq(plain.balanceOf(address(v)), AMOUNT);
    }
}
