// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {Test} from "forge-std/Test.sol";
import {Currency} from "pancake-v4-core/src/types/Currency.sol";
import {PoolKey} from "pancake-v4-core/src/types/PoolKey.sol";
import {BinPoolParametersHelper} from "pancake-v4-core/src/pool-bin/libraries/BinPoolParametersHelper.sol";
import {AllowlistHook} from "../../src/pool-bin/AllowlistHook.sol";
import {BinTestUtils} from "./utils/BinTestUtils.sol";
import {PoolIdLibrary} from "pancake-v4-core/src/types/PoolId.sol";
import {IBinRouterBase} from "pancake-v4-periphery/src/pool-bin/interfaces/IBinRouterBase.sol";
import {Hooks} from "pancake-v4-core/src/libraries/Hooks.sol";

contract AllowlistHookTest is Test, BinTestUtils {
    using PoolIdLibrary for PoolKey;
    using BinPoolParametersHelper for bytes32;

    AllowlistHook allowlistHook;
    Currency currency0;
    Currency currency1;
    PoolKey key;
    uint24 ACTIVE_ID = 2 ** 23;

    function setUp() public {
        (currency0, currency1) = deployContractsWithTokens();
        allowlistHook = new AllowlistHook(poolManager, address(this));

        // create the pool key
        key = PoolKey({
            currency0: currency0,
            currency1: currency1,
            hooks: allowlistHook,
            poolManager: poolManager,
            fee: uint24(3000),
            // binstep: 10 = 0.1% price jump per bin
            parameters: bytes32(
                uint256(allowlistHook.getHooksRegistrationBitmap())
            ).setBinStep(10)
        });

        // initialize pool at 1:1 price point (assume stablecoin pair)
        poolManager.initialize(key, ACTIVE_ID, new bytes(0));
    }

    function testBannedCantAddLiquidity() public {
        assertEq(allowlistHook.banned(address(this)), false);

        MockERC20(Currency.unwrap(currency0)).mint(address(this), 1 ether);
        MockERC20(Currency.unwrap(currency1)).mint(address(this), 1 ether);

        allowlistHook.ban(address(this));
        assertEq(allowlistHook.banned(address(this)), true);

        vm.startPrank(address(this), address(this));
        vm.expectRevert(
            abi.encodeWithSelector(
                Hooks.Wrap__FailedHookCall.selector,
                address(allowlistHook),
                abi.encodeWithSelector(AllowlistHook.Banned.selector)
            )
        );
        addLiquidity(key, 1 ether, 1 ether, ACTIVE_ID, 3, address(this));
    }
}
