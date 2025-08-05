# Kitsu TokenLocker

A secure smart contract for time-locking ERC20 tokens with transferable ownership.

## Overview

TokenLocker allows users to lock ERC20 tokens for a specified period. Tokens can only be withdrawn after the unlock date has passed. Lock ownership can be transferred to other addresses.

## Core Features

- **Time-locked withdrawals**: Tokens locked until specified timestamp
- **Transferable ownership**: Locks can be transferred to new owners
- **Query functions**: Get locks by user, token, or total amounts
- **Reentrancy protection**: Secure against reentrancy attacks
- **Event emission**: Full event tracking for transparency

## Contract Functions

```solidity
// Lock tokens for specified period
lockTokens(address token, uint256 amount, uint256 unlockDate)

// Withdraw tokens after unlock date
withdraw(uint256 lockId)

// Transfer lock ownership
transferLock(uint256 lockId, address newOwner)

// Query functions
getUserLocks(address user) → uint256[]
getTokenLocks(address token) → uint256[]
getLockedAmount(address user, address token) → uint256
getActiveLocks(address user) → TokenLock[]
```

## Development

```bash
npm install
npm test
```

## Security

- ReentrancyGuard protection
- Access control on withdrawals
- Zero address validation
- Comprehensive test coverage (29 tests)

## License

MIT
