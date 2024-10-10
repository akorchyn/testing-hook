// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {PoolKey} from "pancake-v4-core/src/types/PoolKey.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "pancake-v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "pancake-v4-core/src/types/BeforeSwapDelta.sol";
import {IBinPoolManager} from "pancake-v4-core/src/pool-bin/interfaces/IBinPoolManager.sol";
import {IBinPositionManager} from "pancake-v4-periphery/src/pool-bin/interfaces/IBinPositionManager.sol";
import {BinBaseHook} from "./BinBaseHook.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IPermit2} from "permit2/src/interfaces/IPermit2.sol";
import {Currency} from "pancake-v4-core/src/types/Currency.sol";
import {PoolId, PoolIdLibrary} from "pancake-v4-core/src/types/PoolId.sol";
import {Planner, Plan} from "pancake-v4-periphery/src/libraries/Planner.sol";
import {Actions} from "pancake-v4-periphery/src/libraries/Actions.sol";
import {CalldataDecoder} from "pancake-v4-periphery/src/libraries/CalldataDecoder.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {BinPoolParametersHelper} from "pancake-v4-core/src/pool-bin/libraries/BinPoolParametersHelper.sol";

contract BusinessManager is BinBaseHook, Ownable {
    using PoolIdLibrary for PoolKey;
    using Planner for Plan;
    using CalldataDecoder for bytes;

    mapping(address => bool) public banned;
    IPermit2 public permit2;
    IBinPositionManager public positionManager;

    // New struct to store minimum liquidity for both tokens
    struct MinLiquidity {
        uint256 tokenX;
        uint256 tokenY;
    }

    event Data(
        uint256 token1inActive,
        uint256 token2inActive,
        uint256 binLiquidity,
        uint256 totalShares,
        uint256 activeId
    );

    // Mapping to store minimum liquidity for each pool
    mapping(PoolId => MinLiquidity) public minLiquidityPerPool;

    error Banned();

    constructor(
        IBinPositionManager _positionManager,
        address _owner,
        IPermit2 _permit2
    ) BinBaseHook(_positionManager.binPoolManager()) Ownable(_owner) {
        positionManager = _positionManager;
        permit2 = _permit2;
    }

    // Function to set minimum liquidity for a specific pool
    function setMinLiquidity(
        PoolId poolId,
        uint256 minToken0,
        uint256 minToken1
    ) external onlyOwner {
        minLiquidityPerPool[poolId] = MinLiquidity(minToken0, minToken1);
    }

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
                    afterSwap: true,
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
        PoolKey calldata key,
        bool,
        int128,
        bytes calldata
    ) external override returns (bytes4, BeforeSwapDelta, uint24) {
        if (banned[tx.origin]) revert Banned();

        PoolId id = key.toId();

        (uint24 activeId, , ) = poolManager.getSlot0(id);
        (
            uint128 binReserveX,
            uint128 binReserveY,
            uint256 binLiquidity,
            uint256 totalShares
        ) = poolManager.getBin(id, activeId);

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

    function afterSwap(
        address sender,
        PoolKey calldata key,
        bool swapForY,
        int128 amountSpecified,
        BalanceDelta delta,
        bytes calldata hookData
    ) public override returns (bytes4, int128) {
        PoolId id = key.toId();

        (uint24 activeId, , ) = poolManager.getSlot0(id);
        (uint128 binReserveX, uint128 binReserveY, , ) = poolManager.getBin(
            id,
            activeId
        );

        MinLiquidity memory minLiquidity = minLiquidityPerPool[id];
        uint256 to_add_liquidity_x = binReserveX < minLiquidity.tokenX
            ? minLiquidity.tokenX - binReserveX
            : 0;
        uint256 to_add_liquidity_y = binReserveY < minLiquidity.tokenY
            ? minLiquidity.tokenY - binReserveY
            : 0;

        if (to_add_liquidity_x > 0 || to_add_liquidity_y > 0) {
            IERC20(Currency.unwrap(key.currency0)).approve(
                address(permit2),
                type(uint256).max
            );
            IERC20(Currency.unwrap(key.currency1)).approve(
                address(permit2),
                type(uint256).max
            );
            permit2.approve(
                Currency.unwrap(key.currency0),
                address(positionManager),
                uint160(to_add_liquidity_x),
                0
            );
            permit2.approve(
                Currency.unwrap(key.currency1),
                address(positionManager),
                uint160(to_add_liquidity_y),
                0
            );
            int256[] memory deltaIds = new int256[](1);
            deltaIds[0] = int256(0);
            uint256[] memory distributionX = new uint256[](1);
            distributionX[0] = 1e18;
            uint256[] memory distributionY = new uint256[](1);
            distributionY[0] = 1e18;

            IBinPositionManager.BinAddLiquidityParams
                memory mintParams = IBinPositionManager.BinAddLiquidityParams({
                    poolKey: key,
                    amount0: uint128(to_add_liquidity_x),
                    amount1: uint128(to_add_liquidity_y),
                    amount0Min: 0,
                    amount1Min: 0,
                    activeIdDesired: activeId,
                    idSlippage: 0,
                    deltaIds: deltaIds,
                    distributionX: distributionX,
                    distributionY: distributionY,
                    to: address(this)
                });

            Plan memory plan = Planner.init();
            plan.add(Actions.BIN_ADD_LIQUIDITY, abi.encode(mintParams));
            bytes memory payload = plan.finalizeModifyLiquidityWithSettlePair(
                key
            );
            this._send_liquidity(payload);
        }

        return (this.afterSwap.selector, 0);
    }

    function _send_liquidity(bytes calldata payload) public selfOnly {
        (bytes calldata actions, bytes[] calldata params) = payload
            .decodeActionsRouterParams();

        positionManager.modifyLiquiditiesWithoutLock(actions, params);
    }
}
