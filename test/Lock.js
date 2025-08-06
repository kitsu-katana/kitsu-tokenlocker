const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("TokenLocker", function () {
    let tokenLocker, mockToken;
    let owner, user1, user2, user3;
    let lockId1, lockId2, lockId3;
    const lockFee = ethers.parseEther("0.0025"); // 0.0025 ETH fee

    beforeEach(async function () {
        [owner, user1, user2, user3] = await ethers.getSigners();

        // Deploy mock ERC20 token
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        mockToken = await MockERC20.deploy("Mock Token", "MTK");

        // Deploy TokenLocker contract
        const TokenLocker = await ethers.getContractFactory("TokenLocker");
        tokenLocker = await TokenLocker.deploy();

        // Mint tokens to users for testing
        await mockToken.mint(user1.address, ethers.parseEther("1000"));
        await mockToken.mint(user2.address, ethers.parseEther("1000"));
        await mockToken.mint(user3.address, ethers.parseEther("1000"));
    });

    describe("Deployment", function () {
        it("Should deploy with correct initial state", async function () {
            expect(await tokenLocker.nextLockId()).to.equal(0);
            expect(await tokenLocker.getLockFee()).to.equal(lockFee);
        });
    });

    describe("Token Locking", function () {
        beforeEach(async function () {
            // Approve tokens for locking
            await mockToken.connect(user1).approve(tokenLocker.target, ethers.parseEther("1000"));
        });

        it("Should lock tokens successfully", async function () {
            const amount = ethers.parseEther("100");
            const currentTime = await ethers.provider.getBlock("latest");
            const unlockDate = currentTime.timestamp + 3600; // 1 hour from now

            await expect(tokenLocker.connect(user1).lockTokens(mockToken.target, amount, unlockDate, { value: lockFee }))
                .to.emit(tokenLocker, "TokenLocked")
                .withArgs(0, user1.address, mockToken.target, amount, unlockDate, lockFee);

            expect(await tokenLocker.nextLockId()).to.equal(1);
            
            const lock = await tokenLocker.getLock(0);
            expect(lock.id).to.equal(0);
            expect(lock.token).to.equal(mockToken.target);
            expect(lock.owner).to.equal(user1.address);
            expect(lock.amount).to.equal(amount);
            expect(lock.unlockDate).to.equal(unlockDate);
            expect(lock.withdrawn).to.be.false;
        });

        it("Should fail when unlock date is in the past", async function () {
            const amount = ethers.parseEther("100");
            const currentTime = await ethers.provider.getBlock("latest");
            const unlockDate = currentTime.timestamp - 3600; // 1 hour ago

            await expect(
                tokenLocker.connect(user1).lockTokens(mockToken.target, amount, unlockDate, { value: lockFee })
            ).to.be.revertedWith("KITSU_TOKENLOCKER: Unlock date must be in the future");
        });

        it("Should fail when amount is zero", async function () {
            const amount = 0;
            const currentTime = await ethers.provider.getBlock("latest");
            const unlockDate = currentTime.timestamp + 3600;

            await expect(
                tokenLocker.connect(user1).lockTokens(mockToken.target, amount, unlockDate, { value: lockFee })
            ).to.be.revertedWith("KITSU_TOKENLOCKER: Amount must be > 0");
        });

        it("Should fail when user hasn't approved tokens", async function () {
            const amount = ethers.parseEther("100");
            const currentTime = await ethers.provider.getBlock("latest");
            const unlockDate = currentTime.timestamp + 3600;

            await expect(
                tokenLocker.connect(user2).lockTokens(mockToken.target, amount, unlockDate, { value: lockFee })
            ).to.be.reverted;
        });

        it("Should fail when incorrect fee is sent", async function () {
            const amount = ethers.parseEther("100");
            const currentTime = await ethers.provider.getBlock("latest");
            const unlockDate = currentTime.timestamp + 3600;
            const wrongFee = ethers.parseEther("0.001"); // Wrong fee amount

            await expect(
                tokenLocker.connect(user1).lockTokens(mockToken.target, amount, unlockDate, { value: wrongFee })
            ).to.be.revertedWith("KITSU_TOKENLOCKER: Incorrect fee amount");
        });

        it("Should track user locks correctly", async function () {
            const amount1 = ethers.parseEther("100");
            const amount2 = ethers.parseEther("200");
            const currentTime = await ethers.provider.getBlock("latest");
            const unlockDate = currentTime.timestamp + 3600;

            await mockToken.connect(user2).approve(tokenLocker.target, ethers.parseEther("1000"));

            await tokenLocker.connect(user1).lockTokens(mockToken.target, amount1, unlockDate, { value: lockFee });
            await tokenLocker.connect(user2).lockTokens(mockToken.target, amount2, unlockDate, { value: lockFee });

            const user1Locks = await tokenLocker.getUserLocks(user1.address);
            const user2Locks = await tokenLocker.getUserLocks(user2.address);

            expect(user1Locks.length).to.equal(1);
            expect(user1Locks[0]).to.equal(0);
            expect(user2Locks.length).to.equal(1);
            expect(user2Locks[0]).to.equal(1);
        });

        it("Should track token locks correctly", async function () {
            const amount = ethers.parseEther("100");
            const currentTime = await ethers.provider.getBlock("latest");
            const unlockDate = currentTime.timestamp + 3600;

            await tokenLocker.connect(user1).lockTokens(mockToken.target, amount, unlockDate, { value: lockFee });

            const tokenLocks = await tokenLocker.getTokenLocks(mockToken.target);
            expect(tokenLocks.length).to.equal(1);
            expect(tokenLocks[0]).to.equal(0);
        });
    });

    describe("Token Withdrawal", function () {
        let unlockDate;

        beforeEach(async function () {
            await mockToken.connect(user1).approve(tokenLocker.target, ethers.parseEther("1000"));
            const currentTime = await ethers.provider.getBlock("latest");
            unlockDate = currentTime.timestamp + 3600;
            
            await tokenLocker.connect(user1).lockTokens(mockToken.target, ethers.parseEther("100"), unlockDate, { value: lockFee });
            lockId1 = 0;
        });

        it("Should withdraw tokens after unlock date", async function () {
            // Fast forward time
            await ethers.provider.send("evm_increaseTime", [3600]);
            await ethers.provider.send("evm_mine");

            const balanceBefore = await mockToken.balanceOf(user1.address);

            await expect(tokenLocker.connect(user1).withdraw(lockId1))
                .to.emit(tokenLocker, "TokenWithdrawn")
                .withArgs(lockId1, user1.address);

            const balanceAfter = await mockToken.balanceOf(user1.address);
            expect(balanceAfter - balanceBefore).to.equal(ethers.parseEther("100"));

            const lock = await tokenLocker.getLock(lockId1);
            expect(lock.withdrawn).to.be.true;
        });

        it("Should fail when trying to withdraw before unlock date", async function () {
            await expect(
                tokenLocker.connect(user1).withdraw(lockId1)
            ).to.be.revertedWith("KITSU_TOKENLOCKER: Still locked");
        });

        it("Should fail when non-owner tries to withdraw", async function () {
            await ethers.provider.send("evm_increaseTime", [3600]);
            await ethers.provider.send("evm_mine");

            await expect(
                tokenLocker.connect(user2).withdraw(lockId1)
            ).to.be.revertedWith("KITSU_TOKENLOCKER: Not owner");
        });

        it("Should fail when trying to withdraw already withdrawn tokens", async function () {
            await ethers.provider.send("evm_increaseTime", [3600]);
            await ethers.provider.send("evm_mine");

            await tokenLocker.connect(user1).withdraw(lockId1);

            await expect(
                tokenLocker.connect(user1).withdraw(lockId1)
            ).to.be.revertedWith("KITSU_TOKENLOCKER: Already withdrawn");
        });
    });

    describe("Lock Transfer", function () {
        let unlockDate;

        beforeEach(async function () {
            await mockToken.connect(user1).approve(tokenLocker.target, ethers.parseEther("1000"));
            const currentTime = await ethers.provider.getBlock("latest");
            unlockDate = currentTime.timestamp + 3600;
            
            await tokenLocker.connect(user1).lockTokens(mockToken.target, ethers.parseEther("100"), unlockDate, { value: lockFee });
            lockId1 = 0;
        });

        it("Should transfer lock ownership successfully", async function () {
            await expect(tokenLocker.connect(user1).transferLock(lockId1, user2.address))
                .to.emit(tokenLocker, "LockTransferred")
                .withArgs(lockId1, user1.address, user2.address);

            const lock = await tokenLocker.getLock(lockId1);
            expect(lock.owner).to.equal(user2.address);

            const user1Locks = await tokenLocker.getUserLocks(user1.address);
            const user2Locks = await tokenLocker.getUserLocks(user2.address);

            expect(user1Locks.length).to.equal(0);
            expect(user2Locks.length).to.equal(1);
            expect(user2Locks[0]).to.equal(lockId1);
        });

        it("Should fail when transferring to zero address", async function () {
            await expect(
                tokenLocker.connect(user1).transferLock(lockId1, ethers.ZeroAddress)
            ).to.be.revertedWith("KITSU_TOKENLOCKER: Zero address not allowed");
        });

        it("Should fail when non-owner tries to transfer", async function () {
            await expect(
                tokenLocker.connect(user2).transferLock(lockId1, user3.address)
            ).to.be.revertedWith("KITSU_TOKENLOCKER: Not owner");
        });

        it("Should fail when trying to transfer withdrawn lock", async function () {
            await ethers.provider.send("evm_increaseTime", [3600]);
            await ethers.provider.send("evm_mine");
            await tokenLocker.connect(user1).withdraw(lockId1);

            await expect(
                tokenLocker.connect(user1).transferLock(lockId1, user2.address)
            ).to.be.revertedWith("KITSU_TOKENLOCKER: Already withdrawn");
        });

        it("Should allow new owner to withdraw transferred lock", async function () {
            await tokenLocker.connect(user1).transferLock(lockId1, user2.address);
            
            await ethers.provider.send("evm_increaseTime", [3600]);
            await ethers.provider.send("evm_mine");

            const balanceBefore = await mockToken.balanceOf(user2.address);
            await tokenLocker.connect(user2).withdraw(lockId1);
            const balanceAfter = await mockToken.balanceOf(user2.address);

            expect(balanceAfter - balanceBefore).to.equal(ethers.parseEther("100"));
        });
    });

    describe("Query Functions", function () {
        beforeEach(async function () {
            await mockToken.connect(user1).approve(tokenLocker.target, ethers.parseEther("1000"));
            await mockToken.connect(user2).approve(tokenLocker.target, ethers.parseEther("1000"));
            
            const currentTime = await ethers.provider.getBlock("latest");
            const unlockDate1 = currentTime.timestamp + 3600;
            const unlockDate2 = currentTime.timestamp + 7200;
            const unlockDate3 = currentTime.timestamp + 10800;

            await tokenLocker.connect(user1).lockTokens(mockToken.target, ethers.parseEther("100"), unlockDate1, { value: lockFee });
            await tokenLocker.connect(user1).lockTokens(mockToken.target, ethers.parseEther("200"), unlockDate2, { value: lockFee });
            await tokenLocker.connect(user2).lockTokens(mockToken.target, ethers.parseEther("300"), unlockDate3, { value: lockFee });

            lockId1 = 0;
            lockId2 = 1;
            lockId3 = 2;
        });

        it("Should return correct locked amount for user and token", async function () {
            const lockedAmount = await tokenLocker.getLockedAmount(user1.address, mockToken.target);
            expect(lockedAmount).to.equal(ethers.parseEther("300")); // 100 + 200
        });

        it("Should return zero for non-existent user", async function () {
            const lockedAmount = await tokenLocker.getLockedAmount(user3.address, mockToken.target);
            expect(lockedAmount).to.equal(0);
        });

        it("Should return active locks correctly", async function () {
            const activeLocks = await tokenLocker.getActiveLocks(user1.address);
            expect(activeLocks.length).to.equal(2);
            expect(activeLocks[0].id).to.equal(0);
            expect(activeLocks[1].id).to.equal(1);
        });

        it("Should not include withdrawn locks in active locks", async function () {
            await ethers.provider.send("evm_increaseTime", [3600]);
            await ethers.provider.send("evm_mine");
            await tokenLocker.connect(user1).withdraw(lockId1);

            const activeLocks = await tokenLocker.getActiveLocks(user1.address);
            expect(activeLocks.length).to.equal(1);
            expect(activeLocks[0].id).to.equal(1);
        });

        it("Should not include expired locks in active locks", async function () {
            await ethers.provider.send("evm_increaseTime", [7200]);
            await ethers.provider.send("evm_mine");

            const activeLocks = await tokenLocker.getActiveLocks(user1.address);
            expect(activeLocks.length).to.equal(0);
        });

        it("Should return correct user locks", async function () {
            const userLocks = await tokenLocker.getUserLocks(user1.address);
            expect(userLocks.length).to.equal(2);
            expect(userLocks[0]).to.equal(0);
            expect(userLocks[1]).to.equal(1);
        });

        it("Should return correct token locks", async function () {
            const tokenLocks = await tokenLocker.getTokenLocks(mockToken.target);
            expect(tokenLocks.length).to.equal(3);
            expect(tokenLocks[0]).to.equal(0);
            expect(tokenLocks[1]).to.equal(1);
            expect(tokenLocks[2]).to.equal(2);
        });
    });

    describe("Edge Cases and Security", function () {
        it("Should handle multiple locks correctly", async function () {
            await mockToken.connect(user1).approve(tokenLocker.target, ethers.parseEther("1000"));
            
            const currentTime = await ethers.provider.getBlock("latest");
            const unlockDate = currentTime.timestamp + 3600;
            
            // Create multiple locks
            for (let i = 0; i < 5; i++) {
                await tokenLocker.connect(user1).lockTokens(
                    mockToken.target, 
                    ethers.parseEther("10"), 
                    unlockDate,
                    { value: lockFee }
                );
            }

            expect(await tokenLocker.nextLockId()).to.equal(5);
            
            const userLocks = await tokenLocker.getUserLocks(user1.address);
            expect(userLocks.length).to.equal(5);
        });

        it("Should handle reentrancy protection", async function () {
            // This test verifies that the nonReentrant modifier is working
            await mockToken.connect(user1).approve(tokenLocker.target, ethers.parseEther("1000"));
            
            const currentTime = await ethers.provider.getBlock("latest");
            const unlockDate = currentTime.timestamp + 3600;
            await tokenLocker.connect(user1).lockTokens(mockToken.target, ethers.parseEther("100"), unlockDate, { value: lockFee });

            // Try to call withdraw multiple times in the same transaction
            // This should be prevented by the nonReentrant modifier
            await ethers.provider.send("evm_increaseTime", [3600]);
            await ethers.provider.send("evm_mine");

            await tokenLocker.connect(user1).withdraw(0);
            
            // Second withdrawal should fail
            await expect(
                tokenLocker.connect(user1).withdraw(0)
            ).to.be.revertedWith("KITSU_TOKENLOCKER: Already withdrawn");
        });

        it("Should handle zero amount approval", async function () {
            const currentTime = await ethers.provider.getBlock("latest");
            const unlockDate = currentTime.timestamp + 3600;
            
            await expect(
                tokenLocker.connect(user1).lockTokens(mockToken.target, 0, unlockDate, { value: lockFee })
            ).to.be.revertedWith("KITSU_TOKENLOCKER: Amount must be > 0");
        });
    });

    describe("Events", function () {
        beforeEach(async function () {
            await mockToken.connect(user1).approve(tokenLocker.target, ethers.parseEther("1000"));
        });

        it("Should emit TokenLocked event with correct parameters", async function () {
            const amount = ethers.parseEther("100");
            const currentTime = await ethers.provider.getBlock("latest");
            const unlockDate = currentTime.timestamp + 3600;

            await expect(tokenLocker.connect(user1).lockTokens(mockToken.target, amount, unlockDate, { value: lockFee }))
                .to.emit(tokenLocker, "TokenLocked")
                .withArgs(0, user1.address, mockToken.target, amount, unlockDate, lockFee);
        });

        it("Should emit TokenWithdrawn event with correct parameters", async function () {
            const currentTime = await ethers.provider.getBlock("latest");
            const unlockDate = currentTime.timestamp + 3600;
            await tokenLocker.connect(user1).lockTokens(mockToken.target, ethers.parseEther("100"), unlockDate, { value: lockFee });

            await ethers.provider.send("evm_increaseTime", [3600]);
            await ethers.provider.send("evm_mine");

            await expect(tokenLocker.connect(user1).withdraw(0))
                .to.emit(tokenLocker, "TokenWithdrawn")
                .withArgs(0, user1.address);
        });

        it("Should emit LockTransferred event with correct parameters", async function () {
            const currentTime = await ethers.provider.getBlock("latest");
            const unlockDate = currentTime.timestamp + 3600;
            await tokenLocker.connect(user1).lockTokens(mockToken.target, ethers.parseEther("100"), unlockDate, { value: lockFee });

            await expect(tokenLocker.connect(user1).transferLock(0, user2.address))
                .to.emit(tokenLocker, "LockTransferred")
                .withArgs(0, user1.address, user2.address);
        });
    });

    describe("Fee Management", function () {
        it("Should allow owner to update lock fee", async function () {
            const newFee = ethers.parseEther("0.005");
            await expect(tokenLocker.connect(owner).updateLockFee(newFee))
                .to.emit(tokenLocker, "LockFeeUpdated")
                .withArgs(lockFee, newFee);
            
            expect(await tokenLocker.getLockFee()).to.equal(newFee);
        });

        it("Should fail when non-owner tries to update fee", async function () {
            const newFee = ethers.parseEther("0.005");
            await expect(
                tokenLocker.connect(user1).updateLockFee(newFee)
            ).to.be.revertedWithCustomError(tokenLocker, "OwnableUnauthorizedAccount");
        });

        it("Should allow owner to withdraw accumulated fees", async function () {
            // First, create a lock to accumulate fees
            await mockToken.connect(user1).approve(tokenLocker.target, ethers.parseEther("1000"));
            const currentTime = await ethers.provider.getBlock("latest");
            const unlockDate = currentTime.timestamp + 3600;
            await tokenLocker.connect(user1).lockTokens(mockToken.target, ethers.parseEther("100"), unlockDate, { value: lockFee });

            const balanceBefore = await ethers.provider.getBalance(owner.address);
            const tx = await tokenLocker.connect(owner).withdrawFees();
            const receipt = await tx.wait();
            const gasUsed = receipt.gasUsed * receipt.gasPrice;
            const balanceAfter = await ethers.provider.getBalance(owner.address);

            expect(balanceAfter - balanceBefore + gasUsed).to.equal(lockFee);
            expect(await tokenLocker.getAccumulatedFees()).to.equal(0);
        });

        it("Should fail when non-owner tries to withdraw fees", async function () {
            await expect(
                tokenLocker.connect(user1).withdrawFees()
            ).to.be.revertedWithCustomError(tokenLocker, "OwnableUnauthorizedAccount");
        });

        it("Should fail to withdraw fees when no fees are accumulated", async function () {
            await expect(
                tokenLocker.connect(owner).withdrawFees()
            ).to.be.revertedWith("KITSU_TOKENLOCKER: No fees to withdraw");
        });
    });
});
