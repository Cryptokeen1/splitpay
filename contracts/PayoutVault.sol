// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

/// @title PayoutVault
/// @notice Immutable USDC escrow, vesting, scheduled payments and stepped payroll.
/// @dev No owner, proxy, pause or recovery mechanism. Amounts are token base units
///      (6 decimals for Arc Testnet USDC at 0x3600000000000000000000000000000000000000).
///      Exact-receipt funding backs all unresolved escrows, unpaid plan entitlements
///      and credited balances. Only recipient payouts incur fees. Assumes standard,
///      non-rebasing USDC transfer behavior; arbitrary token mutations are not supported.
/// @dev The USDC issuer could blocklist this contract's address, freezing all claims
///      and withdrawals for every user. No function in this contract can work around that.
/// @custom:upgrade-strategy Immutable. No proxy, owner or admin; a new version must be a new deployment.
contract PayoutVault is ReentrancyGuard {
    using SafeERC20 for IERC20;
    using SafeCast for uint256;

    uint256 private constant BPS_DENOMINATOR = 10_000;
    uint256 private constant MIN_DURATION = 1 hours;

    /// @notice Fixed payout fee in basis points (0.2%), rounded down per payout.
    uint16 public constant FEE_BPS = 20;
    /// @notice Payment token, permanently selected by the constructor.
    IERC20 public immutable usdc;
    /// @notice Address credited with payout fees, permanently selected at deployment.
    address public immutable feeRecipient;
    /// @notice Number of escrows created; IDs begin at 1.
    uint256 public escrowCount;
    /// @notice Number of plans created; IDs begin at 1 independently of escrows.
    uint256 public planCount;

    enum Status { None, Funded, Released, Refunded }
    enum Kind { Vesting, Scheduled, Payroll }

    struct Escrow {
        address payer;
        address seller;
        address arbiter;
        uint256 amount;
        uint64 deadline;
        bool releaseOnDeadline;
        Status status;
    }

    /// @dev total and claimed are gross amounts. Payroll duration is the total
    ///      duration (periodLength * periods); cliff is an absolute timestamp.
    struct Plan {
        Kind kind;
        address funder;
        address recipient;
        uint256 total;
        uint256 claimed;
        uint64 start;
        uint64 cliff;
        uint64 duration;
        uint32 periods;
        bool revocable;
        uint64 revokedAt;
    }

    mapping(uint256 id => Escrow) private _escrows;
    mapping(uint256 id => Plan) private _plans;
    mapping(address account => uint256 amount) private _balances;

    error ZeroAddress(bytes32 parameter);
    error InvalidRecipient(address recipient);
    error InvalidArbiter(address arbiter);
    error ZeroAmount(uint256 supplied);
    error InvalidDeadline(uint64 supplied, uint256 minimum);
    error InvalidDuration(uint64 supplied, uint256 minimum);
    error InvalidCliff(uint64 supplied, uint64 maximum);
    error InvalidPeriods(uint32 supplied, uint32 maximum, uint256 amount);
    error PlanMustEndInFuture(uint64 end, uint256 currentTimestamp);
    error UnknownEscrow(uint256 id);
    error UnknownPlan(uint256 id);
    error EscrowNotFunded(uint256 id);
    error Unauthorized(address caller);
    error DeadlineNotReached(uint64 deadline, uint256 currentTimestamp);
    error NotRevocable(uint256 id);
    error AlreadyRevoked(uint256 id, uint64 revokedAt);
    error NothingToClaim(uint256 id);
    error NoBalance(address account);
    error UnexpectedReceivedAmount(uint256 expected, uint256 received);

    /// @notice A payer has funded an escrow with an optional arbiter.
    event EscrowCreated(
        uint256 indexed id, address indexed payer, address indexed seller,
        address arbiter, uint256 amount, uint64 deadline, bool releaseOnDeadline,
        bytes32 paymentReference
    );
    /// @notice Gross escrow amount resolved to seller and fee balances.
    event EscrowReleased(uint256 indexed id, address indexed seller, uint256 amount, uint256 fee, address by);
    /// @notice Full escrow amount credited to the payer, without a fee.
    event EscrowRefunded(uint256 indexed id, address indexed payer, uint256 amount, address by);
    /// @notice A fully funded plan was created; reference is an arbitrary caller memo.
    event PlanCreated(
        uint256 indexed id, Kind kind, address indexed funder, address indexed recipient,
        uint256 total, uint64 start, uint64 cliff, uint64 duration, uint32 periods,
        bool revocable, bytes32 paymentReference
    );
    /// @notice Gross entitlement claimed; gross minus fee was transferred to to.
    event PlanClaimed(uint256 indexed id, address indexed recipient, address to, uint256 gross, uint256 fee);
    /// @notice Vesting frozen and unvested funds credited back without a fee.
    event PlanRevoked(uint256 indexed id, address indexed funder, uint256 refunded, uint256 vestedAtRevocation);
    /// @notice An account withdrew its entire credited balance.
    event Withdrawn(address indexed account, address to, uint256 amount);

    /// @param usdc_ ERC-20 token; intended to be Arc Testnet USDC.
    /// @param feeRecipient_ Nonzero address entitled to withdraw credited fees.
    constructor(address usdc_, address feeRecipient_) {
        if (usdc_ == address(0) || feeRecipient_ == address(0)) revert ZeroAddress(usdc_ == address(0) ? bytes32("usdc_") : bytes32("feeRecipient_"));
        usdc = IERC20(usdc_);
        feeRecipient = feeRecipient_;
    }

    /// @notice Fund a conditional escrow; the payer is msg.sender.
    /// @dev The deadline must be at least one hour away. An arbiter is optional,
    ///      but cannot be either party. No fee is charged at creation.
    /// @param paymentReference Arbitrary memo emitted with creation.
    /// @return id Newly assigned escrow ID.
    function createEscrow(
        address seller, address arbiter, uint256 amount, uint64 deadline,
        bool releaseOnDeadline, bytes32 paymentReference
    ) external nonReentrant returns (uint256 id) {
        _validateFunding(seller, amount);
        if (arbiter != address(0) && (arbiter == msg.sender || arbiter == seller)) revert InvalidArbiter(arbiter);
        if (uint256(deadline) < block.timestamp + MIN_DURATION) revert InvalidDeadline(deadline, block.timestamp + MIN_DURATION);
        _pullExact(amount);
        id = ++escrowCount;
        _escrows[id] = Escrow({
            payer: msg.sender, seller: seller, arbiter: arbiter, amount: amount,
            deadline: deadline, releaseOnDeadline: releaseOnDeadline, status: Status.Funded
        });
        emit EscrowCreated(id, msg.sender, seller, arbiter, amount, deadline, releaseOnDeadline, paymentReference);
    }

    /// @notice Payer or designated arbiter may release a funded escrow.
    /// @dev Release authority remains available after the deadline until resolution.
    function release(uint256 id) external nonReentrant {
        Escrow storage escrow = _fundedEscrow(id);
        if (msg.sender != escrow.payer && msg.sender != escrow.arbiter) revert Unauthorized(msg.sender);
        _releaseEscrow(id, escrow);
    }

    /// @notice Seller or designated arbiter may refund a funded escrow in full.
    function refund(uint256 id) external nonReentrant {
        Escrow storage escrow = _fundedEscrow(id);
        if (msg.sender != escrow.seller && msg.sender != escrow.arbiter) revert Unauthorized(msg.sender);
        _refundEscrow(id, escrow);
    }

    /// @notice Anyone can apply the pre-agreed outcome at or after the deadline.
    function settleAfterDeadline(uint256 id) external nonReentrant {
        Escrow storage escrow = _fundedEscrow(id);
        if (block.timestamp < escrow.deadline) revert DeadlineNotReached(escrow.deadline, block.timestamp);
        if (escrow.releaseOnDeadline) _releaseEscrow(id, escrow);
        else _refundEscrow(id, escrow);
    }

    /// @notice Fund continuous linear vesting, optionally subject to revocation.
    /// @dev A cliff gates claims but does not reset linear accrual. Starts may be
    ///      in the past, provided the end remains strictly in the future.
    /// @param cliffDuration Offset from start; zero means no cliff.
    /// @param paymentReference Arbitrary memo emitted with creation.
    /// @return id Newly assigned plan ID.
    function createVesting(
        address recipient, uint256 amount, uint64 start, uint64 cliffDuration,
        uint64 duration, bool revocable, bytes32 paymentReference
    ) external nonReentrant returns (uint256 id) {
        if (duration < MIN_DURATION) revert InvalidDuration(duration, MIN_DURATION);
        if (cliffDuration > duration) revert InvalidCliff(cliffDuration, duration);
        Plan memory plan;
        plan.kind = Kind.Vesting;
        plan.funder = msg.sender;
        plan.recipient = recipient;
        plan.total = amount;
        plan.start = start;
        plan.cliff = (uint256(start) + cliffDuration).toUint64();
        plan.duration = duration;
        plan.revocable = revocable;
        return _createPlan(plan, paymentReference);
    }

    /// @notice Fund an all-or-nothing payment unlocking at least one hour from now.
    /// @param paymentReference Arbitrary memo emitted with creation.
    /// @return id Newly assigned plan ID.
    function createScheduled(
        address recipient, uint256 amount, uint64 unlockTime,
        bool revocable, bytes32 paymentReference
    ) external nonReentrant returns (uint256 id) {
        if (uint256(unlockTime) < block.timestamp + MIN_DURATION) revert InvalidDeadline(unlockTime, block.timestamp + MIN_DURATION);
        Plan memory plan;
        plan.kind = Kind.Scheduled;
        plan.funder = msg.sender;
        plan.recipient = recipient;
        plan.total = amount;
        plan.start = unlockTime;
        plan.cliff = unlockTime;
        plan.periods = 1;
        plan.revocable = revocable;
        return _createPlan(plan, paymentReference);
    }

    /// @notice Fund equal payroll steps; first payment vests after one full period.
    /// @dev Every nonfinal step is floor(amount / periods); the final step includes
    ///      all division remainder. Past starts are permitted if the end is future.
    /// @param paymentReference Arbitrary memo emitted with creation.
    /// @return id Newly assigned plan ID.
    function createPayroll(
        address recipient, uint256 amount, uint64 start, uint64 periodLength,
        uint32 periods, bool revocable, bytes32 paymentReference
    ) external nonReentrant returns (uint256 id) {
        if (periodLength < MIN_DURATION) revert InvalidDuration(periodLength, MIN_DURATION);
        if (periods == 0 || periods > 520 || amount < periods) revert InvalidPeriods(periods, 520, amount);
        Plan memory plan;
        plan.kind = Kind.Payroll;
        plan.funder = msg.sender;
        plan.recipient = recipient;
        plan.total = amount;
        plan.start = start;
        plan.cliff = start;
        plan.duration = (uint256(periodLength) * periods).toUint64();
        plan.periods = periods;
        plan.revocable = revocable;
        return _createPlan(plan, paymentReference);
    }

    /// @notice Recipient claims all currently releasable gross entitlement.
    /// @dev Net tokens go directly to to; only the fee is credited for withdrawal.
    ///      Claimed gross and the fee balance are updated before the token transfer.
    /// @param to Nonzero destination chosen exclusively by the recipient.
    function claim(uint256 id, address to) external nonReentrant {
        Plan storage plan = _requirePlan(id);
        if (msg.sender != plan.recipient) revert Unauthorized(msg.sender);
        if (to == address(0)) revert ZeroAddress("to");
        uint256 gross = _vested(plan, _effectiveTime(plan)) - plan.claimed;
        if (gross == 0) revert NothingToClaim(id);
        uint256 fee = _fee(gross);
        plan.claimed += gross;
        _balances[feeRecipient] += fee;
        emit PlanClaimed(id, plan.recipient, to, gross, fee);
        usdc.safeTransfer(to, gross - fee);
    }

    /// @notice Funder freezes a revocable plan and recovers only its unvested funds.
    /// @dev Already vested entitlement remains claimable by the recipient forever.
    function revoke(uint256 id) external nonReentrant {
        Plan storage plan = _requirePlan(id);
        if (msg.sender != plan.funder) revert Unauthorized(msg.sender);
        if (!plan.revocable) revert NotRevocable(id);
        if (plan.revokedAt != 0) revert AlreadyRevoked(id, plan.revokedAt);
        plan.revokedAt = block.timestamp.toUint64();
        uint256 vested = _vested(plan, plan.revokedAt);
        uint256 unvested = plan.total - vested;
        _balances[plan.funder] += unvested;
        emit PlanRevoked(id, plan.funder, unvested, vested);
    }

    /// @notice Withdraw the caller's full credited balance to a nonzero destination.
    /// @dev No additional fee. CEI and the shared guard protect all withdrawals.
    function withdraw(address to) external nonReentrant {
        if (to == address(0)) revert ZeroAddress("to");
        uint256 amount = _balances[msg.sender];
        if (amount == 0) revert NoBalance(msg.sender);
        _balances[msg.sender] = 0;
        emit Withdrawn(msg.sender, to, amount);
        usdc.safeTransfer(to, amount);
    }

    /// @notice Pending credits, including fees, escrow proceeds and refunds.
    function balanceOf(address account) external view returns (uint256) {
        return _balances[account];
    }

    /// @notice Full configuration and resolution state; unknown IDs revert.
    function getEscrow(uint256 id) external view returns (Escrow memory) {
        return _requireEscrow(id);
    }

    /// @notice Full plan configuration and gross claim state; unknown IDs revert.
    function getPlan(uint256 id) external view returns (Plan memory) {
        return _requirePlan(id);
    }

    /// @notice Gross vested amount, permanently frozen at revocation if revoked.
    function vestedAmount(uint256 id) external view returns (uint256) {
        Plan storage plan = _requirePlan(id);
        return _vested(plan, _effectiveTime(plan));
    }

    /// @notice Gross vested entitlement not yet claimed; unknown IDs revert.
    function releasable(uint256 id) external view returns (uint256) {
        Plan storage plan = _requirePlan(id);
        return _vested(plan, _effectiveTime(plan)) - plan.claimed;
    }

    /// @dev All creation paths validate parties and exact funding before storing.
    function _createPlan(Plan memory plan, bytes32 paymentReference) private returns (uint256 id) {
        _validateFunding(plan.recipient, plan.total);
        uint64 end = (uint256(plan.start) + plan.duration).toUint64();
        if (uint256(end) <= block.timestamp) revert PlanMustEndInFuture(end, block.timestamp);
        _pullExact(plan.total);
        id = ++planCount;
        _plans[id] = plan;
        _emitPlanCreated(id, plan, paymentReference);
    }

    /// @dev Separate emission keeps the full creation payload together.
    function _emitPlanCreated(uint256 id, Plan memory plan, bytes32 paymentReference) private {
        emit PlanCreated(
            id, plan.kind, plan.funder, plan.recipient, plan.total, plan.start,
            plan.cliff, plan.duration, plan.periods, plan.revocable, paymentReference
        );
    }

    /// @dev Continuous ratios use full-precision multiplication and floor rounding.
    ///      Payroll uses equal floor-rounded steps, with remainder only at the end.
    function _vested(Plan storage plan, uint256 timestamp) private view returns (uint256) {
        if (timestamp < plan.cliff || timestamp < plan.start) return 0;
        if (plan.kind == Kind.Scheduled) return plan.total;
        uint256 elapsed = timestamp - plan.start;
        if (elapsed >= plan.duration) return plan.total;
        if (plan.kind == Kind.Vesting) {
            return Math.mulDiv(plan.total, elapsed, plan.duration);
        }
        uint256 periodLength = uint256(plan.duration) / plan.periods;
        uint256 vestedSteps = elapsed / periodLength;
        return Math.mulDiv(plan.total, 1, plan.periods) * vestedSteps;
    }

    /// @dev Avoid narrowing the current timestamp in views; only stored times narrow.
    function _effectiveTime(Plan storage plan) private view returns (uint256) {
        return plan.revokedAt == 0 ? block.timestamp : uint256(plan.revokedAt);
    }

    /// @dev Resolution changes status once and reclassifies liabilities, moving no tokens.
    function _releaseEscrow(uint256 id, Escrow storage escrow) private {
        escrow.status = Status.Released;
        uint256 fee = _fee(escrow.amount);
        _balances[escrow.seller] += escrow.amount - fee;
        _balances[feeRecipient] += fee;
        emit EscrowReleased(id, escrow.seller, escrow.amount, fee, msg.sender);
    }

    /// @dev A refund never incurs a payout fee.
    function _refundEscrow(uint256 id, Escrow storage escrow) private {
        escrow.status = Status.Refunded;
        _balances[escrow.payer] += escrow.amount;
        emit EscrowRefunded(id, escrow.payer, escrow.amount, msg.sender);
    }

    function _fee(uint256 gross) private pure returns (uint256) {
        return Math.mulDiv(gross, FEE_BPS, BPS_DENOMINATOR);
    }

    function _validateFunding(address recipient, uint256 amount) private view {
        if (recipient == address(0)) revert ZeroAddress("recipient");
        if (recipient == msg.sender) revert InvalidRecipient(recipient);
        if (amount == 0) revert ZeroAmount(amount);
    }

    /// @dev Reject short receipts, excess receipts and decreasing vault balances.
    function _pullExact(uint256 amount) private {
        uint256 beforeBalance = usdc.balanceOf(address(this));
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        uint256 afterBalance = usdc.balanceOf(address(this));
        if (afterBalance < beforeBalance) revert UnexpectedReceivedAmount(amount, 0);
        uint256 received = afterBalance - beforeBalance;
        if (received != amount) revert UnexpectedReceivedAmount(amount, received);
    }

    function _requireEscrow(uint256 id) private view returns (Escrow storage escrow) {
        escrow = _escrows[id];
        if (escrow.status == Status.None) revert UnknownEscrow(id);
    }

    function _fundedEscrow(uint256 id) private view returns (Escrow storage escrow) {
        escrow = _requireEscrow(id);
        if (escrow.status != Status.Funded) revert EscrowNotFunded(id);
    }

    function _requirePlan(uint256 id) private view returns (Plan storage plan) {
        plan = _plans[id];
        if (plan.funder == address(0)) revert UnknownPlan(id);
    }
}
