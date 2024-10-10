// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IBinPoolManager} from "pancake-v4-core/src/pool-bin/interfaces/IBinPoolManager.sol";
import {PoolKey} from "pancake-v4-core/src/types/PoolKey.sol";
import {BalanceDelta} from "pancake-v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta} from "pancake-v4-core/src/types/BeforeSwapDelta.sol";
import {Currency} from "pancake-v4-core/src/types/Currency.sol";
import {BinPoolParametersHelper} from "pancake-v4-core/src/pool-bin/libraries/BinPoolParametersHelper.sol";
import {BinBaseHook} from "./BinBaseHook.sol";
import {PoolKey} from "pancake-v4-core/src/types/PoolKey.sol";
import {IBinHooks} from "pancake-v4-core/src/pool-bin/interfaces/IBinHooks.sol";
import {IBinPoolManager} from "pancake-v4-core/src/pool-bin/interfaces/IBinPoolManager.sol";

contract ProxyHook is BinBaseHook, Ownable {
    IBinHooks public implementation;
    PoolKey public poolKey;
    uint24 public constant ACTIVE_ID = 8526770;

    event ImplementationChanged(IBinHooks indexed newImplementation);

    constructor(
        IBinPoolManager poolManager,
        address _owner,
        IBinHooks _implementation
    ) BinBaseHook(poolManager) Ownable(_owner) {
        _setImplementation(_implementation);
    }

    function setImplementation(IBinHooks _implementation) external onlyOwner {
        _setImplementation(_implementation);
    }

    function _setImplementation(IBinHooks _implementation) private {
        require(
            address(_implementation) != address(0),
            "Invalid implementation address"
        );
        implementation = _implementation;
        emit ImplementationChanged(_implementation);
    }

    function initialize(
        Currency currency0,
        Currency currency1
    ) external onlyOwner {
        bytes32 parameters = BinPoolParametersHelper.setBinStep(
            bytes32(uint256(this.getHooksRegistrationBitmap())),
            1
        );

        poolKey = PoolKey({
            currency0: currency0,
            currency1: currency1,
            hooks: this,
            poolManager: this.poolManager(),
            fee: uint24(3000),
            parameters: parameters
        });

        this.poolManager().initialize(poolKey, ACTIVE_ID, new bytes(0));
    }

    function beforeInitialize(
        address sender,
        PoolKey calldata key,
        uint24 activeId,
        bytes calldata hookData
    ) external override poolManagerOnly returns (bytes4) {
        return implementation.beforeInitialize(sender, key, activeId, hookData);
    }

    function afterInitialize(
        address sender,
        PoolKey calldata key,
        uint24 activeId,
        bytes calldata hookData
    ) external override poolManagerOnly returns (bytes4) {
        return implementation.afterInitialize(sender, key, activeId, hookData);
    }

    function beforeMint(
        address sender,
        PoolKey calldata key,
        IBinPoolManager.MintParams calldata params,
        bytes calldata hookData
    ) external override poolManagerOnly returns (bytes4, uint24) {
        return implementation.beforeMint(sender, key, params, hookData);
    }

    function afterMint(
        address sender,
        PoolKey calldata key,
        IBinPoolManager.MintParams calldata params,
        BalanceDelta delta,
        bytes calldata hookData
    ) external override poolManagerOnly returns (bytes4, BalanceDelta) {
        return implementation.afterMint(sender, key, params, delta, hookData);
    }

    function beforeBurn(
        address sender,
        PoolKey calldata key,
        IBinPoolManager.BurnParams calldata params,
        bytes calldata hookData
    ) external override poolManagerOnly returns (bytes4) {
        return implementation.beforeBurn(sender, key, params, hookData);
    }

    function afterBurn(
        address sender,
        PoolKey calldata key,
        IBinPoolManager.BurnParams calldata params,
        BalanceDelta delta,
        bytes calldata hookData
    ) external override poolManagerOnly returns (bytes4, BalanceDelta) {
        return implementation.afterBurn(sender, key, params, delta, hookData);
    }

    function beforeSwap(
        address sender,
        PoolKey calldata key,
        bool swapForY,
        int128 amountSpecified,
        bytes calldata hookData
    )
        external
        override
        poolManagerOnly
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        return
            implementation.beforeSwap(
                sender,
                key,
                swapForY,
                amountSpecified,
                hookData
            );
    }

    function afterSwap(
        address sender,
        PoolKey calldata key,
        bool swapForY,
        int128 amountSpecified,
        BalanceDelta delta,
        bytes calldata hookData
    ) external override poolManagerOnly returns (bytes4, int128) {
        return
            implementation.afterSwap(
                sender,
                key,
                swapForY,
                amountSpecified,
                delta,
                hookData
            );
    }

    function beforeDonate(
        address sender,
        PoolKey calldata key,
        uint256 amount0,
        uint256 amount1,
        bytes calldata hookData
    ) external override poolManagerOnly returns (bytes4) {
        return
            implementation.beforeDonate(
                sender,
                key,
                amount0,
                amount1,
                hookData
            );
    }

    function afterDonate(
        address sender,
        PoolKey calldata key,
        uint256 amount0,
        uint256 amount1,
        bytes calldata hookData
    ) external override poolManagerOnly returns (bytes4) {
        return
            implementation.afterDonate(sender, key, amount0, amount1, hookData);
    }

    function getHooksRegistrationBitmap()
        external
        view
        override
        returns (uint16)
    {
        return implementation.getHooksRegistrationBitmap();
    }
}
