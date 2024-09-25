import { ethers } from 'ethers';

export const Actions = {
    SETTLE: 0x09,
    SETTLE_ALL: 0x10,
    SETTLE_PAIR: 0x11,
    TAKE: 0x12,
    TAKE_ALL: 0x13,
    TAKE_PORTION: 0x14,
    TAKE_PAIR: 0x15,
    SETTLE_TAKE_PAIR: 0x16,
    CLOSE_CURRENCY: 0x17,
    CLEAR_OR_TAKE: 0x18,
    SWEEP: 0x19,
    MINT_6909: 0x20,
    BURN_6909: 0x21,
    BIN_ADD_LIQUIDITY: 0x22,
    BIN_REMOVE_LIQUIDITY: 0x23,
    BIN_SWAP_EXACT_IN_SINGLE: 0x24,
    BIN_SWAP_EXACT_IN: 0x25,
    BIN_SWAP_EXACT_OUT_SINGLE: 0x26,
    BIN_SWAP_EXACT_OUT: 0x27,
    BIN_DONATE: 0x28
};

export const ActionConstants = {
    MSG_SENDER: '0x0000000000000000000000000000000000000001',
    OPEN_DELTA: 0
};

class Plan {
    constructor() {
        this.actions = ethers.utils.toUtf8Bytes('');
        this.params = [];
    }

    add(action, param) {
        this.actions = ethers.utils.concat([this.actions, ethers.utils.toUtf8Bytes(String.fromCharCode(action))]);
        this.params.push(param);
        return this;
    }

    encode() {
        return ethers.utils.defaultAbiCoder.encode(['bytes', 'bytes[]'], [this.actions, this.params]);
    }
}

export const Planner = {
    init() {
        return new Plan();
    },

    encodeBinAddLiquidityParams(poolKey, amount0, amount1, amount0Min, amount1Min, activeIdDesired, idSlippage, deltaIds, distributionX, distributionY, to) {
        return ethers.utils.defaultAbiCoder.encode(
            ['tuple(tuple(address,address,address,address,uint24,bytes32) poolKey, uint128 amount0, uint128 amount1, uint128 amount0Min, uint128 amount1Min, uint256 activeIdDesired, uint256 idSlippage, int256[] deltaIds, uint256[] distributionX, uint256[] distributionY, address to)'],
            [{ poolKey, amount0, amount1, amount0Min, amount1Min, activeIdDesired, idSlippage, deltaIds, distributionX, distributionY, to }]
        );
    },

    addLiquidity(plan, poolKey, amount0, amount1, amount0Min, amount1Min, activeIdDesired, idSlippage, deltaIds, distributionX, distributionY, to) {
        const encodedParams = this.encodeBinAddLiquidityParams(
            poolKey, amount0, amount1, amount0Min, amount1Min, activeIdDesired, idSlippage, deltaIds, distributionX, distributionY, to
        );
        return plan.add(Actions.BIN_ADD_LIQUIDITY, encodedParams);
    },

    encodeBinRemoveLiquidityParams(poolKey, amount0Min, amount1Min, ids, amounts, from) {
        return ethers.utils.defaultAbiCoder.encode(
            ['tuple(tuple(address,address,address,address,uint24,bytes32) poolKey, uint128 amount0Min, uint128 amount1Min, uint256[] ids, uint256[] amounts, address from)'],
            [{ poolKey, amount0Min, amount1Min, ids, amounts, from }]
        );
    },

    encodeBinSwapExactInputSingleParams(poolKey, swapForY, amountIn, amountOutMin, hookData) {
        return ethers.utils.defaultAbiCoder.encode(
            ['tuple(tuple(address,address,address,address,uint24,bytes32) poolKey, bool swapForY, uint128 amountIn, uint128 amountOutMin, bytes hookData)'],
            [{ poolKey, swapForY, amountIn, amountOutMin, hookData }]
        );
    },

    encodeBinSwapExactOutputSingleParams(poolKey, swapForY, amountInMaximum, amountOut, hookData) {
        return ethers.utils.defaultAbiCoder.encode(
            ['tuple(tuple(address,address,address,address,uint24,bytes32) poolKey, bool swapForY, uint128 amountOut, uint128 amountInMaximum, bytes hookData)'],
            [{ poolKey, swapForY, amountOut, amountInMaximum, hookData }]
        );
    },

    swap(plan, poolKey, swapForY, hookData, swapData) {
        if (swapData.amountIn && swapData.amountOutMin) {
            const encodedParams = this.encodeBinSwapExactInputSingleParams(poolKey, swapForY, swapData.amountIn, swapData.amountOutMin, hookData);
            return plan.add(Actions.BIN_SWAP_EXACT_IN_SINGLE, encodedParams);
        } else if (swapData.amountInMax && swapData.amountOut) {
            const encodedParams = this.encodeBinSwapExactOutputSingleParams(poolKey, swapForY, swapData.amountInMax, swapData.amountOut, hookData);
            return plan.add(Actions.BIN_SWAP_EXACT_OUT_SINGLE, encodedParams);
        } else {
            throw new Error('BinSwapExactInput and BinSwapExactOutput are not implemented');
        }
    },

    removeLiquidity(plan, poolKey, amount0Min, amount1Min, ids, amounts, from) {
        const encodedParams = this.encodeBinRemoveLiquidityParams(poolKey, amount0Min, amount1Min, ids, amounts, from);
        return plan.add(Actions.BIN_REMOVE_LIQUIDITY, encodedParams);
    },

    finalizeModifyLiquidityWithTake(plan, poolKey, takeRecipient) {
        plan.add(Actions.TAKE, ethers.utils.defaultAbiCoder.encode(['address', 'address', 'uint256'], [poolKey.currency0, takeRecipient, ActionConstants.OPEN_DELTA]));
        plan.add(Actions.TAKE, ethers.utils.defaultAbiCoder.encode(['address', 'address', 'uint256'], [poolKey.currency1, takeRecipient, ActionConstants.OPEN_DELTA]));
        return plan.encode();
    },

    finalizeModifyLiquidityWithClose(plan, poolKey) {
        plan.add(Actions.CLOSE_CURRENCY, ethers.utils.defaultAbiCoder.encode(['address'], [poolKey.currency0]));
        plan.add(Actions.CLOSE_CURRENCY, ethers.utils.defaultAbiCoder.encode(['address'], [poolKey.currency1]));
        return plan.encode();
    },

    finalizeModifyLiquidityWithSettlePair(plan, poolKey) {
        plan.add(Actions.SETTLE_PAIR, ethers.utils.defaultAbiCoder.encode(['address', 'address'], [poolKey.currency0, poolKey.currency1]));
        return plan.encode();
    },

    finalizeModifyLiquidityWithTakePair(plan, poolKey, takeRecipient) {
        plan.add(Actions.TAKE_PAIR, ethers.utils.defaultAbiCoder.encode(['address', 'address', 'address'], [poolKey.currency0, poolKey.currency1, takeRecipient]));
        return plan.encode();
    },

    finalizeSwap(plan, inputCurrency, outputCurrency, takeRecipient) {
        if (takeRecipient === ActionConstants.MSG_SENDER) {
            plan.add(Actions.SETTLE_TAKE_PAIR, ethers.utils.defaultAbiCoder.encode(['address', 'address'], [inputCurrency, outputCurrency]));
        } else {
            plan.add(Actions.SETTLE, ethers.utils.defaultAbiCoder.encode(['address', 'uint256', 'bool'], [inputCurrency, ActionConstants.OPEN_DELTA, true]));
            plan.add(Actions.TAKE, ethers.utils.defaultAbiCoder.encode(['address', 'address', 'uint256'], [outputCurrency, takeRecipient, ActionConstants.OPEN_DELTA]));
        }
        return plan.encode();
    }
};
