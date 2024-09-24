import { Planner, } from './Planner';

export const removeLiquidity = async (
    signer,
    binPositionManagerContract,
    poolKey,
    amount0Min,
    amount1Min,
    ids,
    amounts,
    deadline, //{ permitSingle, signature }
) => {
    try {
        const address = await signer.getAddress();

        // Create the plan
        let plan = Planner.init();

        // Remove liquidity action
        Planner.removeLiquidity(
            plan,
            poolKey,
            amount0Min,
            amount1Min,
            ids,
            amounts,
            address,
        );

        // Finalize the plan with take actions
        const encodedPlan = Planner.finalizeModifyLiquidityWithTakePair(plan, poolKey, address);

        console.log('Encoded plan:', encodedPlan);

        // Prepare the calls array
        const calls = [];

        // Add permit calls if signatures are provided
        // if (signature0) {
        //     const permitCall = binPositionManagerContract.interface.encodeFunctionData(
        //         "permit",
        //         [address, permitSingle0, signature0]
        //     );
        //     calls.push(permitCall);
        // }
        // if (signature1) {
        //     const permitCall = binPositionManagerContract.interface.encodeFunctionData(
        //         "permit",
        //         [address, permitSingle1, signature1]
        //     );
        //     calls.push(permitCall);
        // }

        // Add modifyLiquidities call
        const modifyLiquiditiesCall = binPositionManagerContract.interface.encodeFunctionData(
            "modifyLiquidities",
            [encodedPlan, deadline]
        );
        calls.push(modifyLiquiditiesCall);

        console.log('Calls:', calls);

        // Execute multicall
        const tx = await binPositionManagerContract.multicall(calls);

        // Wait for the transaction to be mined
        const receipt = await tx.wait();

        console.log('Liquidity removed successfully:', receipt.transactionHash);
        return receipt;
    } catch (error) {
        console.error('Error in removeLiquidity:', error);
        throw error;
    }
};

export default removeLiquidity;
