// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {PayoutVault} from "../PayoutVault.sol";
import {PayoutVaultTestBase} from "./PayoutVault.Base.t.sol";

contract PayoutVaultEscrowTest is PayoutVaultTestBase {
    uint256 internal constant DAY = 1 days;

    // ---------- deployment ----------
    function test_Constructor_StoresImmutables() public view {
        assertEq(address(vault.usdc()), address(usdc));
        assertEq(vault.feeRecipient(), feeRecipient);
        assertEq(vault.escrowCount(), 0);
        assertEq(vault.planCount(), 0);
        assertEq(vault.FEE_BPS(), 20);
    }

    function test_Constructor_RevertsOnZeroToken() public {
        vm.expectRevert(abi.encodeWithSelector(PayoutVault.ZeroAddress.selector, bytes32("usdc_")));
        new PayoutVault(address(0), feeRecipient);
    }

    function test_Constructor_RevertsOnZeroFeeRecipient() public {
        vm.expectRevert(abi.encodeWithSelector(PayoutVault.ZeroAddress.selector, bytes32("feeRecipient_")));
        new PayoutVault(address(usdc), address(0));
    }

    // ---------- createEscrow ----------
    function test_CreateEscrow_StoresAndPullsFunds() public {
        uint256 before = usdc.balanceOf(payer);
        uint256 id = _newEscrow(arbiter, AMOUNT, DAY, true);
        assertEq(id, 1);
        assertEq(vault.escrowCount(), 1);
        assertEq(usdc.balanceOf(address(vault)), AMOUNT);
        assertEq(usdc.balanceOf(payer), before - AMOUNT);
        PayoutVault.Escrow memory e = vault.getEscrow(id);
        assertEq(e.payer, payer);
        assertEq(e.seller, seller);
        assertEq(e.arbiter, arbiter);
        assertEq(e.amount, AMOUNT);
        assertEq(uint256(e.deadline), T0 + DAY);
        assertTrue(e.releaseOnDeadline);
        assertEq(uint256(e.status), uint256(PayoutVault.Status.Funded));
    }

    function test_CreateEscrow_EmitsEvent() public {
        vm.expectEmit(true, true, true, true, address(vault));
        emit PayoutVault.EscrowCreated(1, payer, seller, arbiter, AMOUNT, uint64(T0 + DAY), false, REF);
        _newEscrow(arbiter, AMOUNT, DAY, false);
    }

    function test_CreateEscrow_IdsIncrement() public {
        assertEq(_newEscrow(address(0), AMOUNT, DAY, true), 1);
        assertEq(_newEscrow(address(0), AMOUNT, DAY, true), 2);
        assertEq(vault.escrowCount(), 2);
    }

    function test_CreateEscrow_AllowsNoArbiter() public {
        uint256 id = _newEscrow(address(0), AMOUNT, DAY, true);
        assertEq(vault.getEscrow(id).arbiter, address(0));
    }

    function test_CreateEscrow_DeadlineExactlyOneHourOk() public {
        _newEscrow(address(0), AMOUNT, 1 hours, true);
        assertEq(vault.escrowCount(), 1);
    }

    function test_RevertCreateEscrow_DeadlineTooSoon() public {
        vm.prank(payer);
        vm.expectRevert(
            abi.encodeWithSelector(PayoutVault.InvalidDeadline.selector, uint64(T0 + 1 hours - 1), T0 + 1 hours)
        );
        vault.createEscrow(seller, address(0), AMOUNT, uint64(T0 + 1 hours - 1), true, REF);
    }

    function test_RevertCreateEscrow_ZeroSeller() public {
        vm.prank(payer);
        vm.expectRevert(abi.encodeWithSelector(PayoutVault.ZeroAddress.selector, bytes32("recipient")));
        vault.createEscrow(address(0), address(0), AMOUNT, uint64(T0 + DAY), true, REF);
    }

    function test_RevertCreateEscrow_SellerIsPayer() public {
        vm.prank(payer);
        vm.expectRevert(abi.encodeWithSelector(PayoutVault.InvalidRecipient.selector, payer));
        vault.createEscrow(payer, address(0), AMOUNT, uint64(T0 + DAY), true, REF);
    }

    function test_RevertCreateEscrow_ZeroAmount() public {
        vm.prank(payer);
        vm.expectRevert(abi.encodeWithSelector(PayoutVault.ZeroAmount.selector, 0));
        vault.createEscrow(seller, address(0), 0, uint64(T0 + DAY), true, REF);
    }

    function test_RevertCreateEscrow_ArbiterIsPayer() public {
        vm.prank(payer);
        vm.expectRevert(abi.encodeWithSelector(PayoutVault.InvalidArbiter.selector, payer));
        vault.createEscrow(seller, payer, AMOUNT, uint64(T0 + DAY), true, REF);
    }

    function test_RevertCreateEscrow_ArbiterIsSeller() public {
        vm.prank(payer);
        vm.expectRevert(abi.encodeWithSelector(PayoutVault.InvalidArbiter.selector, seller));
        vault.createEscrow(seller, seller, AMOUNT, uint64(T0 + DAY), true, REF);
    }

    function test_RevertCreateEscrow_NoAllowance() public {
        address broke = makeAddr("broke");
        usdc.mint(broke, AMOUNT);
        vm.prank(broke);
        vm.expectRevert();
        vault.createEscrow(seller, address(0), AMOUNT, uint64(T0 + DAY), true, REF);
    }

    function test_RevertGetEscrow_Unknown() public {
        vm.expectRevert(abi.encodeWithSelector(PayoutVault.UnknownEscrow.selector, 0));
        vault.getEscrow(0);
        vm.expectRevert(abi.encodeWithSelector(PayoutVault.UnknownEscrow.selector, 5));
        vault.getEscrow(5);
    }

    // ---------- release ----------
    function test_Release_ByPayer() public {
        uint256 id = _newEscrow(arbiter, AMOUNT, DAY, false);
        vm.prank(payer);
        vault.release(id);
        assertEq(vault.balanceOf(seller), AMOUNT - _fee(AMOUNT));
        assertEq(vault.balanceOf(feeRecipient), _fee(AMOUNT));
        assertEq(vault.balanceOf(payer), 0);
        assertEq(uint256(vault.getEscrow(id).status), uint256(PayoutVault.Status.Released));
        assertEq(usdc.balanceOf(address(vault)), AMOUNT, "release moves no tokens");
    }

    function test_Release_ByArbiter() public {
        uint256 id = _newEscrow(arbiter, AMOUNT, DAY, false);
        vm.prank(arbiter);
        vault.release(id);
        assertEq(vault.balanceOf(seller), AMOUNT - _fee(AMOUNT));
        assertEq(vault.balanceOf(feeRecipient), _fee(AMOUNT));
    }

    function test_Release_EmitsEvent() public {
        uint256 id = _newEscrow(arbiter, AMOUNT, DAY, false);
        vm.expectEmit(true, true, false, true, address(vault));
        emit PayoutVault.EscrowReleased(id, seller, AMOUNT, _fee(AMOUNT), arbiter);
        vm.prank(arbiter);
        vault.release(id);
    }

    function test_Release_StillAllowedAfterDeadline() public {
        uint256 id = _newEscrow(arbiter, AMOUNT, DAY, false);
        skip(DAY + 10);
        vm.prank(payer);
        vault.release(id);
        assertEq(vault.balanceOf(seller), AMOUNT - _fee(AMOUNT));
    }

    function test_Release_TinyAmountHasZeroFee() public {
        uint256 id = _newEscrow(arbiter, 499, DAY, false);
        vm.prank(payer);
        vault.release(id);
        assertEq(vault.balanceOf(seller), 499);
        assertEq(vault.balanceOf(feeRecipient), 0);
    }

    function test_RevertRelease_Unauthorized() public {
        uint256 id = _newEscrow(arbiter, AMOUNT, DAY, false);
        address[2] memory bad = [seller, stranger];
        for (uint256 i; i < bad.length; ++i) {
            vm.prank(bad[i]);
            vm.expectRevert(abi.encodeWithSelector(PayoutVault.Unauthorized.selector, bad[i]));
            vault.release(id);
        }
    }

    function test_RevertRelease_NoArbiterStrangerStillBlocked() public {
        uint256 id = _newEscrow(address(0), AMOUNT, DAY, false);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(PayoutVault.Unauthorized.selector, stranger));
        vault.release(id);
    }

    function test_RevertRelease_Unknown() public {
        vm.prank(payer);
        vm.expectRevert(abi.encodeWithSelector(PayoutVault.UnknownEscrow.selector, 1));
        vault.release(1);
    }

    // ---------- refund ----------
    function test_Refund_BySeller() public {
        uint256 id = _newEscrow(arbiter, AMOUNT, DAY, true);
        vm.prank(seller);
        vault.refund(id);
        assertEq(vault.balanceOf(payer), AMOUNT);
        assertEq(vault.balanceOf(seller), 0);
        assertEq(vault.balanceOf(feeRecipient), 0, "no fee on refund");
        assertEq(uint256(vault.getEscrow(id).status), uint256(PayoutVault.Status.Refunded));
    }

    function test_Refund_ByArbiter() public {
        uint256 id = _newEscrow(arbiter, AMOUNT, DAY, true);
        vm.expectEmit(true, true, false, true, address(vault));
        emit PayoutVault.EscrowRefunded(id, payer, AMOUNT, arbiter);
        vm.prank(arbiter);
        vault.refund(id);
        assertEq(vault.balanceOf(payer), AMOUNT);
    }

    function test_RevertRefund_Unauthorized() public {
        uint256 id = _newEscrow(arbiter, AMOUNT, DAY, true);
        address[2] memory bad = [payer, stranger];
        for (uint256 i; i < bad.length; ++i) {
            vm.prank(bad[i]);
            vm.expectRevert(abi.encodeWithSelector(PayoutVault.Unauthorized.selector, bad[i]));
            vault.refund(id);
        }
    }

    function test_RevertRefund_Unknown() public {
        vm.prank(seller);
        vm.expectRevert(abi.encodeWithSelector(PayoutVault.UnknownEscrow.selector, 3));
        vault.refund(3);
    }

    // ---------- single resolution ----------
    function test_RevertAfterRelease_AllResolutionsBlocked() public {
        uint256 id = _newEscrow(arbiter, AMOUNT, DAY, true);
        vm.prank(payer);
        vault.release(id);
        skip(DAY);
        bytes memory err = abi.encodeWithSelector(PayoutVault.EscrowNotFunded.selector, id);
        vm.prank(payer);
        vm.expectRevert(err);
        vault.release(id);
        vm.prank(seller);
        vm.expectRevert(err);
        vault.refund(id);
        vm.expectRevert(err);
        vault.settleAfterDeadline(id);
    }

    function test_RevertAfterRefund_AllResolutionsBlocked() public {
        uint256 id = _newEscrow(arbiter, AMOUNT, DAY, false);
        vm.prank(seller);
        vault.refund(id);
        skip(DAY);
        bytes memory err = abi.encodeWithSelector(PayoutVault.EscrowNotFunded.selector, id);
        vm.prank(payer);
        vm.expectRevert(err);
        vault.release(id);
        vm.prank(seller);
        vm.expectRevert(err);
        vault.refund(id);
        vm.expectRevert(err);
        vault.settleAfterDeadline(id);
    }

    // ---------- settleAfterDeadline ----------
    function test_Settle_ReleaseOnDeadline_ByStranger() public {
        uint256 id = _newEscrow(arbiter, AMOUNT, DAY, true);
        skip(DAY);
        vm.expectEmit(true, true, false, true, address(vault));
        emit PayoutVault.EscrowReleased(id, seller, AMOUNT, _fee(AMOUNT), stranger);
        vm.prank(stranger);
        vault.settleAfterDeadline(id);
        assertEq(vault.balanceOf(seller), AMOUNT - _fee(AMOUNT));
        assertEq(vault.balanceOf(feeRecipient), _fee(AMOUNT));
        assertEq(uint256(vault.getEscrow(id).status), uint256(PayoutVault.Status.Released));
    }

    function test_Settle_RefundOnDeadline_ByStranger() public {
        uint256 id = _newEscrow(arbiter, AMOUNT, DAY, false);
        skip(DAY + 1);
        vm.expectEmit(true, true, false, true, address(vault));
        emit PayoutVault.EscrowRefunded(id, payer, AMOUNT, stranger);
        vm.prank(stranger);
        vault.settleAfterDeadline(id);
        assertEq(vault.balanceOf(payer), AMOUNT);
        assertEq(vault.balanceOf(feeRecipient), 0);
        assertEq(uint256(vault.getEscrow(id).status), uint256(PayoutVault.Status.Refunded));
    }

    function test_RevertSettle_BeforeDeadline() public {
        uint256 id = _newEscrow(arbiter, AMOUNT, DAY, true);
        skip(DAY - 1);
        vm.expectRevert(abi.encodeWithSelector(PayoutVault.DeadlineNotReached.selector, uint64(T0 + DAY), T0 + DAY - 1));
        vault.settleAfterDeadline(id);
    }

    function test_RevertSettle_Unknown() public {
        vm.expectRevert(abi.encodeWithSelector(PayoutVault.UnknownEscrow.selector, 9));
        vault.settleAfterDeadline(9);
    }

    // ---------- end-to-end payout ----------
    function test_Escrow_ReleasedFundsWithdrawable() public {
        uint256 id = _newEscrow(arbiter, AMOUNT, DAY, true);
        vm.prank(payer);
        vault.release(id);
        vm.prank(seller);
        vault.withdraw(dest);
        vm.prank(feeRecipient);
        vault.withdraw(feeRecipient);
        assertEq(usdc.balanceOf(dest), AMOUNT - _fee(AMOUNT));
        assertEq(usdc.balanceOf(feeRecipient), _fee(AMOUNT));
        assertEq(usdc.balanceOf(address(vault)), 0);
    }
}
