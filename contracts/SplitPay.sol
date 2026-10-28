// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title SplitPay
/// @notice Merchant-managed USDC splits with pull-based recipient and fee balances.
/// @dev Non-upgradeable, with no global owner, admin, pause, or recovery function.
///      Amounts use the token's native units (6 decimals for Arc Testnet USDC).
///      Intended token: 0x3600000000000000000000000000000000000000.
contract SplitPay is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 private constant BPS_DENOMINATOR = 10_000;
    uint256 private constant MAX_RECIPIENTS = 10;

    /// @notice The payment token, fixed at deployment.
    IERC20 public immutable usdc;
    /// @notice The address credited with payment fees, fixed at deployment.
    address public immutable feeRecipient;
    /// @notice Fixed protocol fee of 20 basis points (0.2%).
    uint16 public constant FEE_BPS = 20;
    /// @notice Number of splits created. Split IDs start at 1 and are never reused.
    uint256 public splitCount;

    struct Split {
        address owner;
        uint32 version;
        address[] recipients;
        uint16[] bps;
    }

    mapping(uint256 splitId => Split) private _splits;
    mapping(address account => uint256 amount) private _balances;

    error ZeroAddress();
    error InvalidRecipientCount(uint256 count);
    error ArrayLengthMismatch();
    error DuplicateRecipient(address recipient);
    error ZeroShare(uint256 index);
    error InvalidBpsTotal(uint256 total);
    error UnknownSplit(uint256 splitId);
    error SplitVersionMismatch(uint32 expected, uint32 actual);
    error NotSplitOwner(uint256 splitId, address caller);
    error ZeroAmount();
    error NoBalance();
    error UnexpectedReceivedAmount(uint256 expected, uint256 received);

    /// @notice Emitted when a merchant creates a split.
    event SplitCreated(
        uint256 indexed splitId,
        address indexed owner,
        uint32 version,
        address[] recipients,
        uint16[] bps
    );
    /// @notice Emitted when a merchant changes a split for future payments.
    event SplitUpdated(uint256 indexed splitId, uint32 version, address[] recipients, uint16[] bps);
    /// @notice Emitted after the full payment has been credited.
    /// @dev paymentReference is the caller's reference; `reference` is a reserved keyword.
    event PaymentReceived(
        uint256 indexed splitId,
        address indexed payer,
        uint32 version,
        uint256 amount,
        uint256 fee,
        bytes32 paymentReference
    );
    /// @notice Emitted when an account pulls its entire pending balance.
    event Withdrawn(address indexed account, address to, uint256 amount);

    /// @param usdc_ ERC-20 payment token; use Arc Testnet USDC for the intended deployment.
    /// @param feeRecipient_ Address that accrues fees and can withdraw them.
    constructor(address usdc_, address feeRecipient_) {
        if (usdc_ == address(0) || feeRecipient_ == address(0)) revert ZeroAddress();
        usdc = IERC20(usdc_);
        feeRecipient = feeRecipient_;
    }

    /// @notice Create a split owned permanently by the caller.
    /// @param recipients Between 1 and 10 distinct, nonzero recipient addresses.
    /// @param bps Positive shares in basis points, summing to exactly 10,000.
    /// @return splitId The newly created split's ID.
    function createSplit(address[] calldata recipients, uint16[] calldata bps)
        external
        nonReentrant
        returns (uint256 splitId)
    {
        _validateSplit(recipients, bps);
        splitId = ++splitCount;
        Split storage split = _splits[splitId];
        split.owner = msg.sender;
        split.version = 1;
        split.recipients = recipients;
        split.bps = bps;
        emit SplitCreated(splitId, msg.sender, split.version, recipients, bps);
    }

    /// @notice Change only future payment allocations; accrued balances are untouched.
    /// @param splitId An existing split owned by the caller.
    /// @param recipients The replacement recipient addresses.
    /// @param bps The replacement shares, summing to exactly 10,000.
    function updateSplit(uint256 splitId, address[] calldata recipients, uint16[] calldata bps)
        external
        nonReentrant
    {
        Split storage split = _requireSplit(splitId);
        if (split.owner != msg.sender) revert NotSplitOwner(splitId, msg.sender);
        _validateSplit(recipients, bps);
        ++split.version;
        split.recipients = recipients;
        split.bps = bps;
        emit SplitUpdated(splitId, split.version, recipients, bps);
    }

    /// @notice Pull approved USDC from the payer and credit fees and recipients.
    /// @dev No funds are pushed to recipients. Floor-rounded dust goes to recipient zero.
    ///      Exact receipt is enforced so underfunded transfers cannot create liabilities.
    /// @param splitId An existing split, regardless of who owns it.
    /// @param amount Positive payment amount in the token's smallest units.
    /// @param expectedVersion The split version the payer authorizes; must match the current version.
    /// @param paymentReference Arbitrary payer-supplied reference, recorded in the event.
    function pay(uint256 splitId, uint256 amount, uint32 expectedVersion, bytes32 paymentReference) external nonReentrant {
        Split storage split = _requireSplit(splitId);
        if (expectedVersion != split.version) revert SplitVersionMismatch(expectedVersion, split.version);
        if (amount == 0) revert ZeroAmount();

        uint256 balanceBefore = usdc.balanceOf(address(this));
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        uint256 balanceAfter = usdc.balanceOf(address(this));
        if (balanceAfter < balanceBefore) revert UnexpectedReceivedAmount(amount, 0);
        uint256 received = balanceAfter - balanceBefore;
        if (received != amount) revert UnexpectedReceivedAmount(amount, received);

        uint256 fee = Math.mulDiv(amount, FEE_BPS, BPS_DENOMINATOR);
        uint256 net = amount - fee;
        _balances[feeRecipient] += fee;

        uint256 distributed;
        uint256 length = split.recipients.length;
        for (uint256 i; i < length; ++i) {
            uint256 share = Math.mulDiv(net, split.bps[i], BPS_DENOMINATOR);
            _balances[split.recipients[i]] += share;
            distributed += share;
        }
        _balances[split.recipients[0]] += net - distributed;

        emit PaymentReceived(splitId, msg.sender, split.version, amount, fee, paymentReference);
    }

    /// @notice Withdraw the caller's full accrued balance to a chosen address.
    /// @dev Checks-effects-interactions and a shared reentrancy guard protect withdrawals.
    /// @param to Nonzero destination for the caller's tokens.
    function withdraw(address to) external nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        uint256 amount = _balances[msg.sender];
        if (amount == 0) revert NoBalance();
        _balances[msg.sender] = 0;
        usdc.safeTransfer(to, amount);
        emit Withdrawn(msg.sender, to, amount);
    }

    /// @notice Read a split's current configuration; unknown IDs revert.
    /// @param splitId An existing split ID.
    /// @return owner The split's permanent owner.
    /// @return version The current split version, starting at 1 and incremented on each update.
    /// @return recipients The current ordered recipient list.
    /// @return bps The corresponding current basis-point shares.
    function getSplit(uint256 splitId)
        external
        view
        returns (address owner, uint32 version, address[] memory recipients, uint16[] memory bps)
    {
        Split storage split = _requireSplit(splitId);
        return (split.owner, split.version, split.recipients, split.bps);
    }

    /// @notice Return an account's pending, withdrawable token balance, including any fees.
    /// @param account The account to query.
    /// @return The pending balance in token base units.
    function balanceOf(address account) external view returns (uint256) {
        return _balances[account];
    }

    /// @dev Validate recipient and share arrays before storing them.
    function _validateSplit(address[] calldata recipients, uint16[] calldata bps) private pure {
        uint256 length = recipients.length;
        if (length != bps.length) revert ArrayLengthMismatch();
        if (length == 0 || length > MAX_RECIPIENTS) revert InvalidRecipientCount(length);

        uint256 total;
        for (uint256 i; i < length; ++i) {
            address recipient = recipients[i];
            if (recipient == address(0)) revert ZeroAddress();
            if (bps[i] == 0) revert ZeroShare(i);
            for (uint256 j; j < i; ++j) {
                if (recipients[j] == recipient) revert DuplicateRecipient(recipient);
            }
            total += bps[i];
        }
        if (total != BPS_DENOMINATOR) revert InvalidBpsTotal(total);
    }

    /// @dev Return an existing split's storage reference, rejecting all unknown IDs.
    function _requireSplit(uint256 splitId) private view returns (Split storage split) {
        split = _splits[splitId];
        if (split.owner == address(0)) revert UnknownSplit(splitId);
    }
}
