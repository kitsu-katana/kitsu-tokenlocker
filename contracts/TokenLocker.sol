// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title TokenLocker
 * @dev A smart contract for locking ERC20 tokens with time-based release mechanisms.
 * 
 * This contract allows users to lock their ERC20 tokens for a specified period of time.
 * Tokens can only be withdrawn after the unlock date has passed. Users can also transfer
 * their lock ownership to another address.
 * 
 * Features:
 * - Lock tokens with custom unlock dates
 * - Withdraw tokens after unlock date
 * - Transfer lock ownership
 * - Query locks by user or token
 * - Get total locked amounts
 * - View active (non-withdrawn, non-expired) locks
 * - Fee mechanism for locking tokens
 * 
 * @author jscrui | https://github.com/jscrui
 * @notice This contract implements a time-locked token system
 * @custom:security-contact security@kitsunine.io
 */
contract TokenLocker is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    /// @notice The next available lock ID
    uint256 public nextLockId;

    /// @notice Fee required to lock tokens (in wei)
    uint256 public lockFee;

    /**
     * @dev Structure representing a token lock
     * @param id Unique identifier for the lock
     * @param token Address of the locked ERC20 token
     * @param owner Address of the lock owner
     * @param amount Amount of tokens locked
     * @param unlockDate Timestamp when tokens can be withdrawn
     * @param withdrawn Whether the tokens have been withdrawn
     */
    struct TokenLock {
        uint256 id;
        address token;
        address owner;
        uint256 amount;
        uint256 unlockDate;
        bool withdrawn;
    }

    /// @notice Mapping from lock ID to TokenLock struct
    mapping(uint256 => TokenLock) public locks;
    
    /// @notice Mapping from user address to array of their lock IDs
    mapping(address => uint256[]) public userLockIds;
    
    /// @notice Mapping from token address to array of lock IDs for that token
    mapping(address => uint256[]) public tokenLockIds;

    /**
     * @dev Emitted when tokens are locked
     * @param lockId The unique identifier of the lock
     * @param user The address of the user who locked the tokens
     * @param token The address of the locked token
     * @param amount The amount of tokens locked
     * @param unlockDate The timestamp when tokens can be withdrawn
     * @param fee The fee paid for the lock
     */
    event TokenLocked(uint256 indexed lockId, address indexed user, address indexed token, uint256 amount, uint256 unlockDate, uint256 fee);
    
    /**
     * @dev Emitted when tokens are withdrawn
     * @param lockId The unique identifier of the lock
     * @param user The address of the user who withdrew the tokens
     */
    event TokenWithdrawn(uint256 indexed lockId, address indexed user);
    
    /**
     * @dev Emitted when a lock is transferred to a new owner
     * @param lockId The unique identifier of the lock
     * @param from The previous owner address
     * @param to The new owner address
     */
    event LockTransferred(uint256 indexed lockId, address indexed from, address indexed to);

    /**
     * @dev Emitted when the lock fee is updated
     * @param oldFee The previous fee amount
     * @param newFee The new fee amount
     */
    event LockFeeUpdated(uint256 oldFee, uint256 newFee);

    /**
     * @dev Emitted when fees are withdrawn by the owner
     * @param amount The amount of ETH withdrawn
     * @param recipient The address that received the fees
     */
    event FeesWithdrawn(uint256 amount, address recipient);

    /**
     * @dev Constructor sets the initial lock fee to 0.0025 ETH
     */
    constructor() Ownable(msg.sender) {
        lockFee = 0.0025 ether; // 0.0025 ETH in wei
    }

    /**
     * @dev Locks tokens for a specified period of time
     * @param token The address of the ERC20 token to lock
     * @param amount The amount of tokens to lock
     * @param unlockDate The timestamp when tokens can be withdrawn
     * 
     * Requirements:
     * - `unlockDate` must be in the future
     * - `amount` must be greater than 0
     * - Caller must have approved this contract to spend the tokens
     * - Caller must send the required fee in ETH
     * 
     * @notice This function transfers tokens from the caller to this contract
     */
    function lockTokens(address token, uint256 amount, uint256 unlockDate) external payable nonReentrant {
        require(unlockDate > block.timestamp, "KITSU_TOKENLOCKER: Unlock date must be in the future");
        require(amount > 0, "KITSU_TOKENLOCKER: Amount must be > 0");
        require(msg.value == lockFee, "KITSU_TOKENLOCKER: Incorrect fee amount");

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        TokenLock memory newLock = TokenLock({
            id: nextLockId,
            token: token,
            owner: msg.sender,
            amount: amount,
            unlockDate: unlockDate,
            withdrawn: false
        });

        locks[nextLockId] = newLock;
        userLockIds[msg.sender].push(nextLockId);
        tokenLockIds[token].push(nextLockId);

        emit TokenLocked(nextLockId, msg.sender, token, amount, unlockDate, lockFee);
        nextLockId++;
    }

    /**
     * @dev Withdraws tokens from a lock after the unlock date has passed
     * @param lockId The unique identifier of the lock to withdraw from
     * 
     * Requirements:
     * - Caller must be the owner of the lock
     * - Lock must not have been already withdrawn
     * - Current timestamp must be >= unlock date
     * 
     * @notice This function transfers tokens from this contract to the lock owner
     */
    function withdraw(uint256 lockId) external nonReentrant {
        TokenLock storage lock = locks[lockId];
        require(lock.owner == msg.sender, "KITSU_TOKENLOCKER: Not owner");
        require(!lock.withdrawn, "KITSU_TOKENLOCKER: Already withdrawn");
        require(block.timestamp >= lock.unlockDate, "KITSU_TOKENLOCKER: Still locked");

        lock.withdrawn = true;
        
        IERC20(lock.token).safeTransfer(msg.sender, lock.amount);

        emit TokenWithdrawn(lockId, msg.sender);
    }

    /**
     * @dev Transfers ownership of a lock to a new address
     * @param lockId The unique identifier of the lock to transfer
     * @param newOwner The address to transfer ownership to
     * 
     * Requirements:
     * - `newOwner` must not be the zero address
     * - Caller must be the current owner of the lock
     * - Lock must not have been already withdrawn
     * 
     * @notice This function only transfers ownership, not the actual tokens
     */
    function transferLock(uint256 lockId, address newOwner) external {
        require(newOwner != address(0), "KITSU_TOKENLOCKER: Zero address not allowed");
        TokenLock storage lock = locks[lockId];
        require(lock.owner == msg.sender, "KITSU_TOKENLOCKER: Not owner");
        require(!lock.withdrawn, "KITSU_TOKENLOCKER: Already withdrawn");

        address previousOwner = lock.owner;
        lock.owner = newOwner;
        
        // Remove lockId from previous owner's array
        uint256[] storage previousOwnerLocks = userLockIds[previousOwner];
        for (uint256 i = 0; i < previousOwnerLocks.length; i++) {
            if (previousOwnerLocks[i] == lockId) {
                // Replace with the last element and pop
                previousOwnerLocks[i] = previousOwnerLocks[previousOwnerLocks.length - 1];
                previousOwnerLocks.pop();
                break;
            }
        }
        
        // Add lockId to new owner's array
        userLockIds[newOwner].push(lockId);

        emit LockTransferred(lockId, previousOwner, newOwner);
    }

    /**
     * @dev Returns all lock IDs for a specific user
     * @param user The address of the user
     * @return Array of lock IDs owned by the user
     */
    function getUserLocks(address user) external view returns (uint256[] memory) {
        return userLockIds[user];
    }

    /**
     * @dev Returns all lock IDs for a specific token
     * @param token The address of the token
     * @return Array of lock IDs for the specified token
     */
    function getTokenLocks(address token) external view returns (uint256[] memory) {
        return tokenLockIds[token];
    }

    /**
     * @dev Returns the complete TokenLock struct for a specific lock ID
     * @param lockId The unique identifier of the lock
     * @return The TokenLock struct containing all lock information
     */
    function getLock(uint256 lockId) external view returns (TokenLock memory) {
        return locks[lockId];
    }

    /**
     * @dev Returns the total amount of tokens locked by a user for a specific token
     * @param user The address of the user
     * @param token The address of the token
     * @return total The total amount of tokens locked (excluding withdrawn locks)
     */
    function getLockedAmount(address user, address token) external view returns (uint256 total) {
        uint256[] memory ids = userLockIds[user];
        for (uint i = 0; i < ids.length; i++) {
            TokenLock storage l = locks[ids[i]];
            if (l.token == token && !l.withdrawn) {
                total += l.amount;
            }
        }
    }

    /**
     * @dev Returns all active locks for a user (non-withdrawn and not yet expired)
     * @param user The address of the user
     * @return Array of TokenLock structs for active locks
     */
    function getActiveLocks(address user) external view returns (TokenLock[] memory) {
        uint256[] memory ids = userLockIds[user];
        uint256 count;
        for (uint i = 0; i < ids.length; i++) {
            TokenLock storage l = locks[ids[i]];
            if (!l.withdrawn && block.timestamp < l.unlockDate) count++;
        }

        TokenLock[] memory result = new TokenLock[](count);
        uint256 idx;
        for (uint i = 0; i < ids.length; i++) {
            TokenLock storage l = locks[ids[i]];
            if (!l.withdrawn && block.timestamp < l.unlockDate) {
                result[idx] = l;
                idx++;
            }
        }
        return result;
    }

    /**
     * @dev Updates the lock fee
     * @param newFee The new fee amount in wei
     * 
     * Requirements:
     * - Caller must be the contract owner
     * 
     * @notice Only the contract owner can update the lock fee
     */
    function updateLockFee(uint256 newFee) external onlyOwner {
        uint256 oldFee = lockFee;
        lockFee = newFee;
        emit LockFeeUpdated(oldFee, newFee);
    }

    /**
     * @dev Withdraws accumulated fees to the owner
     * 
     * Requirements:
     * - Caller must be the contract owner
     * - Contract must have ETH balance to withdraw
     * 
     * @notice Only the contract owner can withdraw accumulated fees
     */
    function withdrawFees() external onlyOwner {
        uint256 fees = address(this).balance;
        require(fees > 0, "KITSU_TOKENLOCKER: No fees to withdraw");
        
        (bool success, ) = owner().call{value: fees}("");
        require(success, "KITSU_TOKENLOCKER: Fee withdrawal failed");
        emit FeesWithdrawn(fees, owner());
    }

    /**
     * @dev Returns the current lock fee
     * @return The current lock fee in wei
     */
    function getLockFee() external view returns (uint256) {
        return lockFee;
    }

    /**
     * @dev Returns the total fees accumulated in the contract
     * @return The total ETH balance of the contract
     */
    function getAccumulatedFees() external view returns (uint256) {
        return address(this).balance;
    }
}
