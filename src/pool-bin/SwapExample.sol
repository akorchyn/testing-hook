import {UniversalRouter} from "pancake-v4-universal-router/src/UniversalRouter.sol";
import {Planner, Plan} from "pancake-v4-periphery/src/libraries/Planner.sol";
import {Actions} from "pancake-v4-periphery/src/libraries/Actions.sol";
import {ActionConstants} from "pancake-v4-periphery/src/libraries/ActionConstants.sol";
import {IBinRouterBase} from "pancake-v4-periphery/src/pool-bin/interfaces/IBinRouterBase.sol";
import {IPermit2} from "permit2/src/interfaces/IPermit2.sol";
import {Currency} from "pancake-v4-core/src/types/Currency.sol";
import {Commands} from "pancake-v4-universal-router/src/libraries/Commands.sol";
import {PoolKey} from "pancake-v4-core/src/types/PoolKey.sol";
import {IHooks} from "pancake-v4-core/src/interfaces/IHooks.sol";
import {BinCalldataDecoder} from "pancake-v4-periphery/src/pool-bin/libraries/BinCalldataDecoder.sol";
import {CalldataDecoder} from "pancake-v4-periphery/src/libraries/CalldataDecoder.sol";
import {AllowlistHook} from "./AllowlistHook.sol";
import {IPoolManager} from "pancake-v4-core/src/interfaces/IPoolManager.sol";

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract SwapExample {
    PoolKey public poolKey;
    UniversalRouter public universalRouter;
    IPermit2 public permit2;

    constructor(
        AllowlistHook hook,
        UniversalRouter _universalRouter,
        IPermit2 _permit2
    ) {
        (
            Currency currency0,
            Currency currency1,
            IHooks hooks,
            IPoolManager poolManager,
            uint24 fee,
            bytes32 parameters
        ) = hook.poolKey();
        poolKey = PoolKey(
            currency0,
            currency1,
            hooks,
            poolManager,
            fee,
            parameters
        );
        universalRouter = UniversalRouter(_universalRouter);
        permit2 = IPermit2(_permit2);

        // We should allow to manage our tokens to Permit2 system
        ERC20(Currency.unwrap(poolKey.currency0)).approve(address(permit2), type(uint256).max);
        ERC20(Currency.unwrap(poolKey.currency1)).approve(address(permit2), type(uint256).max);
    }

    function swap(address token, uint128 amount, uint128 receiveMin) external {
        if (
            Currency.unwrap(poolKey.currency0) != token &&
            Currency.unwrap(poolKey.currency1) != token
        ) {
            revert("Invalid token");
        }

        if (!ERC20(token).transferFrom(msg.sender, address(this), amount)) {
            revert("Transfer failed");
        }

        // Allow spend token for this call
        permit2.approve(
            token,
            address(universalRouter),
            amount,
            0 // for this tx only
        );

     
        // X -> Y or Y -> X
        bool swapForY = token == Currency.unwrap(poolKey.currency0);

        IBinRouterBase.BinSwapExactInputSingleParams
            memory params = IBinRouterBase.BinSwapExactInputSingleParams({
                poolKey: poolKey,
                swapForY: swapForY,
                amountIn: amount,
                amountOutMinimum: receiveMin,
                hookData: ("")
            });

        Plan memory plan = Planner.init();
        Planner.add(plan, Actions.BIN_SWAP_EXACT_IN_SINGLE, abi.encode(params));
        bytes memory data = Planner.finalizeSwap(
            plan,
            swapForY ? poolKey.currency0 : poolKey.currency1,
            swapForY ? poolKey.currency1 : poolKey.currency0,
            msg.sender
        );

        bytes memory commands = abi.encodePacked(
            bytes1(uint8(Commands.V4_SWAP))
        );
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = data;

        universalRouter.execute(commands, inputs);
    }
}
