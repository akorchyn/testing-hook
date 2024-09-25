import { Planner, } from './Planner';

export const removeLiquidity = async (
    signer,
    binPositionManagerContract,
    poolKey,
    amount0Min,
    amount1Min,
    ids,
    amounts,
    deadline,
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

        const tx = await binPositionManagerContract.modifyLiquidities(encodedPlan, deadline);

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
