// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console2} from "forge-std/Test.sol";
import {PayoutVault} from "../PayoutVault.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";
import {PayoutVaultHandler} from "./PayoutVault.Handler.t.sol";

/// forge-config: default.invariant.runs = 64
/// forge-config: default.invariant.depth = 200
contract PayoutVaultInvariantTest is Test {
    PayoutVault internal vault;
    MockERC20 internal usdc;
    PayoutVaultHandler internal handler;

    function setUp() public {
        vm.warp(1_700_000_000);
        usdc = new MockERC20("Mock USDC", "mUSDC", 6);
        vault = new PayoutVault(address(usdc), makeAddr("feeRecipient"));
        handler = new PayoutVaultHandler(vault, usdc);
        targetContract(address(handler));
    }

    /// @dev Sum of everything the vault owes: unresolved escrows, unpaid plan
    ///      entitlements (total - claimed, minus the unvested part refunded on
    ///      revoke), and all credited balances.
    function _liabilities() internal view returns (uint256 owed) {
        uint256 ne = vault.escrowCount();
        for (uint256 i = 1; i <= ne; ++i) {
            PayoutVault.Escrow memory e = vault.getEscrow(i);
            if (e.status == PayoutVault.Status.Funded) owed += e.amount;
        }
        uint256 np = vault.planCount();
        for (uint256 i = 1; i <= np; ++i) {
            PayoutVault.Plan memory p = vault.getPlan(i);
            // vestedAmount is frozen at revocation, so total - vested == refunded amount
            uint256 entitled = p.revokedAt == 0 ? p.total : vault.vestedAmount(i);
            owed += entitled - p.claimed;
        }
        uint256 na = handler.actorCount();
        for (uint256 i; i < na; ++i) owed += vault.balanceOf(handler.actors(i));
    }

    /// @notice Requested invariant: vault token balance covers every liability.
    function invariant_VaultCoversAllLiabilities() public view {
        assertGe(usdc.balanceOf(address(vault)), _liabilities());
    }

    /// @notice With no donations and exact-receipt funding, backing is exact.
    function invariant_VaultExactlyBacked() public view {
        assertEq(usdc.balanceOf(address(vault)), _liabilities());
    }

    /// @notice Vested is monotonic, <= total, and claimed <= vested (checked in handler after each call).
    function invariant_VestedMonotonicBoundedAndClaimedWithinVested() public view {
        assertFalse(handler.vestedViolation());
    }

    function invariant_ClaimedNeverExceedsTotal() public view {
        uint256 np = vault.planCount();
        for (uint256 i = 1; i <= np; ++i) {
            PayoutVault.Plan memory p = vault.getPlan(i);
            assertLe(p.claimed, p.total);
        }
    }

    /// @notice Every credited fee/payout is token-backed: token supply is conserved (no mint/burn in vault).
    function invariant_TokenSupplyConserved() public view {
        uint256 held = usdc.balanceOf(address(vault));
        uint256 na = handler.actorCount();
        for (uint256 i; i < na; ++i) held += usdc.balanceOf(handler.actors(i));
        assertEq(held, usdc.totalSupply());
    }

    function afterInvariant() public view {
        console2.log("successful calls", handler.ok());
        console2.log("claims", handler.okClaim());
        console2.log("revokes", handler.okRevoke());
        console2.log("resolutions", handler.okResolve());
        console2.log("escrows", vault.escrowCount());
        console2.log("plans", vault.planCount());
    }
}
