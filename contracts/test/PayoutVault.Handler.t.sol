// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {PayoutVault} from "../PayoutVault.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";

/// @dev Invariant handler: bounded random actions across escrows, plans, withdrawals, time.
contract PayoutVaultHandler is Test {
    PayoutVault public vault;
    MockERC20 public usdc;
    address[] public actors; // last entry is the fee recipient

    bool public vestedViolation; // vested non-monotonic, > total, or claimed > vested
    mapping(uint256 => uint256) public lastVested;
    uint256 public ok; // successful state-changing calls (anti-vacuity)
    uint256 public okClaim;
    uint256 public okRevoke;
    uint256 public okResolve;

    constructor(PayoutVault v, MockERC20 t) {
        vault = v;
        usdc = t;
        for (uint256 i; i < 4; ++i) actors.push(makeAddr(string.concat("actor", vm.toString(i))));
        actors.push(v.feeRecipient());
        for (uint256 i; i < actors.length; ++i) {
            t.mint(actors[i], 1e15);
            vm.prank(actors[i]);
            t.approve(address(v), type(uint256).max);
        }
    }

    function actorCount() external view returns (uint256) {
        return actors.length;
    }

    function _a(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    // ---------- escrow ----------
    function createEscrow(uint256 a, uint256 b, uint256 amt, uint256 dl, bool rod, bool useArb) external {
        address arb = useArb ? _a(a + b + 1) : address(0);
        amt = bound(amt, 1, 1e9);
        dl = bound(dl, 1 hours, 30 days);
        vm.prank(_a(a));
        try vault.createEscrow(_a(b), arb, amt, uint64(block.timestamp + dl), rod, bytes32(0)) {
            ok++;
        } catch {}
        _track();
    }

    function release(uint256 idSeed, uint256 a) external {
        uint256 n = vault.escrowCount();
        if (n == 0) return;
        vm.prank(_a(a));
        try vault.release(bound(idSeed, 1, n)) {
            ok++;
            okResolve++;
        } catch {}
        _track();
    }

    function refund(uint256 idSeed, uint256 a) external {
        uint256 n = vault.escrowCount();
        if (n == 0) return;
        vm.prank(_a(a));
        try vault.refund(bound(idSeed, 1, n)) {
            ok++;
            okResolve++;
        } catch {}
        _track();
    }

    function settle(uint256 idSeed, uint256 a) external {
        uint256 n = vault.escrowCount();
        if (n == 0) return;
        vm.prank(_a(a));
        try vault.settleAfterDeadline(bound(idSeed, 1, n)) {
            ok++;
            okResolve++;
        } catch {}
        _track();
    }

    // ---------- plans ----------
    function createVesting(uint256 a, uint256 b, uint256 amt, uint256 off, uint256 cliff, uint256 dur, bool rev)
        external
    {
        amt = bound(amt, 1, 1e9);
        dur = bound(dur, 1 hours, 60 days);
        cliff = bound(cliff, 0, dur);
        off = bound(off, 0, 15 days); // start in [now-10d, now+5d]
        uint64 start = uint64(block.timestamp + off - 10 days);
        vm.prank(_a(a));
        try vault.createVesting(_a(b), amt, start, uint64(cliff), uint64(dur), rev, bytes32(0)) {
            ok++;
        } catch {}
        _track();
    }

    function createScheduled(uint256 a, uint256 b, uint256 amt, uint256 dl, bool rev) external {
        amt = bound(amt, 1, 1e9);
        dl = bound(dl, 1 hours, 30 days);
        vm.prank(_a(a));
        try vault.createScheduled(_a(b), amt, uint64(block.timestamp + dl), rev, bytes32(0)) {
            ok++;
        } catch {}
        _track();
    }

    function createPayroll(uint256 a, uint256 b, uint256 amt, uint256 off, uint256 periods, uint256 plen, bool rev)
        external
    {
        periods = bound(periods, 1, 20);
        amt = bound(amt, periods, 1e9);
        plen = bound(plen, 1 hours, 10 days);
        off = bound(off, 0, 15 days);
        uint64 start = uint64(block.timestamp + off - 10 days);
        vm.prank(_a(a));
        try vault.createPayroll(_a(b), amt, start, uint64(plen), uint32(periods), rev, bytes32(0)) {
            ok++;
        } catch {}
        _track();
    }

    function claim(uint256 idSeed, uint256 a, uint256 to) external {
        uint256 n = vault.planCount();
        if (n == 0) return;
        uint256 id = bound(idSeed, 1, n);
        // mostly use the true recipient so claims actually succeed
        address caller = a % 4 == 0 ? _a(a) : vault.getPlan(id).recipient;
        vm.prank(caller);
        try vault.claim(id, _a(to)) {
            ok++;
            okClaim++;
        } catch {}
        _track();
    }

    function revoke(uint256 idSeed, uint256 a) external {
        uint256 n = vault.planCount();
        if (n == 0) return;
        uint256 id = bound(idSeed, 1, n);
        address caller = a % 4 == 0 ? _a(a) : vault.getPlan(id).funder;
        vm.prank(caller);
        try vault.revoke(id) {
            ok++;
            okRevoke++;
        } catch {}
        _track();
    }

    function withdraw(uint256 a, uint256 to) external {
        vm.prank(_a(a));
        try vault.withdraw(_a(to)) {
            ok++;
        } catch {}
        _track();
    }

    function warp(uint256 dt) external {
        vm.warp(block.timestamp + bound(dt, 0, 20 days));
        _track();
    }

    function _track() internal {
        uint256 n = vault.planCount();
        for (uint256 id = 1; id <= n; ++id) {
            uint256 v = vault.vestedAmount(id);
            PayoutVault.Plan memory p = vault.getPlan(id);
            if (v > p.total || v < lastVested[id] || p.claimed > v) vestedViolation = true;
            lastVested[id] = v;
        }
    }
}
