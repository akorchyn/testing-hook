// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {PoolKey} from "pancake-v4-core/src/types/PoolKey.sol";
import {PriceHelper} from "pancake-v4-core/src/pool-bin/libraries/PriceHelper.sol";
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
import {BinPoolParametersHelper} from "pancake-v4-core/src/pool-bin/libraries/BinPoolParametersHelper.sol";
import {DeltaResolver} from "pancake-v4-periphery/src/base/DeltaResolver.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {ImmutableState} from "pancake-v4-periphery/src/base/ImmutableState.sol";

contract BusinessManager is DeltaResolver, BinBaseHook, Ownable {
    using PoolIdLibrary for PoolKey;
    using Planner for Plan;
    using CalldataDecoder for bytes;
    using PriceHelper for uint24;

    mapping(address => bool) public banned;
    IPermit2 public permit2;
    IBinPositionManager public positionManager;
    bool public started = false;

    event Data(
        uint256 reserveX,
        uint256 reserveY,
        uint256 activeId,
        uint256 reservesInDesiredX,
        uint256 resrevesInDesiredY
    );

    // New struct to store minimum liquidity for both tokens
    struct MinLiquidity {
        uint256 activeId;
        uint256 tokenX;
        uint256 tokenY;
    }

    event Swap(bool swapForY, int128 amount);

    // Mapping to store minimum liquidity for each pool
    mapping(PoolId => MinLiquidity) public minLiquidityPerPool;

    error Banned();
    error INTERNAL_ERROR_SameActiveId();

    constructor(
        IBinPositionManager _positionManager,
        address _owner,
        IPermit2 _permit2
    ) ImmutableState(_positionManager.binPoolManager().vault()) BinBaseHook(_positionManager.binPoolManager()) Ownable(_owner) {
        positionManager = _positionManager;
        permit2 = _permit2;
    }

    // Function to set minimum liquidity for a specific pool
    function setMinLiquidity(
        PoolId poolId,
        uint256 minToken0,
        uint256 minToken1
    ) external onlyOwner {
        (uint24 activeId, , ) = poolManager.getSlot0(poolId);

        minLiquidityPerPool[poolId] = MinLiquidity(
            activeId,
            minToken0,
            minToken1
        );
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

    function _swapLiquidityOut(
        PoolKey memory poolKey,
        uint24 activeId,
        Currency settleCurrency,
        Currency takeCurrency,
        int128 buyAmount
    ) internal {
        started = true;
        // We need to buy back all the liquidity in binReserve

        bool swapForY = settleCurrency == poolKey.currency0;
        emit Swap(swapForY, buyAmount);
        poolManager.swap(poolKey, swapForY, buyAmount + 1, bytes(""));
        _settle(settleCurrency, address(this), _getFullDebt(settleCurrency));
        _take(takeCurrency, address(this), _getFullCredit(takeCurrency));
        started = false;
    }

    function _addLiquidity(
        PoolKey memory key,
        uint24 activeId,
        uint128 amountX,
        uint128 amountY
    ) internal {
        if (amountX > 0 || amountY > 0) {
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
                uint160(amountX),
                0
            );
            permit2.approve(
                Currency.unwrap(key.currency1),
                address(positionManager),
                uint160(amountY),
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
                    amount0: uint128(amountX),
                    amount1: uint128(amountY),
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
            bytes memory payload = plan.finalizeModifyLiquidityWithClose(
                key
            );
            this._send_to_binpool(payload);
        }
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

        // We don't need to add liquidity if the activeId is the same as the minLiquidity.activeId
        if (
            minLiquidity.activeId == activeId ||
            (minLiquidity.tokenX == 0 && minLiquidity.tokenY == 0) ||
            started
        ) {
            return (this.afterSwap.selector, 0);
        }

        while (activeId != minLiquidity.activeId) {
            if (activeId > minLiquidity.activeId) {
                // I should give currency 0 and receive currency 1
                _swapLiquidityOut(
                    key,
                    activeId,
                    key.currency0,
                    key.currency1,
                    int128(binReserveY)
                );
            } else {
                _swapLiquidityOut(
                    key,
                    activeId,
                    key.currency1,
                    key.currency0,
                    int128(binReserveX)
                );
            }

            (uint24 newActiveId, , ) = poolManager.getSlot0(id);
            if (newActiveId == activeId) {
                revert INTERNAL_ERROR_SameActiveId();
            }
            activeId = newActiveId;
            (binReserveX, binReserveY, , ) = poolManager.getBin(id, activeId);
        }

        // We need to try to restore the liquidity back to the normal state
        uint256 to_add_liquidity_x = binReserveX < minLiquidity.tokenX
            ? minLiquidity.tokenX - binReserveX
            : 0;
        uint256 to_add_liquidity_y = binReserveY < minLiquidity.tokenY
            ? minLiquidity.tokenY - binReserveY
            : 0;

        _addLiquidity(
            key,
            activeId,
            uint128(to_add_liquidity_x),
            uint128(to_add_liquidity_y)
        );

        return (this.afterSwap.selector, 0);
    }

    function _send_to_binpool(bytes calldata payload) public selfOnly {
        (bytes calldata actions, bytes[] calldata params) = payload
            .decodeActionsRouterParams();

        positionManager.modifyLiquiditiesWithoutLock(actions, params);
    }

    function _pay(Currency currency, address payer, uint256 amount) internal override(DeltaResolver) {
        if (payer == address(this)) {
            // TODO: currency is guaranteed to not be eth so the native check in transfer is not optimal.
            currency.transfer(address(vault), amount);
        } else {
            permit2.transferFrom(payer, address(vault), uint160(amount), Currency.unwrap(currency));
        }
    }
}
