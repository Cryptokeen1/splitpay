// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {PayoutVault} from "../PayoutVault.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";
import {PayoutVaultTestBase} from "./PayoutVault.Base.t.sol";

contract PayoutVaultFuzzTest is PayoutVaultTestBase {
    uint256 internal constant MAX_AMT = 1e24;

    function testFuzz_EscrowReleaseFee(uint256 amount) public {
        amount = bound(amount, 1, MAX_AMT);
        uint256 id = _newEscrow(address(0), amount, 1 days, false);
        vm.prank(payer);
        vault.release(id);
        uint256 fee = _fee(amount);
        assertEq(vault.balanceOf(feeRecipient), fee);
        assertEq(vault.balanceOf(seller), amount - fee);
        assertEq(vault.balanceOf(seller) + vault.balanceOf(feeRecipient), amount);
        assertLe(fee, amount);
    }

    function testFuzz_EscrowRefundHasNoFee(uint256 amount) public {
        amount = bound(amount, 1, MAX_AMT);
        uint256 id = _newEscrow(arbiter, amount, 1 days, true);
        vm.prank(arbiter);
        vault.refund(id);
        assertEq(vault.balanceOf(payer), amount);
        assertEq(vault.balanceOf(feeRecipient), 0);
    }

    function testFuzz_SettleFollowsFlag(uint256 amount, bool releaseOnDeadline, uint256 offset, uint256 late) public {
        amount = bound(amount, 1, MAX_AMT);
        offset = bound(offset, 1 hours, 365 days);
        late = bound(late, 0, 365 days);
        uint256 id = _newEscrow(arbiter, amount, offset, releaseOnDeadline);
        skip(offset + late);
        vm.prank(stranger);
        vault.settleAfterDeadline(id);
        if (releaseOnDeadline) {
            assertEq(vault.balanceOf(seller), amount - _fee(amount));
            assertEq(vault.balanceOf(feeRecipient), _fee(amount));
            assertEq(vault.balanceOf(payer), 0);
        } else {
            assertEq(vault.balanceOf(payer), amount);
            assertEq(vault.balanceOf(seller) + vault.balanceOf(feeRecipient), 0);
        }
    }

    function testFuzz_SettleBeforeDeadlineReverts(uint256 offset, uint256 early) public {
        offset = bound(offset, 1 hours, 365 days);
        early = bound(early, 1, offset);
        uint256 id = _newEscrow(arbiter, AMOUNT, offset, true);
        skip(offset - early);
        vm.expectRevert(
            abi.encodeWithSelector(PayoutVault.DeadlineNotReached.selector, uint64(T0 + offset), T0 + offset - early)
        );
        vault.settleAfterDeadline(id);
    }

    function testFuzz_VestingMatchesLinearFormula(uint256 amount, uint256 duration, uint256 elapsed) public {
        amount = bound(amount, 1, MAX_AMT);
        duration = bound(duration, 1 hours, 3650 days);
        elapsed = bound(elapsed, 0, duration * 2);
        uint256 id = _vesting(amount, _now(), 0, uint64(duration), false);
        skip(elapsed);
        uint256 expected = elapsed >= duration ? amount : (amount * elapsed) / duration;
        assertEq(vault.vestedAmount(id), expected);
        assertLe(vault.vestedAmount(id), amount);
    }

    function testFuzz_VestedMonotonicWithCliff(uint256 amount, uint256 duration, uint256 cliff, uint256 t1, uint256 t2)
        public
    {
        amount = bound(amount, 1, MAX_AMT);
        duration = bound(duration, 1 hours, 3650 days);
        cliff = bound(cliff, 0, duration);
        t1 = bound(t1, 0, duration * 2);
        t2 = bound(t2, t1, duration * 2);
        uint256 id = _vesting(amount, _now(), uint64(cliff), uint64(duration), false);
        skip(t1);
        uint256 v1 = vault.vestedAmount(id);
        if (t1 < cliff) assertEq(v1, 0);
        skip(t2 - t1);
        uint256 v2 = vault.vestedAmount(id);
        assertGe(v2, v1);
        assertLe(v2, amount);
        if (t2 >= duration) assertEq(v2, amount);
    }

    function testFuzz_PayrollSteps(uint256 amount, uint256 periods, uint256 period, uint256 k, uint256 extra) public {
        periods = bound(periods, 1, 520);
        amount = bound(amount, periods, MAX_AMT);
        period = bound(period, 1 hours, 60 days);
        k = bound(k, 0, periods + 3);
        extra = bound(extra, 0, period - 1);
        uint256 id = _payroll(amount, _now(), uint64(period), uint32(periods), false);
        skip(k * period + (k <= periods ? extra : 0));
        uint256 expected = k >= periods ? amount : (amount / periods) * k;
        uint256 v = vault.vestedAmount(id);
        if (k == periods && extra != 0) expected = amount;
        assertEq(v, expected);
        assertLe(v, amount);
    }

    function testFuzz_PayrollFinalStepCarriesRemainder(uint256 amount, uint256 periods) public {
        periods = bound(periods, 2, 520);
        amount = bound(amount, periods, MAX_AMT);
        uint256 id = _payroll(amount, _now(), 1 hours, uint32(periods), false);
        skip((periods - 1) * 1 hours);
        uint256 beforeFinal = vault.vestedAmount(id);
        assertEq(beforeFinal, (amount / periods) * (periods - 1));
        skip(1 hours);
        assertEq(vault.vestedAmount(id), amount);
        assertEq(amount - beforeFinal, amount / periods + (amount % periods));
    }

    function testFuzz_PayrollMonotonic(uint256 amount, uint256 periods, uint256 t1, uint256 t2) public {
        periods = bound(periods, 1, 100);
        amount = bound(amount, periods, MAX_AMT);
        uint256 total = periods * 1 days;
        t1 = bound(t1, 0, total + 10 days);
        t2 = bound(t2, t1, total + 10 days);
        uint256 id = _payroll(amount, _now(), 1 days, uint32(periods), false);
        skip(t1);
        uint256 v1 = vault.vestedAmount(id);
        skip(t2 - t1);
        uint256 v2 = vault.vestedAmount(id);
        assertGe(v2, v1);
        assertLe(v2, amount);
    }

    function testFuzz_ClaimFeeMath(uint256 amount, uint256 duration, uint256 elapsed) public {
        amount = bound(amount, 1, MAX_AMT);
        duration = bound(duration, 1 hours, 3650 days);
        elapsed = bound(elapsed, 1, duration * 2);
        uint256 id = _vesting(amount, _now(), 0, uint64(duration), false);
        skip(elapsed);
        uint256 gross = vault.releasable(id);
        if (gross == 0) {
            vm.prank(recipient);
            vm.expectRevert(abi.encodeWithSelector(PayoutVault.NothingToClaim.selector, id));
            vault.claim(id, dest);
            return;
        }
        uint256 fee = _fee(gross);
        _claim(id);
        assertEq(usdc.balanceOf(dest), gross - fee);
        assertEq(vault.balanceOf(feeRecipient), fee);
        assertEq(vault.getPlan(id).claimed, gross);
        assertEq(usdc.balanceOf(address(vault)), amount - gross + fee);
        assertEq(vault.releasable(id), 0);
    }

    function testFuzz_TwoClaimsSumToTotal(uint256 amount, uint256 duration, uint256 t1) public {
        amount = bound(amount, 1, MAX_AMT);
        duration = bound(duration, 1 hours, 3650 days);
        t1 = bound(t1, 0, duration - 1);
        uint256 id = _vesting(amount, _now(), 0, uint64(duration), false);
        skip(t1);
        if (vault.releasable(id) != 0) _claim(id);
        skip(duration);
        _claim(id);
        PayoutVault.Plan memory p = vault.getPlan(id);
        assertEq(p.claimed, amount);
        assertEq(usdc.balanceOf(dest) + vault.balanceOf(feeRecipient), amount);
    }

    function testFuzz_RevokeSplit(uint256 amount, uint256 duration, uint256 elapsed, uint256 later) public {
        amount = bound(amount, 1, MAX_AMT);
        duration = bound(duration, 1 hours, 3650 days);
        elapsed = bound(elapsed, 0, duration * 2);
        later = bound(later, 0, 3650 days);
        uint256 id = _vesting(amount, _now(), 0, uint64(duration), true);
        skip(elapsed);
        uint256 vestedNow = vault.vestedAmount(id);
        vm.prank(funder);
        vault.revoke(id);
        assertEq(vault.balanceOf(funder), amount - vestedNow);
        assertEq(vault.balanceOf(feeRecipient), 0);
        skip(later);
        assertEq(vault.vestedAmount(id), vestedNow);
        if (vestedNow != 0) {
            _claim(id);
            assertEq(usdc.balanceOf(dest) + vault.balanceOf(feeRecipient), vestedNow);
        }
        // everything the vault holds is accounted for by credited balances
        assertEq(usdc.balanceOf(address(vault)), vault.balanceOf(funder) + vault.balanceOf(feeRecipient));
    }

    function testFuzz_FeeOnTransferAlwaysRejected(uint256 amount, uint256 bps) public {
        amount = bound(amount, 10_000, MAX_AMT); // large enough that burn is nonzero
        bps = bound(bps, 1, 9_999);
        MockERC20 fot = new MockERC20("FoT", "FOT", 6);
        fot.setBurnBps(bps);
        PayoutVault v = new PayoutVault(address(fot), feeRecipient);
        fot.mint(funder, amount);
        vm.startPrank(funder);
        fot.approve(address(v), amount);
        vm.expectRevert(
            abi.encodeWithSelector(PayoutVault.UnexpectedReceivedAmount.selector, amount, amount - (amount * bps) / 10_000)
        );
        v.createEscrow(seller, address(0), amount, uint64(T0 + 1 days), true, REF);
        vm.stopPrank();
    }
}
