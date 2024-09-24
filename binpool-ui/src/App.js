import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';

import AllowlistHookABI from './abi/AllowlistHook.json';
import BinPoolManagerABI from './abi/BinPoolManager.json';
import BinPositionManagerABI from './abi/BinPositionManager.json';
import Permit2ABI from './abi/Permit2.json';
import ERC20ABI from './abi/ERC20.json';
import HookABI from './abi/Hook.json';

import addLiquidity from './addLiquidity';
import removeLiquidity from './removeLiquidity';
import { addPermitAllowanceIfNeeded, singlePermit } from './createPermit';


const ALLOWLIST_HOOK_ADDRESS = '0xCcE8baE0D9b5C1F2Eb13A55c62F4Fb2b39b434F6';
const BIN_POSITION_MANAGER_ADDRESS = '0xfB84c0D67f217f078E949d791b8d3081FE91Bca2';
const PERMIT2_ADDRESS = '0x31c2F6fcFf4F8759b3Bd5Bf0e1084A055615c768';

const toPoolId = (poolKey) => {
  return ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      ['address', 'address', 'address', 'address', 'uint24', 'bytes32'],
      [
        poolKey.currency0,
        poolKey.currency1,
        poolKey.hooks,
        poolKey.poolManager,
        poolKey.fee,
        poolKey.parameters
      ]
    )
  );
};

export default function AllowlistHookUI() {
  const [provider, setProvider] = useState(null);
  const [signer, setSigner] = useState(null);
  const [allowlistHookContract, setAllowlistHookContract] = useState(null);
  const [binPoolManagerContract, setBinPoolManagerContract] = useState(null);
  const [binPositionManagerContract, setBinPositionManagerContract] = useState(null);
  const [token1Contract, setToken1Contract] = useState(null);
  const [token0Contract, setToken0Contract] = useState(null);
  const [owner, setOwner] = useState('');
  const [poolKey, setPoolKey] = useState(null);
  const [poolId, setPoolId] = useState(null);
  const [activeId, setActiveId] = useState(0);
  const [protocolFee, setProtocolFee] = useState(0);
  const [lpFee, setLpFee] = useState(0);
  const [binInfo, setBinInfo] = useState(null);
  const [token0, setToken0] = useState(null);
  const [token1, setToken1] = useState(null);

  const [amount0, setAmount0] = useState('');
  const [amount1, setAmount1] = useState('');
  const [amount0Min, setAmount0Min] = useState('');
  const [amount1Min, setAmount1Min] = useState('');
  const [activeIdDesired, setActiveIdDesired] = useState('');
  const [idSlippage, setIdSlippage] = useState('10');
  const [deltaIds, setDeltaIds] = useState('');
  const [distributionX, setDistributionX] = useState('');
  const [distributionY, setDistributionY] = useState('');
  const [txHash, setTxHash] = useState('');
  const [error, setError] = useState('');

  // New state variables for remove liquidity
  const [removeIds, setRemoveIds] = useState('');
  const [removeAmounts, setRemoveAmounts] = useState('');
  const [removeAmount0Min, setRemoveAmount0Min] = useState('');
  const [removeAmount1Min, setRemoveAmount1Min] = useState('');

  // Add a new state for the address input
  const [addressInput, setAddressInput] = useState('');

  useEffect(() => {
    const init = async () => {
      if (typeof window.ethereum !== 'undefined') {
        const provider = new ethers.providers.Web3Provider(window.ethereum);
        await provider.send("eth_requestAccounts", []);
        const signer = provider.getSigner();
        setProvider(provider);
        setSigner(signer);

        const allowlistHookContract = new ethers.Contract(ALLOWLIST_HOOK_ADDRESS, AllowlistHookABI.abi, signer);
        setAllowlistHookContract(allowlistHookContract);

        const binPositionManagerContract = new ethers.Contract(BIN_POSITION_MANAGER_ADDRESS, BinPositionManagerABI, signer);
        setBinPositionManagerContract(binPositionManagerContract);

        const owner = await allowlistHookContract.owner();
        setOwner(owner);

        const poolKey = await allowlistHookContract.poolKey();
        setPoolKey(poolKey);

        const computedPoolId = toPoolId(poolKey);
        setPoolId(computedPoolId);


        const binPoolManagerContract = new ethers.Contract(poolKey.poolManager, BinPoolManagerABI, signer);
        setBinPoolManagerContract(binPoolManagerContract);

        const [activeId, protocolFee, lpFee] = await binPoolManagerContract.getSlot0(computedPoolId);
        setActiveId(activeId);
        setProtocolFee(protocolFee);
        setLpFee(lpFee);

        const [binReserveX, binReserveY, binLiquidity, totalShares] = await binPoolManagerContract.getBin(computedPoolId, activeId);
        setBinInfo({ binReserveX, binReserveY, binLiquidity, totalShares });

        console.log(binLiquidity.toString());

        // Fetch token information
        const token0Contract = new ethers.Contract(poolKey.currency0, ERC20ABI.abi, provider);
        const token1Contract = new ethers.Contract(poolKey.currency1, ERC20ABI.abi, provider);

        setToken0Contract(token0Contract);
        setToken1Contract(token1Contract);

        const [name0, symbol0, decimals0] = await Promise.all([
          token0Contract.name(),
          token0Contract.symbol(),
          token0Contract.decimals()
        ]);

        const [name1, symbol1, decimals1] = await Promise.all([
          token1Contract.name(),
          token1Contract.symbol(),
          token1Contract.decimals()
        ]);

        setToken0({ address: poolKey.currency0, name: name0, symbol: symbol0, decimals: decimals0, contract: token0Contract });
        setToken1({ address: poolKey.currency1, name: name1, symbol: symbol1, decimals: decimals1, contract: token1Contract });

      }
    };

    init();
  }, []);

  const handleError = (err, operation) => {
    let errorMessage = `An error occurred while ${operation}`;
    if (err.error && err.error.data && err.error.data.data) {
      try {
        const revertData = err.error.data.data;
        let decodedError = null;

        // Try to decode error using different contract interfaces
        const hookContract = new ethers.Contract(poolKey.hooks, HookABI, signer);
        const contracts = [binPositionManagerContract, binPoolManagerContract, allowlistHookContract];
        for (const contract of contracts) {
          if (contract) {
            try {
              decodedError = contract.interface.parseError(revertData);
              if (decodedError) break;
            } catch (e) {
            }
          }
        }

        if (!decodedError) {
          decodedError = hookContract.interface.parseError(revertData);
          if (decodedError) {

            return handleError({ error: { data: { data: decodedError.args.revertReason } } }, 'decoding error');
          }
        }


        if (decodedError) {
          errorMessage = `${decodedError.name}: ${decodedError.args.join(', ')}`;
        } else {
          errorMessage = `Failed to decode error: Raw code: ${revertData}`;
        }
      } catch (decodeError) {
        console.log('Error decoding:', decodeError);
        errorMessage = `Failed to decode error: Raw code: ${err.error.data.data}`;
      }
    } else if (err.message) {
      errorMessage = err.message;
    }

    setError(errorMessage);
  };

  const handleAddLiquidity = async () => {
    const formattedAmount0 = ethers.utils.parseUnits(amount0, token0.decimals);
    const formattedAmount1 = ethers.utils.parseUnits(amount1, token1.decimals);
    const formattedAmount0Min = ethers.utils.parseUnits(amount0Min, token0.decimals);
    const formattedAmount1Min = ethers.utils.parseUnits(amount1Min, token1.decimals);

    const formattedDeltaIds = deltaIds.split(',');
    const formattedDistributionX = distributionX.split(',').map(d => ethers.utils.parseEther(d));
    const formattedDistributionY = distributionY.split(',').map(d => ethers.utils.parseEther(d));

    const permit2Contract = new ethers.Contract(PERMIT2_ADDRESS, Permit2ABI.abi, signer);
    await addPermitAllowanceIfNeeded(signer, token1Contract, permit2Contract);
    await addPermitAllowanceIfNeeded(signer, token0Contract, permit2Contract);

    try {
      const receipt = await addLiquidity(
        signer,
        binPositionManagerContract,
        poolKey,
        formattedAmount0,
        formattedAmount1,
        formattedAmount0Min,
        formattedAmount1Min,
        activeIdDesired,
        idSlippage,
        formattedDeltaIds,
        formattedDistributionX,
        formattedDistributionY,
        Math.floor(Date.now()) + 3600000, // deadline: 1 hour from now,
        await singlePermit(provider, permit2Contract, token0Contract, binPositionManagerContract.address),
        await singlePermit(provider, permit2Contract, token1Contract, binPositionManagerContract.address)
      );
      console.log('Liquidity added successfully:', receipt.hash);
      setTxHash(receipt.hash);
    } catch (err) {
      handleError(err, 'adding liquidity');
    }
  };

  const handleRemoveLiquidity = async () => {
    const formattedRemoveIds = removeIds.split(',').map(id => parseInt(id.trim()));
    const formattedRemoveAmounts = removeAmounts.split(',').map(amount => ethers.utils.parseUnits(amount.trim(), 18));
    const formattedRemoveAmount0Min = ethers.utils.parseUnits(removeAmount0Min, token0.decimals);
    const formattedRemoveAmount1Min = ethers.utils.parseUnits(removeAmount1Min, token1.decimals);

    // const permit2Contract = new ethers.Contract(PERMIT2_ADDRESS, Permit2ABI.abi, signer);

    try {
      const receipt = await removeLiquidity(
        signer,
        binPositionManagerContract,
        poolKey,
        formattedRemoveAmount0Min,
        formattedRemoveAmount1Min,
        formattedRemoveIds,
        formattedRemoveAmounts,
        Math.floor(Date.now()) + 3600000, // deadline: 1 hour from now
        // await singlePermit(provider, permit2Contract, token0Contract, binPositionManagerContract.address),
        // await singlePermit(provider, permit2Contract, token1Contract, binPositionManagerContract.address)
      );
      console.log('Liquidity removed successfully:', receipt.hash);
      setTxHash(receipt.hash);
    } catch (err) {
      handleError(err, 'removing liquidity');
    }
  };

  const checkBanned = async () => {
    if (addressInput) {
      const isBanned = await allowlistHookContract.banned(addressInput);
      alert(`Address ${addressInput} is ${isBanned ? 'banned' : 'not banned'}`);
    } else {
      alert("Please enter an address to check.");
    }
  };

  const addToBlacklist = async () => {
    if (addressInput) {
      try {
        const tx = await allowlistHookContract.ban(addressInput);
        await tx.wait();
        alert(`Address ${addressInput} has been added to the blacklist.`);
      } catch (error) {
        console.error("Error adding address to blacklist:", error);
        alert(`Failed to add ${addressInput} to the blacklist. Error: ${error.message}`);
      }
    } else {
      alert("Please enter an address to add to the blacklist.");
    }
  };

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '20px', fontFamily: 'Arial, sans-serif' }}>
      <h1 style={{ textAlign: 'center', color: '#333' }}>AllowlistHook Pool Interface</h1>

      <div style={{ background: '#f0f0f0', padding: '15px', borderRadius: '5px', marginBottom: '20px' }}>
        <h2 style={{ marginTop: 0 }}>Contract Info</h2>
        <p><strong>AllowlistHook Address:</strong> {ALLOWLIST_HOOK_ADDRESS}</p>
        <p><strong>Owner:</strong> {owner}</p>
        <input
          type="text"
          placeholder="Enter address"
          value={addressInput}
          onChange={(e) => setAddressInput(e.target.value)}
          style={{ width: '100%', padding: '5px', marginBottom: '10px' }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <button onClick={checkBanned} style={{ padding: '5px 10px', cursor: 'pointer', marginRight: '10px' }}>
            Check if Address is Banned
          </button>
          <button onClick={addToBlacklist} style={{ padding: '5px 10px', cursor: 'pointer', backgroundColor: '#ff4444', color: 'white', border: 'none' }}>
            Add to Blacklist
          </button>
        </div>
      </div>

      {poolKey && token0 && token1 && (
        <div style={{ background: '#e6f7ff', padding: '15px', borderRadius: '5px', marginBottom: '20px' }}>
          <h2 style={{ marginTop: 0 }}>Pool Information</h2>
          <p><strong>BinPoolManager contract:</strong> {poolKey.poolManager}</p>
          <p><strong>{token0.symbol}:</strong> {token0.name} ({token0.address})</p>
          <p><strong>{token1.symbol}:</strong> {token1.name} ({token1.address})</p>
          <p><strong>Fee:</strong> {ethers.utils.formatUnits(poolKey.fee, 4)}%</p>
          <p><strong>Pool ID:</strong> {poolId}</p>
        </div>
      )}

      <div style={{ background: '#fff3e0', padding: '15px', borderRadius: '5px', marginBottom: '20px' }}>
        <h2 style={{ marginTop: 0 }}>Current Pool State</h2>
        <p><strong>Active ID:</strong> {activeId.toString()}</p>
        <p><strong>Protocol Fee:</strong> {ethers.utils.formatUnits(protocolFee, 4)}%</p>
        <p><strong>LP Fee:</strong> {ethers.utils.formatUnits(lpFee, 4)}%</p>

        {binInfo && (
          <>
            <p><strong>Bin Reserve {token0?.symbol}:</strong> {ethers.utils.formatUnits(binInfo.binReserveX, token0?.decimals)}</p>
            <p><strong>Bin Reserve {token1?.symbol}:</strong> {ethers.utils.formatUnits(binInfo.binReserveY, token1?.decimals)}</p>
            <p><strong>Bin Liquidity:</strong> {ethers.utils.formatUnits(binInfo.binLiquidity, 18)}</p>
            <p><strong>Total Shares:</strong> {ethers.utils.formatUnits(binInfo.totalShares, 18)}</p>
          </>
        )}
      </div>

      {error && (
        <div style={{
          background: '#ffebee',
          color: '#c62828',
          padding: '10px',
          marginBottom: '20px',
          borderRadius: '5px',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word'
        }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <div style={{ background: '#e8f5e9', padding: '15px', borderRadius: '5px', width: '48%' }}>
          <h2 style={{ marginTop: 0 }}>Add Liquidity</h2>
          <input
            type="text"
            placeholder={`Amount of ${token0?.symbol || 'token0'}`}
            value={amount0}
            onChange={(e) => setAmount0(e.target.value)}
            style={{ width: '98%', padding: '5px', marginBottom: '10px' }}
          />
          <input
            type="text"
            placeholder={`Amount of ${token1?.symbol || 'token1'}`}
            value={amount1}
            onChange={(e) => setAmount1(e.target.value)}
            style={{ width: '98%', padding: '5px', marginBottom: '10px' }}
          />
          <input
            type="text"
            placeholder={`Min amount of ${token0?.symbol || 'token0'}`}
            value={amount0Min}
            onChange={(e) => setAmount0Min(e.target.value)}
            style={{ width: '98%', padding: '5px', marginBottom: '10px' }}
          />
          <input
            type="text"
            placeholder={`Min amount of ${token1?.symbol || 'token1'}`}
            value={amount1Min}
            onChange={(e) => setAmount1Min(e.target.value)}
            style={{ width: '98%', padding: '5px', marginBottom: '10px' }}
          />
          <input
            type="text"
            placeholder="Active ID Desired"
            value={activeIdDesired}
            onChange={(e) => setActiveIdDesired(e.target.value)}
            style={{ width: '98%', padding: '5px', marginBottom: '10px' }}
          />
          <input
            type="text"
            placeholder="ID Slippage"
            value={idSlippage}
            onChange={(e) => setIdSlippage(e.target.value)}
            style={{ width: '98%', padding: '5px', marginBottom: '10px' }}
          />
          <input
            type="text"
            placeholder="Delta IDs (comma-separated)"
            value={deltaIds}
            onChange={(e) => setDeltaIds(e.target.value)}
            style={{ width: '98%', padding: '5px', marginBottom: '10px' }}
          />
          <input
            type="text"
            placeholder="Distribution X (comma-separated percentages)"
            value={distributionX}
            onChange={(e) => setDistributionX(e.target.value)}
            style={{ width: '98%', padding: '5px', marginBottom: '10px' }}
          />
          <input
            type="text"
            placeholder="Distribution Y (comma-separated percentages)"
            value={distributionY}
            onChange={(e) => setDistributionY(e.target.value)}
            style={{ width: '98%', padding: '5px', marginBottom: '10px' }}
          />
          <button
            onClick={handleAddLiquidity}
            style={{ width: '98%', padding: '10px', cursor: 'pointer', background: '#4CAF50', color: 'white', border: 'none', borderRadius: '5px' }}
          >
            Add Liquidity
          </button>
        </div>

        {/* Add a small gap here */}
        <div style={{ width: '1%' }}></div>

        <div style={{ background: '#ffebee', padding: '15px', borderRadius: '5px', width: '48%' }}>
          <h2 style={{ marginTop: 0, color: '#b71c1c' }}>Remove Liquidity</h2>
          <input
            type="text"
            placeholder="IDs to remove (comma-separated)"
            value={removeIds}
            onChange={(e) => setRemoveIds(e.target.value)}
            style={{ width: '98%', padding: '5px', marginBottom: '10px' }}
          />
          <input
            type="text"
            placeholder="Amounts to remove in percent (comma-separated)"
            value={removeAmounts}
            onChange={(e) => setRemoveAmounts(e.target.value)}
            style={{ width: '98%', padding: '5px', marginBottom: '10px' }}
          />
          <input
            type="text"
            placeholder={`Min amount of ${token0?.symbol || 'token0'} to receive`}
            value={removeAmount0Min}
            onChange={(e) => setRemoveAmount0Min(e.target.value)}
            style={{ width: '98%', padding: '5px', marginBottom: '10px' }}
          />
          <input
            type="text"
            placeholder={`Min amount of ${token1?.symbol || 'token1'} to receive`}
            value={removeAmount1Min}
            onChange={(e) => setRemoveAmount1Min(e.target.value)}
            style={{ width: '98%', padding: '5px', marginBottom: '10px' }}
          />
          <button
            onClick={handleRemoveLiquidity}
            style={{ width: '98%', padding: '10px', cursor: 'pointer', background: '#c62828', color: 'white', border: 'none', borderRadius: '5px' }}
          >
            Remove Liquidity
          </button>
        </div>
      </div>

      {txHash && (
        <div style={{ background: '#e8f5e9', color: '#1b5e20', padding: '10px', marginTop: '20px', borderRadius: '5px' }}>
          <p><strong>Success:</strong> Liquidity added successfully.</p>
          <p><strong>Transaction Hash:</strong> {txHash}</p>
        </div>
      )}
    </div>
  );
}
