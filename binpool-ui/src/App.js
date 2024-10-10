import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import Slider from "react-slick";
import "slick-carousel/slick/slick.css";
import "slick-carousel/slick/slick-theme.css";

import AllowlistHookABI from './abi/AllowlistHook.json';
import BinPoolManagerABI from './abi/BinPoolManager.json';
import BinPositionManagerABI from './abi/BinPositionManager.json';
import Permit2ABI from './abi/Permit2.json';
import ERC20ABI from './abi/ERC20.json';
import HookABI from './abi/Hook.json';
import UniversalRouterABI from './abi/UniversalRouter.json';


import addLiquidity from './commands/addLiquidity';
import removeLiquidity from './commands/removeLiquidity';
import { addPermitAllowanceIfNeeded, singlePermit } from './commands/createPermit';
import { swapTokens } from './commands/performSwap';
import BinPoolABI from './abi/BinPool.json';

const PROXY_HOOK_ADDRESS = '0xEc3c86a0Fb60833A896c8e755aAAD865de8066C5';
const BIN_POSITION_MANAGER_ADDRESS = '0xfB84c0D67f217f078E949d791b8d3081FE91Bca2';
const PERMIT2_ADDRESS = '0x31c2F6fcFf4F8759b3Bd5Bf0e1084A055615c768';
const UNIVERSAL_ROUTER_ADDRESS = '0x30067B296Edf5BEbB1CB7b593898794DDF6ab7c5';
const BIN_STEP = 1;

const calculatePrice = (id, token0, token1) => {
  const ID_BASE = 8388608;
  const decimalDifference = (token1?.decimals ?? 0) - (token0?.decimals ?? 0);
  const price = Math.pow((1 + BIN_STEP / 10000), (id - ID_BASE));
  return price / Math.pow(10, decimalDifference);
}

const calculateBinFromPrice = (price, token0, token1) => {
  if (!price || isNaN(price) || price <= 0) return null;
  const ID_BASE = 8388608;

  const decimalDifference = (token1?.decimals ?? 0) - (token0?.decimals ?? 0);

  const adjustedPrice = price * Math.pow(10, decimalDifference);
  const binId = Math.round(Math.log(adjustedPrice) / Math.log(1 + BIN_STEP / 10000) + ID_BASE);

  return binId;
}

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

const BinCards = ({ bins, token0, token1, activeId }) => {
  const settings = {
    dots: true,
    infinite: false,
    speed: 500,
    slidesToShow: 1,
    slidesToScroll: 1,
    adaptiveHeight: true
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text).then(() => {
    }).catch(err => {
      console.error('Failed to copy: ', err);
    });
  };

  return (
    <Slider {...settings}>
      {bins.map((bin) => (
        <div key={bin.id}>
          <div style={{
            padding: '20px',
            background: '#f0f0f0',
            borderRadius: '10px',
            margin: '10px',
            boxShadow: '0 4px 8px rgba(0,0,0,0.1)'
          }}>
            <h3 style={{ color: '#333', }}>
              Bin ID: {bin.id}
              <button onClick={() => copyToClipboard(bin.id.toString())} style={copyButtonStyle}>Copy</button>
            </h3>
            <h3 style={{ color: '#333', borderBottom: '2px solid #ddd', paddingBottom: '10px' }}>
              Delta from active: {bin.id - activeId}
              <button onClick={() => copyToClipboard((bin.id - activeId).toString())} style={copyButtonStyle}>Copy</button>
            </h3>
            <p>
              <strong>Price:</strong> {calculatePrice(bin.id, token0, token1).toFixed(6)} {token1?.symbol}/{token0?.symbol}
              <button onClick={() => copyToClipboard(calculatePrice(bin.id, token0, token1).toFixed(6))} style={copyButtonStyle}>Copy</button>
            </p>
            <p>
              <strong>Reserve {token0?.symbol}:</strong> {ethers.utils.formatUnits(bin.reserveX, token0?.decimals)}
              <button onClick={() => copyToClipboard(ethers.utils.formatUnits(bin.reserveX, token0?.decimals))} style={copyButtonStyle}>Copy</button>
            </p>
            <p>
              <strong>Reserve {token1?.symbol}:</strong> {ethers.utils.formatUnits(bin.reserveY, token1?.decimals)}
              <button onClick={() => copyToClipboard(ethers.utils.formatUnits(bin.reserveY, token1?.decimals))} style={copyButtonStyle}>Copy</button>
            </p>
            <p>
              <strong>Liquidity:</strong> {ethers.utils.formatUnits(bin.liquidity, 18)}
              <button onClick={() => copyToClipboard(ethers.utils.formatUnits(bin.liquidity, 18))} style={copyButtonStyle}>Copy</button>
            </p>
            <p>
              <strong>Total Shares:</strong> {ethers.utils.formatUnits(bin.totalShares, 18)}
              <button onClick={() => copyToClipboard(ethers.utils.formatUnits(bin.totalShares, 18))} style={copyButtonStyle}>Copy</button>
            </p>
          </div>
        </div>
      ))
      }
    </Slider >
  );
};

const copyButtonStyle = {
  marginLeft: '10px',
  padding: '2px 5px',
  fontSize: '0.8em',
  cursor: 'pointer',
  background: '#4CAF50',
  color: 'white',
  border: 'none',
  borderRadius: '3px'
};

export default function AllowlistHookUI() {
  const [provider, setProvider] = useState(null);
  const [signer, setSigner] = useState(null);
  const [allowlistHookContract, setAllowlistHookContract] = useState(null);
  const [binPoolManagerContract, setBinPoolManagerContract] = useState(null);
  const [binPositionManagerContract, setBinPositionManagerContract] = useState(null);
  const [universalRouterContract, setUniversalRouterContract] = useState(null);

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
  const [amount0Max, setAmount0Max] = useState('');
  const [amount1Max, setAmount1Max] = useState('');
  const [activeIdDesired, setActiveIdDesired] = useState('');
  const [idSlippage, setIdSlippage] = useState('10');
  const [deltaIds, setDeltaIds] = useState('0');
  const [distributionX, setDistributionX] = useState('1');
  const [distributionY, setDistributionY] = useState('1');
  const [txHash, setTxHash] = useState('');
  const [error, setError] = useState('');

  // New state variables for remove liquidity
  const [removeIds, setRemoveIds] = useState('');
  const [removeAmounts, setRemoveAmounts] = useState('');
  const [removeAmount0Min, setRemoveAmount0Min] = useState('');
  const [removeAmount1Min, setRemoveAmount1Min] = useState('');

  // Add a new state for the address input
  const [addressInput, setAddressInput] = useState('');

  // New state variables for swap
  const [swapAmount, setSwapAmount] = useState('');
  const [swapAmountMin, setSwapAmountMin] = useState('');
  const [isExactInput, setIsExactInput] = useState(true);
  const [swapForY, setSwapForY] = useState(true);

  const [userAddress, setUserAddress] = useState('Not connected');
  const [userToken0Balance, setUserToken0Balance] = useState('');
  const [userToken1Balance, setUserToken1Balance] = useState('');

  // Add new state variables for price display
  const [removeIdsPrice, setRemoveIdsPrice] = useState([]);

  // Add new state variables for price input
  const [priceInput, setPriceInput] = useState('');
  const [calculatedBinId, setCalculatedBinId] = useState(null);

  // New state variable to store all bin information
  const [allBins, setAllBins] = useState([]);

  // Add a new state variable for delta ID prices
  const [deltaIdPrices, setDeltaIdPrices] = useState([]);

  const fetchAllBins = async () => {
    if (!binPoolManagerContract || !poolId) return;

    const bins = [];
    let currentBinId = activeId;
    const MAX_BINS = 100; // Limit the number of bins to fetch to avoid infinite loops

    for (let i = 0; i < MAX_BINS; i++) {
      try {
        const [binReserveX, binReserveY, binLiquidity, totalShares] = await binPoolManagerContract.getBin(poolId, currentBinId);
        bins.push({
          id: currentBinId,
          reserveX: binReserveX,
          reserveY: binReserveY,
          liquidity: binLiquidity,
          totalShares: totalShares,
        });

        // Get the next non-empty bin
        currentBinId = await binPoolManagerContract.getNextNonEmptyBin(poolId, true, currentBinId);
      } catch (error) {
        break;
      }
    }

    currentBinId = activeId;
    for (let i = 0; i < MAX_BINS; i++) {
      try {
        const [binReserveX, binReserveY, binLiquidity, totalShares] = await binPoolManagerContract.getBin(poolId, currentBinId);
        if (currentBinId !== activeId) {
          bins.push({
            id: currentBinId,
            reserveX: binReserveX,
            reserveY: binReserveY,
            liquidity: binLiquidity,
            totalShares: totalShares,
          });
        }

        // Get the next non-empty bin
        currentBinId = await binPoolManagerContract.getNextNonEmptyBin(poolId, false, currentBinId);
      } catch (error) {
        break;
      }
    }

    bins.sort((a, b) => a.id - b.id);

    setAllBins(bins);
  };

  useEffect(() => {
    const init = async () => {
      if (typeof window.ethereum !== 'undefined') {
        const provider = new ethers.providers.Web3Provider(window.ethereum);
        await provider.send("eth_requestAccounts", []);
        const signer = provider.getSigner();
        setProvider(provider);
        setSigner(signer);

        const userAddress = await signer.getAddress();
        setUserAddress(userAddress);

        const allowlistHookContract = new ethers.Contract(PROXY_HOOK_ADDRESS, AllowlistHookABI.abi, signer);
        setAllowlistHookContract(allowlistHookContract);

        const binPositionManagerContract = new ethers.Contract(BIN_POSITION_MANAGER_ADDRESS, BinPositionManagerABI, signer);
        setBinPositionManagerContract(binPositionManagerContract);

        const universalRouterContract = new ethers.Contract(UNIVERSAL_ROUTER_ADDRESS, UniversalRouterABI, signer);
        setUniversalRouterContract(universalRouterContract);

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
        setActiveIdDesired(activeId);
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

        // Fetch user balances
        const balance0 = await token0Contract.balanceOf(userAddress);
        const balance1 = await token1Contract.balanceOf(userAddress);
        setUserToken0Balance(ethers.utils.formatUnits(balance0, decimals0));
        setUserToken1Balance(ethers.utils.formatUnits(balance1, decimals1));
      }
    };

    init();
  }, []);

  useEffect(() => {
    fetchAllBins();
  }, [binPoolManagerContract, poolId, activeId]);

  const handleError = (err, operation) => {
    let errorMessage = `An error occurred while ${operation}`;
    if (err.error && err.error.data && err.error.data.data) {
      try {
        const revertData = err.error.data.data;
        let decodedError = null;

        // Try to decode error using different contract interfaces
        const hookContract = new ethers.Contract(poolKey.hooks, HookABI, signer);
        const binPoolContract = new ethers.Contract(poolKey.poolManager, BinPoolABI, signer);
        const contracts = [binPositionManagerContract, binPoolManagerContract, allowlistHookContract, universalRouterContract, binPoolContract];
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
    const formattedAmount0Max = ethers.utils.parseUnits(amount0Max, token0.decimals);
    const formattedAmount1Max = ethers.utils.parseUnits(amount1Max, token1.decimals);

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
        formattedAmount0Max,
        formattedAmount1Max,
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
      await updateUserBalances(); // Update balances after successful add liquidity
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
      await updateUserBalances(); // Update balances after successful remove liquidity
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

  const handleSwap = async () => {
    try {
      const tokenIn = swapForY ? token0Contract : token1Contract;
      const tokenOut = swapForY ? token1Contract : token0Contract;
      const permit2Contract = new ethers.Contract(PERMIT2_ADDRESS, Permit2ABI.abi, signer);

      // Create Permit2
      await addPermitAllowanceIfNeeded(signer, tokenIn, permit2Contract);
      const permit = await singlePermit(provider, permit2Contract, tokenIn, universalRouterContract.address);

      // Prepare swap data
      const swapData = isExactInput
        ? {
          amountIn: ethers.utils.parseUnits(swapAmount, await tokenIn.decimals()),
          amountOutMin: ethers.utils.parseUnits(swapAmountMin, await tokenOut.decimals())
        }
        : {
          amountOut: ethers.utils.parseUnits(swapAmount, await tokenOut.decimals()),
          amountInMax: ethers.utils.parseUnits(swapAmountMin, await tokenIn.decimals())
        };

      // Set deadline (e.g., 30 minutes from now)
      const deadline = Math.floor(Date.now() / 1000) + 30 * 60;

      // Execute swap
      const receipt = await swapTokens(
        universalRouterContract,
        poolKey,
        swapForY,
        swapData,
        deadline,
        permit
      );

      console.log('Swap successful:', receipt.transactionHash);
      setTxHash(receipt.transactionHash);
      await updateUserBalances(); // Update balances after successful swap
    } catch (error) {
      console.error('Error performing swap:', error);
      handleError(error, 'performing swap');
    }
  };

  // Add this function inside your component, before the return statement

  const updateUserBalances = async () => {
    if (userAddress && token0Contract && token1Contract) {
      const balance0 = await token0Contract.balanceOf(userAddress);
      const balance1 = await token1Contract.balanceOf(userAddress);
      setUserToken0Balance(ethers.utils.formatUnits(balance0, token0.decimals));
      setUserToken1Balance(ethers.utils.formatUnits(balance1, token1.decimals));
    }
  };


  // Update this function to calculate and set price when activeIdDesired changes
  const handleDeltaIdsChange = (e) => {
    const value = e.target.value;
    setDeltaIds(value);
    updateDeltaIdPrices(value, activeIdDesired);
  };

  // Add this new function to handle activeIdDesired changes
  const handleActiveIdDesiredChange = (e) => {
    const value = e.target.value;
    setActiveIdDesired(value);
    updateDeltaIdPrices(deltaIds, value);
  };

  // Add this new function to update deltaIdPrices
  const updateDeltaIdPrices = (deltaIdsValue, activeIdDesiredValue) => {
    if (deltaIdsValue && activeIdDesiredValue) {
      const desiredActiveId = parseInt(activeIdDesiredValue);
      const deltaValues = deltaIdsValue.split(',').map(id => id.trim());
      const prices = deltaValues.map(delta => {
        if (!isNaN(delta)) {
          const binId = desiredActiveId + parseInt(delta);
          return calculatePrice(binId, token0, token1);
        }
        return null;
      });
      setDeltaIdPrices(prices);
    } else {
      setDeltaIdPrices([]);
    }
  };

  // Update this function to calculate and set prices when removeIds change
  const handleRemoveIdsChange = (e) => {
    const value = e.target.value;
    setRemoveIds(value);
    if (value) {
      const ids = value.split(',').map(id => id.trim());
      const prices = ids.map(id => {
        if (!isNaN(id)) {
        }
        return null;
      });
      setRemoveIdsPrice(prices);
    } else {
      setRemoveIdsPrice([]);
    }
  }



  // Add this function to handle price input changes
  const handlePriceInputChange = (e) => {
    const value = e.target.value;
    setPriceInput(value);
    if (value && !isNaN(value)) {
      const binId = calculateBinFromPrice(parseFloat(value), token0, token1);
      setCalculatedBinId(binId);
    } else {
      setCalculatedBinId(null);
    }
  }

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '20px', fontFamily: 'Arial, sans-serif' }}>
      <h1 style={{ textAlign: 'center', color: '#333' }}>AllowlistHook Pool Interface</h1>

      {/* Contract Info section */}
      <div style={{ background: '#f0f0f0', padding: '15px', borderRadius: '5px', marginBottom: '20px' }}>
        <h2 style={{ marginTop: 0 }}>Contract Info</h2>
        <p><strong>AllowlistHook Address:</strong> {PROXY_HOOK_ADDRESS}</p>
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

      {/* User Info section */}
      <div style={{ background: '#e8eaf6', padding: '15px', borderRadius: '5px', marginBottom: '20px' }}>
        <h2 style={{ marginTop: 0 }}>User Info</h2>
        <p><strong>User Address:</strong> {userAddress}</p>
        <p><strong>Balance of {token0?.symbol || 'Token 1'}:</strong> {userToken0Balance}</p>
        <p><strong>Balance of {token1?.symbol || 'Token 2'}:</strong> {userToken1Balance}</p>
      </div>

      {poolKey && token0 && token1 && (
        <div style={{ background: '#e6f7ff', padding: '15px', borderRadius: '5px', marginBottom: '20px' }}>
          <h2 style={{ marginTop: 0 }}>Pool Information</h2>
          <p><strong>BinPoolManager contract:</strong> {poolKey.poolManager}</p>
          <p><strong>{token0.symbol}:</strong> {token0.name} ({token0.address})</p>
          <p><strong>{token1.symbol}:</strong> {token1.name} ({token1.address})</p>
          <p><strong>Fee:</strong> {ethers.utils.formatUnits(poolKey.fee, 4)}%</p>
          <p><strong>Pool ID:</strong> {poolId}</p>
          <p><strong>Active ID:</strong> {activeId.toString()}</p>
          <p><strong>Protocol Fee:</strong> {ethers.utils.formatUnits(protocolFee, 4)}%</p>
          <p><strong>LP Fee:</strong> {ethers.utils.formatUnits(lpFee, 4)}%</p>
        </div>
      )}

      {/* Pool Bins section */}
      <div style={{ background: '#fff3e0', padding: '15px', borderRadius: '5px', marginBottom: '20px' }}>
        <h2 style={{ marginTop: 0, color: '#e65100' }}>Pool Bins</h2>
        <BinCards bins={allBins} token0={token0} token1={token1} activeId={activeId} />
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
        {/* Add Liquidity section */}
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
            placeholder={`Max amount of ${token0?.symbol || 'token0'}`}
            value={amount0Max}
            onChange={(e) => setAmount0Max(e.target.value)}
            style={{ width: '98%', padding: '5px', marginBottom: '10px' }}
          />
          <input
            type="text"
            placeholder={`Max amount of ${token1?.symbol || 'token1'}`}
            value={amount1Max}
            onChange={(e) => setAmount1Max(e.target.value)}
            style={{ width: '98%', padding: '5px', marginBottom: '10px' }}
          />
          <input
            type="text"
            placeholder="Active ID Desired"
            value={activeIdDesired}
            onChange={handleActiveIdDesiredChange}
            style={{ width: '98%', padding: '5px', marginBottom: '10px' }}
          />
          <input
            type="text"
            placeholder="Delta IDs (comma-separated)"
            value={deltaIds}
            onChange={handleDeltaIdsChange}
            style={{ width: '98%', padding: '5px', marginBottom: '10px' }}
          />
          <input
            type="text"
            placeholder={`Distribution ${token0?.symbol} (comma-separated where 1 is 100%)`}
            value={distributionX}
            onChange={(e) => setDistributionX(e.target.value)}
            style={{ width: '98%', padding: '5px', marginBottom: '10px' }}
          />
          <input
            type="text"
            placeholder={`Distribution ${token1?.symbol} (comma-separated where 1 is 100%)`}
            value={distributionY}
            onChange={(e) => setDistributionY(e.target.value)}
            style={{ width: '98%', padding: '5px', marginBottom: '10px' }}
          />
          {deltaIdPrices.length > 0 && (
            <div style={{ marginBottom: '10px' }}>
              <strong>Approximate prices and distributions for delta IDs:</strong>
              <ul style={{ margin: '5px 0', paddingLeft: '20px' }}>
                {deltaIdPrices.map((price, index) => {
                  const deltaId = deltaIds.split(',')[index].trim();
                  const distributionXValue = distributionX.split(',')[index] || '0';
                  const distributionYValue = distributionY.split(',')[index] || '0';
                  return (
                    <li key={index}>
                      <strong>Delta ID {deltaId} - {parseInt(deltaId) + activeId}</strong>:
                      {price ? `${price.toFixed(6)} ${token1?.symbol}/${token0?.symbol}` : 'Invalid ID'}
                      <br />
                      Distribution: {parseFloat(distributionXValue) * 100}% {token0?.symbol},
                      {parseFloat(distributionYValue) * 100}% {token1?.symbol}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          <input
            type="text"
            placeholder="ID Slippage"
            value={idSlippage}
            onChange={(e) => setIdSlippage(e.target.value)}
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

        {/* Remove Liquidity section */}
        <div style={{ background: '#ffebee', padding: '15px', borderRadius: '5px', width: '48%' }}>
          <h2 style={{ marginTop: 0, color: '#b71c1c' }}>Remove Liquidity</h2>
          <input
            type="text"
            placeholder="IDs to remove (comma-separated)"
            value={removeIds}
            onChange={handleRemoveIdsChange}
            style={{ width: '98%', padding: '5px', marginBottom: '10px' }}
          />
          {removeIdsPrice.length > 0 && (
            <div style={{ marginBottom: '10px' }}>
              <strong>Approximate prices in these bins:</strong>
              <ul style={{ margin: '5px 0', paddingLeft: '20px' }}>
                {removeIdsPrice.map((price, index) => (
                  <li key={index}>
                    ID {removeIds.split(',')[index].trim()}: {price ? `${price.toFixed(6)} ${token1?.symbol}/${token0?.symbol}` : 'Invalid ID'}
                  </li>
                ))}
              </ul>
            </div>
          )}
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

      {/* Swap section */}
      <div style={{ background: '#fff3e0', padding: '15px', borderRadius: '5px', marginTop: '20px' }}>
        <h2 style={{ marginTop: 0 }}>Swap</h2>
        <div>
          <label>
            <input
              type="checkbox"
              checked={isExactInput}
              onChange={(e) => setIsExactInput(e.target.checked)}
            />
            Exact Input
          </label>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '10px' }}>
          <span>Swap {swapForY ? token0?.symbol : token1?.symbol || 'Token 1'} for {swapForY ? token1?.symbol : token0?.symbol || 'Token 2'}</span>
          <button
            onClick={() => {
              setSwapForY(!swapForY);
              // Reset input values when switching
              setSwapAmount('');
              setSwapAmountMin('');
            }}
            style={{ marginLeft: '10px', padding: '5px 10px', cursor: 'pointer', background: '#4CAF50', color: 'white', border: 'none', borderRadius: '5px' }}
          >
            Switch
          </button>
        </div>
        <input
          type="text"
          value={swapAmount}
          onChange={(e) => setSwapAmount(e.target.value)}
          placeholder={isExactInput ? "Amount In" : "Amount Out"}
          style={{ width: '98%', padding: '5px', marginBottom: '10px' }}
        />
        <input
          type="text"
          value={swapAmountMin}
          onChange={(e) => setSwapAmountMin(e.target.value)}
          placeholder={isExactInput ? "Min Amount Out" : "Max Amount In"}
          style={{ width: '98%', padding: '5px', marginBottom: '10px' }}
        />
        <button
          onClick={handleSwap}
          style={{ width: '98%', padding: '10px', cursor: 'pointer', background: '#3f51b5', color: 'white', border: 'none', borderRadius: '5px' }}
        >
          Swap
        </button>
      </div>

      {txHash && (
        <div style={{ background: '#e8f5e9', color: '#1b5e20', padding: '10px', marginTop: '20px', borderRadius: '5px' }}>
          <p><strong>Success:</strong> Transaction completed successfully.</p>
          <p><strong>Transaction Hash:</strong> {txHash}</p>
        </div>
      )}

      {/* Calculate Bin ID from Price section */}
      <div style={{ background: '#e0f2f1', padding: '15px', borderRadius: '5px', marginTop: '20px' }}>
        <h2 style={{ marginTop: 0 }}>Calculate Bin ID from Price</h2>
        <input
          type="text"
          placeholder={`Enter price (${token1?.symbol}/${token0?.symbol})`}
          value={priceInput}
          onChange={handlePriceInputChange}
          style={{ width: '98%', padding: '5px', marginBottom: '10px' }}
        />
        {calculatedBinId !== null && (
          <p>
            <strong>Calculated Bin ID:</strong> {calculatedBinId}
            <br />
            <strong>Delta Id:</strong> {calculatedBinId - activeId}
            <br />
            <strong>Exact price for this bin:</strong> {calculatePrice(calculatedBinId, token0, token1).toFixed(6)} {token1?.symbol}/{token0?.symbol}
          </p>
        )}
      </div>
    </div>
  );
}
