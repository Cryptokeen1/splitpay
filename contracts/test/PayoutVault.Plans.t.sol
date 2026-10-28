// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {PayoutVault} from "../PayoutVault.sol";
import {PayoutVaultTestBase} from "./PayoutVault.Base.t.sol";

contract PayoutVaultPlansTest is PayoutVaultTestBase {
    uint64 internal constant DAY = 1 days;
    uint64 internal constant HUNDRED = 100 days;

    // ---------- vesting: creation ----------
    function test_CreateVesting_StoresPlanAndPullsFunds() public {
        uint256 id = _vesting(AMOUNT, _now(), 30 days, HUNDRED, true);
        assertEq(id, 1);
        assertEq(vault.planCount(), 1);
        assertEq(usdc.balanceOf(address(vault)), AMOUNT);
        PayoutVault.Plan memory p = vault.getPlan(id);
        assertEq(uint256(p.kind), uint256(PayoutVault.Kind.Vesting));
        assertEq(p.funder, funder);
        assertEq(p.recipient, recipient);
        assertEq(p.total, AMOUNT);
        assertEq(p.claimed, 0);
        assertEq(uint256(p.start), T0);
        assertEq(uint256(p.cliff), T0 + 30 days);
        assertEq(uint256(p.duration), HUNDRED);
        assertTrue(p.revocable);
        assertEq(uint256(p.revokedAt), 0);
    }

    function test_CreateVesting_EmitsEvent() public {
        vm.expectEmit(true, true, true, true, address(vault));
        emit PayoutVault.PlanCreated(
            1, PayoutVault.Kind.Vesting, funder, recipient, AMOUNT, uint64(T0), uint64(T0 + 30 days), HUNDRED, 0, true, REF
        );
        _vesting(AMOUNT, _now(), 30 days, HUNDRED, true);
    }

    function test_CreateVesting_PastStartAllowedIfEndInFuture() public {
        uint256 id = _vesting(AMOUNT, _now() - 50 days, 0, HUNDRED, false);
        assertEq(vault.vestedAmount(id), AMOUNT / 2);
    }

    function test_RevertCreateVesting_Validation() public {
        vm.startPrank(funder);
        vm.expectRevert(abi.encodeWithSelector(PayoutVault.InvalidDuration.selector, uint64(1 hours - 1), 1 hours));
        vault.createVesting(recipient, AMOUNT, _now(), 0, 1 hours - 1, true, REF);
        vm.expectRevert(abi.encodeWithSelector(PayoutVault.InvalidCliff.selector, HUNDRED + 1, HUNDRED));
        vault.createVesting(recipient, AMOUNT, _now(), HUNDRED + 1, HUNDRED, true, REF);
        vm.expectRevert(abi.encodeWithSelector(PayoutVault.ZeroAddress.selector, bytes32("recipient")));
        vault.createVesting(address(0), AMOUNT, _now(), 0, HUNDRED, true, REF);
        vm.expectRevert(abi.encodeWithSelector(PayoutVault.InvalidRecipient.selector, funder));
        vault.createVesting(funder, AMOUNT, _now(), 0, HUNDRED, true, REF);
        vm.expectRevert(abi.encodeWithSelector(PayoutVault.ZeroAmount.selector, 0));
        vault.createVesting(recipient, 0, _now(), 0, HUNDRED, true, REF);
        // end exactly == now is not strictly in the future
        uint64 start = _now() - HUNDRED;
        vm.expectRevert(abi.encodeWithSelector(PayoutVault.PlanMustEndInFuture.selector, _now(), T0));
        vault.createVesting(recipient, AMOUNT, start, 0, HUNDRED, true, REF);
        vm.stopPrank();
    }

    // ---------- vesting: linear + cliff ----------
    function test_Vesting_Linear() public {
        uint256 id = _vesting(AMOUNT, _now(), 0, HUNDRED, false);
        assertEq(vault.vestedAmount(id), 0);
        skip(25 days);
        assertEq(vault.vestedAmount(id), 250e6);
        assertEq(vault.releasable(id), 250e6);
        skip(75 days);
        assertEq(vault.vestedAmount(id), AMOUNT);
        skip(1000 days);
        assertEq(vault.vestedAmount(id), AMOUNT);
    }

    function test_Vesting_FutureStartYieldsZeroThenAccrues() public {
        uint256 id = _vesting(AMOUNT, _now() + 10 days, 0, HUNDRED, false);
        skip(10 days - 1);
        assertEq(vault.vestedAmount(id), 0);
        skip(1 + 10 days);
        assertEq(vault.vestedAmount(id), 100e6);
    }

    function test_Vesting_CliffGatesButDoesNotResetAccrual() public {
        uint256 id = _vesting(AMOUNT, _now(), 30 days, HUNDRED, false);
        skip(30 days - 1);
        assertEq(vault.vestedAmount(id), 0);
        assertEq(vault.releasable(id), 0);
        vm.prank(recipient);
        vm.expectRevert(abi.encodeWithSelector(PayoutVault.NothingToClaim.selector, id));
        vault.claim(id, dest);
        skip(1);
        assertEq(vault.vestedAmount(id), 300e6, "accrual counted from start, not cliff");
    }

    function test_Vesting_CliffEqualDurationUnlocksAllAtEnd() public {
        uint256 id = _vesting(AMOUNT, _now(), HUNDRED, HUNDRED, false);
        skip(HUNDRED - 1);
        assertEq(vault.vestedAmount(id), 0);
        skip(1);
        assertEq(vault.vestedAmount(id), AMOUNT);
    }

    // ---------- scheduled ----------
    function test_CreateScheduled_StoresPlan() public {
        vm.expectEmit(true, true, true, true, address(vault));
        emit PayoutVault.PlanCreated(
            1, PayoutVault.Kind.Scheduled, funder, recipient, AMOUNT, uint64(T0 + 2 hours), uint64(T0 + 2 hours), 0, 1, true, REF
        );
        uint256 id = _scheduled(AMOUNT, _now() + 2 hours, true);
        PayoutVault.Plan memory p = vault.getPlan(id);
        assertEq(uint256(p.kind), uint256(PayoutVault.Kind.Scheduled));
        assertEq(p.periods, 1);
        assertEq(p.duration, 0);
        assertEq(usdc.balanceOf(address(vault)), AMOUNT);
    }

    function test_Scheduled_SingleUnlock() public {
        uint256 id = _scheduled(AMOUNT, _now() + 1 days, false);
        skip(1 days - 1);
        assertEq(vault.vestedAmount(id), 0);
        skip(1);
        assertEq(vault.vestedAmount(id), AMOUNT);
        _claim(id);
        assertEq(usdc.balanceOf(dest), AMOUNT - _fee(AMOUNT));
        assertEq(vault.balanceOf(feeRecipient), _fee(AMOUNT));
        assertEq(vault.releasable(id), 0);
    }

    function test_Scheduled_ExactlyOneHourOk() public {
        _scheduled(AMOUNT, _now() + 1 hours, false);
        assertEq(vault.planCount(), 1);
    }

    function test_RevertCreateScheduled_Validation() public {
        vm.startPrank(funder);
        vm.expectRevert(
            abi.encodeWithSelector(PayoutVault.InvalidDeadline.selector, uint64(T0 + 1 hours - 1), T0 + 1 hours)
        );
        vault.createScheduled(recipient, AMOUNT, uint64(T0 + 1 hours - 1), false, REF);
        vm.expectRevert(abi.encodeWithSelector(PayoutVault.ZeroAddress.selector, bytes32("recipient")));
        vault.createScheduled(address(0), AMOUNT, uint64(T0 + 1 days), false, REF);
        vm.expectRevert(abi.encodeWithSelector(PayoutVault.InvalidRecipient.selector, funder));
        vault.createScheduled(funder, AMOUNT, uint64(T0 + 1 days), false, REF);
        vm.expectRevert(abi.encodeWithSelector(PayoutVault.ZeroAmount.selector, 0));
        vault.createScheduled(recipient, 0, uint64(T0 + 1 days), false, REF);
        vm.stopPrank();
    }

    // ---------- payroll ----------
    function test_CreatePayroll_StoresPlan() public {
        vm.expectEmit(true, true, true, true, address(vault));
        emit PayoutVault.PlanCreated(
            1, PayoutVault.Kind.Payroll, funder, recipient, AMOUNT, uint64(T0), uint64(T0), 90 days, 3, false, REF
        );
        uint256 id = _payroll(AMOUNT, _now(), 30 days, 3, false);
        PayoutVault.Plan memory p = vault.getPlan(id);
        assertEq(uint256(p.kind), uint256(PayoutVault.Kind.Payroll));
        assertEq(uint256(p.duration), 90 days);
        assertEq(p.periods, 3);
        assertEq(usdc.balanceOf(address(vault)), AMOUNT);
    }

    function test_Payroll_StepsWithRemainderInFinalStep() public {
        uint256 amount = 1_000_000_007;
        uint256 step = amount / 3;
        uint256 id = _payroll(amount, _now(), 30 days, 3, false);
        skip(30 days - 1);
        assertEq(vault.vestedAmount(id), 0, "first payment only after full period");
        skip(1);
        assertEq(vault.vestedAmount(id), step);
        skip(29 days);
        assertEq(vault.vestedAmount(id), step, "no accrual inside a period");
        skip(1 days);
        assertEq(vault.vestedAmount(id), 2 * step);
        skip(30 days - 1);
        assertEq(vault.vestedAmount(id), 2 * step);
        skip(1);
        assertEq(vault.vestedAmount(id), amount);
        assertEq(amount - 2 * step, step + (amount % 3), "final step carries the remainder");
    }

    function test_Payroll_MaxPeriodsAllowed() public {
        uint256 id = _payroll(520, _now(), 1 hours, 520, false);
        skip(1 hours);
        assertEq(vault.vestedAmount(id), 1);
    }

    function test_RevertCreatePayroll_Validation() public {
        vm.startPrank(funder);
        vm.expectRevert(abi.encodeWithSelector(PayoutVault.InvalidDuration.selector, uint64(1 hours - 1), 1 hours));
        vault.createPayroll(recipient, AMOUNT, _now(), 1 hours - 1, 3, false, REF);
        vm.expectRevert(abi.encodeWithSelector(PayoutVault.InvalidPeriods.selector, uint32(0), uint32(520), AMOUNT));
        vault.createPayroll(recipient, AMOUNT, _now(), 1 days, 0, false, REF);
        vm.expectRevert(abi.encodeWithSelector(PayoutVault.InvalidPeriods.selector, uint32(521), uint32(520), AMOUNT));
        vault.createPayroll(recipient, AMOUNT, _now(), 1 days, 521, false, REF);
        vm.expectRevert(abi.encodeWithSelector(PayoutVault.InvalidPeriods.selector, uint32(5), uint32(520), uint256(4)));
        vault.createPayroll(recipient, 4, _now(), 1 days, 5, false, REF);
        vm.expectRevert(abi.encodeWithSelector(PayoutVault.ZeroAddress.selector, bytes32("recipient")));
        vault.createPayroll(address(0), AMOUNT, _now(), 1 days, 3, false, REF);
        vm.expectRevert(abi.encodeWithSelector(PayoutVault.InvalidRecipient.selector, funder));
        vault.createPayroll(funder, AMOUNT, _now(), 1 days, 3, false, REF);
        vm.expectRevert(abi.encodeWithSelector(PayoutVault.PlanMustEndInFuture.selector, _now(), T0));
        vault.createPayroll(recipient, AMOUNT, _now() - 3 days, 1 days, 3, false, REF);
        vm.stopPrank();
    }

    // ---------- claim ----------
    function test_Claim_FeeMathAndAccounting() public {
        uint256 id = _vesting(AMOUNT, _now(), 0, HUNDRED, false);
        skip(25 days);
        uint256 gross = 250e6;
        uint256 fee = _fee(gross);
        vm.expectEmit(true, true, false, true, address(vault));
        emit PayoutVault.PlanClaimed(id, recipient, dest, gross, fee);
        _claim(id);
        assertEq(usdc.balanceOf(dest), gross - fee);
        assertEq(vault.balanceOf(feeRecipient), fee);
        assertEq(vault.getPlan(id).claimed, gross);
        assertEq(vault.releasable(id), 0);
        assertEq(usdc.balanceOf(address(vault)), AMOUNT - (gross - fee));
    }

    function test_Claim_IncrementalSumsToTotal() public {
        uint256 id = _vesting(AMOUNT, _now(), 0, HUNDRED, false);
        skip(10 days);
        _claim(id);
        skip(40 days);
        _claim(id);
        skip(60 days);
        _claim(id);
        assertEq(vault.getPlan(id).claimed, AMOUNT);
        assertEq(usdc.balanceOf(dest) + vault.balanceOf(feeRecipient), AMOUNT);
        assertEq(usdc.balanceOf(address(vault)), vault.balanceOf(feeRecipient));
        vm.prank(recipient);
        vm.expectRevert(abi.encodeWithSelector(PayoutVault.NothingToClaim.selector, id));
        vault.claim(id, dest);
    }

    function test_Claim_PayrollStepClaimsAreIncremental() public {
        uint256 amount = 1_000_000_007;
        uint256 id = _payroll(amount, _now(), 30 days, 3, false);
        skip(30 days);
        _claim(id);
        assertEq(vault.getPlan(id).claimed, amount / 3);
        skip(60 days);
        _claim(id);
        assertEq(vault.getPlan(id).claimed, amount);
    }

    function test_RevertClaim_NotRecipient() public {
        uint256 id = _vesting(AMOUNT, _now(), 0, HUNDRED, true);
        skip(HUNDRED);
        address[3] memory bad = [funder, stranger, dest];
        for (uint256 i; i < bad.length; ++i) {
            vm.prank(bad[i]);
            vm.expectRevert(abi.encodeWithSelector(PayoutVault.Unauthorized.selector, bad[i]));
            vault.claim(id, bad[i]);
        }
    }

    function test_RevertClaim_ZeroDestination() public {
        uint256 id = _vesting(AMOUNT, _now(), 0, HUNDRED, true);
        skip(HUNDRED);
        vm.prank(recipient);
        vm.expectRevert(abi.encodeWithSelector(PayoutVault.ZeroAddress.selector, bytes32("to")));
        vault.claim(id, address(0));
    }

    function test_RevertClaim_UnknownPlan() public {
        vm.prank(recipient);
        vm.expectRevert(abi.encodeWithSelector(PayoutVault.UnknownPlan.selector, 1));
        vault.claim(1, dest);
        vm.expectRevert(abi.encodeWithSelector(PayoutVault.UnknownPlan.selector, 0));
        vault.getPlan(0);
        vm.expectRevert(abi.encodeWithSelector(PayoutVault.UnknownPlan.selector, 2));
        vault.vestedAmount(2);
        vm.expectRevert(abi.encodeWithSelector(PayoutVault.UnknownPlan.selector, 2));
        vault.releasable(2);
    }

    function test_RevertClaim_NothingBeforeStart() public {
        uint256 id = _vesting(AMOUNT, _now() + 1 days, 0, HUNDRED, false);
        vm.prank(recipient);
        vm.expectRevert(abi.encodeWithSelector(PayoutVault.NothingToClaim.selector, id));
        vault.claim(id, dest);
    }

    function test_Claim_TinyGrossHasZeroFee() public {
        uint256 id = _scheduled(100, _now() + 1 hours, false);
        skip(1 hours);
        _claim(id);
        assertEq(usdc.balanceOf(dest), 100);
        assertEq(vault.balanceOf(feeRecipient), 0);
    }

    function test_Plans_IndependentIdsFromEscrows() public {
        _newEscrow(address(0), AMOUNT, 1 days, true);
        uint256 id = _scheduled(AMOUNT, _now() + 1 days, false);
        assertEq(id, 1);
        assertEq(vault.escrowCount(), 1);
        assertEq(vault.planCount(), 1);
    }
}
