/* global BigInt */


import {
    MaxAllowanceTransferAmount, AllowanceProvider, AllowanceTransfer
} from '@uniswap/permit2-sdk/dist/index.js'

/// Checks if any allowance is set for permit2 contract for the given token
/// If not, it creates an allowance of type `MaxAllowanceTransferAmount`
export const addPermitAllowanceIfNeeded = async (signer, token, permit2contract) => {
    const allowance = await token.allowance(await signer.getAddress(), permit2contract.address)

    if (allowance > 0) {
        return
    }

    const tx = await token.connect(signer).approve(permit2contract.address, MaxAllowanceTransferAmount)
    await tx.wait()
}

function toDeadline(expiration) {
    return Math.floor((Date.now() + expiration) / 1000)
}

export const singlePermit = async (provider, permit2contract, token, spender) => {
    const signer = provider.getSigner();
    const allowanceProvider = new AllowanceProvider(
        signer,
        permit2contract.address
    );

    const account = await signer.getAddress();
    const deadline = toDeadline(1000 * 60 * 60 * 24 * 30);

    const {
        nonce,
    } = await allowanceProvider.getAllowanceData(
        token.address,
        account,
        spender
    )


    const permitSingle = {
        details: {
            token: token.address,
            amount: MaxAllowanceTransferAmount,
            expiration: deadline,
            nonce,
        },
        spender: spender,
        sigDeadline: deadline
    }

    const { domain, types, values } = AllowanceTransfer.getPermitData(
        permitSingle,
        permit2contract.address,
        (await provider.getNetwork()).chainId
    )


    const signature = await signer._signTypedData(domain, types, values)
    return { permitSingle, signature }
}
