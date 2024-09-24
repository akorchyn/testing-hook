import {IBinPositionManager} from "pancake-v4-periphery/src/pool-bin/interfaces/IBinPositionManager.sol";

import {BinCalldataDecoder} from "pancake-v4-periphery/src/pool-bin/libraries/BinCalldataDecoder.sol";
import {CalldataDecoder} from "pancake-v4-periphery/src/libraries/CalldataDecoder.sol";

contract Test {
    using BinCalldataDecoder for bytes;
    using CalldataDecoder for bytes;

event Result (
    IBinPositionManager.BinAddLiquidityParams data,
    bytes actions
);

    constructor() {
        
    }

    function test(bytes calldata data)  external {
        (bytes memory actions, bytes[] calldata params) = data.decodeActionsRouterParams();

        IBinPositionManager.BinAddLiquidityParams memory liquidityParams =
                    params[0].decodeBinAddLiquidityParams();

        emit Result(liquidityParams, actions);
    }
}