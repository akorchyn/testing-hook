// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {PoolKey} from "pancake-v4-core/src/types/PoolKey.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "pancake-v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "pancake-v4-core/src/types/BeforeSwapDelta.sol";
import {IBinPoolManager} from "pancake-v4-core/src/pool-bin/interfaces/IBinPoolManager.sol";
import {BinBaseHook} from "./BinBaseHook.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {BinPoolParametersHelper} from "pancake-v4-core/src/pool-bin/libraries/BinPoolParametersHelper.sol";

/// @notice AllowlistHook is a contract that prevents banned users from using the pool
contract AllowlistHook is BinBaseHook, Ownable {
    mapping(address => bool) public banned;

    error Banned();

    constructor(
        IBinPoolManager _poolManager,
        address _owner
    ) BinBaseHook(_poolManager) Ownable(_owner) {}

    function ban(address _address) external onlyOwner {
        banned[_address] = true;
    }

    function unban(address _address) external onlyOwner {
        banned[_address] = false;
    }

    function getHooksRegistrationBitmap()
        external
        pure
        override
        returns (uint16)
    {
        return
            _hooksRegistrationBitmapFrom(
                Permissions({
                    beforeInitialize: false,
                    afterInitialize: false,
                    beforeMint: true,
                    afterMint: false,
                    beforeBurn: true,
                    afterBurn: false,
                    beforeSwap: true,
                    afterSwap: false,
                    beforeDonate: true,
                    afterDonate: false,
                    beforeSwapReturnsDelta: false,
                    afterSwapReturnsDelta: false,
                    afterMintReturnsDelta: false,
                    afterBurnReturnsDelta: false
                })
            );
    }

    function beforeMint(
        address,
        PoolKey calldata,
        IBinPoolManager.MintParams calldata,
        bytes calldata
    ) external override returns (bytes4, uint24) {
        if (banned[tx.origin]) revert Banned();
        return (this.beforeMint.selector, 0);
    }

    function beforeBurn(
        address,
        PoolKey calldata,
        IBinPoolManager.BurnParams calldata,
        bytes calldata
    ) external override returns (bytes4) {
        if (banned[tx.origin]) revert Banned();
        return this.beforeBurn.selector;
    }

    function beforeSwap(
        address,
        PoolKey calldata,
        bool,
        int128,
        bytes calldata
    ) external override returns (bytes4, BeforeSwapDelta, uint24) {
        if (banned[tx.origin]) revert Banned();
        return (this.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }

    function beforeDonate(
        address,
        PoolKey calldata,
        uint256,
        uint256,
        bytes calldata
    ) external override returns (bytes4) {
        if (banned[tx.origin]) revert Banned();
        return this.beforeDonate.selector;
    }
}
