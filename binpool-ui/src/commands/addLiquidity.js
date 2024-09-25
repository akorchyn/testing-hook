import { Planner, } from './Planner';

const addLiquidity = async (
    signer,
    binPositionManagerContract,
    poolKey,
    amount0,
    amount1,
    amount0Min,
    amount1Min,
    activeIdDesired,
    idSlippage,
    deltaIds,
    distributionX,
    distributionY,
    deadline, { permitSingle: permitSingle0, signature: signature0 }, { permitSingle: permitSingle1, signature: signature1 }
) => {
    try {

        const address = await signer.getAddress();
        // Create the plan
        let plan = Planner.init();

        // Add liquidity action
        Planner.addLiquidity(
            plan,
            poolKey,
            amount0,  // Now using pre-formatted values
            amount1,  // Now using pre-formatted values
            amount0Min,  // Now using pre-formatted values
            amount1Min,  // Now using pre-formatted values
            activeIdDesired,
            idSlippage,
            deltaIds,
            distributionX,  // Assuming this is already formatted
            distributionY,  // Assuming this is already formatted
            address,
        );

        // Finalize the plan with take actions
        const encodedPlan = Planner.finalizeModifyLiquidityWithSettlePair(plan, poolKey, address);

        console.log('Encoded plan:', encodedPlan);

        // Prepare the calls array
        const calls = [];
        // Add permit call if signature is provided
        if (signature0) {
            const permitCall = binPositionManagerContract.interface.encodeFunctionData(
                "permit",
                [address, permitSingle0, signature0]
            );
            calls.push(permitCall);
        }
        if (signature1) {
            const permitCall = binPositionManagerContract.interface.encodeFunctionData(
                "permit",
                [address, permitSingle1, signature1]
            );
            calls.push(permitCall);
        }
        // Add modifyLiquidities call
        const modifyLiquiditiesCall = binPositionManagerContract.interface.encodeFunctionData(
            "modifyLiquidities",
            [encodedPlan, deadline]
        );
        calls.push(modifyLiquiditiesCall);

        console.log(`["${calls[0]}", "${calls[1]}", "${calls[2]}"]`);

        // Execute multicall
        const tx = await binPositionManagerContract.multicall(calls);

        // Execute the transaction and wait for it to be mined
        const receipt = await tx.wait();

        console.log('Liquidity added successfully:', receipt.transactionHash);
        return receipt;
    } catch (error) {
        console.error('Error in addLiquidity:', error);
        throw error;
    }
};

export default addLiquidity;
