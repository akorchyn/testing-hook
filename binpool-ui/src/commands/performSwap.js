import { ethers } from 'ethers';
import { ActionConstants, Planner, } from './Planner';

export const Commands = {
    PERMIT2_PERMIT: 0x0a,
    V4_SWAP: 0x10,
};

export const swapTokens = async (
    universalRouterContract,
    poolKey,
    swapForY,
    swapData,
    deadline, { permitSingle, signature }
) => {
    try {
        // Create the plan
        let plan = Planner.init();

        Planner.swap(
            plan,
            poolKey,
            swapForY,
            "0x",
            swapData,
        );

        // Finalize the plan with take actions
        let currency0 = swapForY ? poolKey.currency0 : poolKey.currency1;
        let currency1 = swapForY ? poolKey.currency1 : poolKey.currency0;
        const encodedPlan = Planner.finalizeSwap(plan, currency0, currency1, ActionConstants.MSG_SENDER);

        const commands = ethers.utils.solidityPack(["bytes"], [[Commands.PERMIT2_PERMIT, Commands.V4_SWAP]]);
        const permitCall = ethers.utils.defaultAbiCoder.encode(["tuple(tuple(address token, uint160 amount, uint48 expiration, uint48 nonce) details, address spender, uint256 sigDeadline)", "bytes signature"],
            [permitSingle, signature,]
        );


        const args = [permitCall, encodedPlan];
        // Execute multicall
        const tx = await universalRouterContract.execute(commands, args, deadline);

        // Wait for the transaction to be mined
        const receipt = await tx.wait();

        console.log('Swap successful:', receipt.transactionHash);
        return receipt;
    } catch (error) {
        console.error('Error in swapping:', error);
        throw error;
    }
};

export default swapTokens;
