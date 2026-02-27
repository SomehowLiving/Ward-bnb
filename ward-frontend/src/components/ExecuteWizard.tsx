import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAccount, useChainId } from 'wagmi';
import { ethers } from 'ethers';
import {
  getPocket,
  getPocketNextNonce,
  signExecIntent,
  executePocket,
  simulateExecution,
  estimateGas,
  classifyRisk,
  simulateRisk,
  verifyExecIntent,
  decodeCalldata,
  getTokenMetadata,
  encodeApprove,
  encodeTransfer,
} from '../api';

declare global {
  interface Window {
    ethereum?: any;
  }
}

type ActionType = 'approve' | 'transfer' | 'custom';

interface TransactionInput {
  target: string;
  actionType: ActionType;
  spender?: string;
  recipient?: string;
  amount?: string;
  customData?: string;
}

interface DecodedInfo {
  function: string;
  args: string[];
}

export default function ExecuteWizard() {
  const { address: pocketAddress } = useParams<{ address: string }>();
  const navigate = useNavigate();
  const { isConnected, address: userAddress } = useAccount();
  const chainId = useChainId();

  const [step, setStep] = useState(1);
  const [pocket, setPocket] = useState<{ used: boolean; burned: boolean } | null>(null);
  const [signer, setSigner] = useState<ethers.JsonRpcSigner | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Step 1: Transaction Input
  const [txInput, setTxInput] = useState<TransactionInput>({
    target: '',
    actionType: 'custom',
    spender: '',
    recipient: '',
    amount: '',
    customData: '',
  });

  // Step 2: Decoded Info
  const [decodedInfo, setDecodedInfo] = useState<DecodedInfo | null>(null);
  const [tokenMeta, setTokenMeta] = useState<{ name: string; symbol: string; decimals: number } | null>(null);

  // Step 3: Risk Analysis
  const [riskTier, setRiskTier] = useState<{ tier: number; message: string } | null>(null);
  const [riskConfirmed, setRiskConfirmed] = useState(false);

  // Step 4: Pre-flight
  const [simResult, setSimResult] = useState<{ ok: boolean } | null>(null);
  const [gasEstimate, setGasEstimate] = useState<string | null>(null);

  // Step 5: Signing
  const [signing, setSigning] = useState(false);
  const [signature, setSignature] = useState<string | null>(null);

  // Step 6: Verification
  const [verified, setVerified] = useState(false);

  // Step 7: Execution
  const [executing, setExecuting] = useState(false);
  const [execResult, setExecResult] = useState<{ txHash: string } | null>(null);

  // Execution params
  const [nonce, setNonce] = useState(1);
  // Keep expiry stable for the full intent lifecycle; changing it after signing invalidates the signature.
  const [expiry] = useState(() => Math.floor(Date.now() / 1000) + 3600);

  useEffect(() => {
    if (!isConnected || !pocketAddress || !userAddress) {
      navigate('/');
      return;
    }
    initSigner();
    fetchPocket();
  }, [isConnected, pocketAddress, userAddress]);

  const initSigner = async () => {
    if (window.ethereum) {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const s = await provider.getSigner();
      setSigner(s);
    }
  };

  const fetchPocket = async () => {
    if (!pocketAddress) return;
    try {
      const [p, nextNonce] = await Promise.all([
        getPocket(pocketAddress),
        getPocketNextNonce(pocketAddress)
      ]);
      setPocket(p);
      setNonce(nextNonce);
    } catch (err: any) {
      setError(err.message);
    }
  };

  // Step 1 -> 2: Generate calldata and decode
  const handleStep1Complete = async () => {
    if (!txInput.target) {
      setError('Target address is required');
      return;
    }

    let calldata = '0x';
    if (txInput.actionType === 'approve' && txInput.spender && txInput.amount) {
      calldata = encodeApprove(txInput.spender, txInput.amount);
    } else if (txInput.actionType === 'transfer' && txInput.recipient && txInput.amount) {
      calldata = encodeTransfer(txInput.recipient, txInput.amount);
    } else if (txInput.actionType === 'custom') {
      calldata = txInput.customData || '0x';
    }

    try {
      const decoded = await decodeCalldata(calldata);
      setDecodedInfo(decoded);

      // If ERC20 action, fetch token metadata
      if (txInput.actionType !== 'custom') {
        try {
          const meta = await getTokenMetadata(txInput.target);
          setTokenMeta({ name: meta.name, symbol: meta.symbol, decimals: meta.decimals });
        } catch {
          // Token might not have standard ERC20 interface
        }
      }

      setError(null);
      setStep(2);
    } catch (err: any) {
      setError(err.message);
    }
  };

  // Step 2 -> 3: Risk analysis
  const handleStep2Complete = async () => {
    if (!txInput.target) return;

    try {
      const risk = await classifyRisk(txInput.target);
      setRiskTier({ tier: risk.tier, message: risk.message });
      setError(null);
      setStep(3);
    } catch (err: any) {
      setError(err.message);
    }
  };

  // Step 3 -> 4: Pre-flight validation
  const handleStep3Complete = async () => {
    if (!pocketAddress || !txInput.target || !signer || !decodedInfo) return;

    // Tier 3+ blocks execution
    if (riskTier && riskTier.tier >= 3) {
      setError('High risk transaction blocked');
      return;
    }

    // Tier 2 requires confirmation
    if (riskTier && riskTier.tier === 2 && !riskConfirmed) {
      setError('Risk confirmation required for tier 2 transactions');
      return;
    }

    let calldata = '0x';
    if (txInput.actionType === 'approve' && txInput.spender && txInput.amount) {
      calldata = encodeApprove(txInput.spender, txInput.amount);
    } else if (txInput.actionType === 'transfer' && txInput.recipient && txInput.amount) {
      calldata = encodeTransfer(txInput.recipient, txInput.amount);
    } else if (txInput.actionType === 'custom') {
      calldata = txInput.customData || '0x';
    }

    try {
      const nextNonce = await getPocketNextNonce(pocketAddress);
      setNonce(nextNonce);

      // Simulation
      const sig = await signExecIntent(signer, pocketAddress, txInput.target, calldata, nextNonce, expiry, chainId);
      const sim = await simulateExecution({
        pocket: pocketAddress,
        target: txInput.target,
        data: calldata,
        nonce: nextNonce,
        expiry,
        signature: sig,
      });
      setSimResult(sim);

      // Gas estimate
      const gas = await estimateGas({
        pocket: pocketAddress,
        target: txInput.target,
        data: calldata,
        nonce: nextNonce,
        expiry,
        signature: sig,
      });
      setGasEstimate(gas.gas);

      setError(null);
      setStep(4);
    } catch (err: any) {
      setError(err.message);
    }
  };

  // Step 4 -> 5: Sign intent
  const handleSign = async () => {
    if (!pocketAddress || !txInput.target || !signer || !decodedInfo) return;

    setSigning(true);
    setError(null);

    try {
      const nextNonce = await getPocketNextNonce(pocketAddress);
      setNonce(nextNonce);

      const signerAddr = await signer.getAddress();
    console.log("Signer address:", signerAddr);

      let calldata = '0x';
      if (txInput.actionType === 'approve' && txInput.spender && txInput.amount) {
        calldata = encodeApprove(txInput.spender, txInput.amount);
      } else if (txInput.actionType === 'transfer' && txInput.recipient && txInput.amount) {
        calldata = encodeTransfer(txInput.recipient, txInput.amount);
      } else if (txInput.actionType === 'custom') {
        calldata = txInput.customData || '0x';
      }

      const sig = await signExecIntent(signer, pocketAddress, txInput.target, calldata, nextNonce, expiry, chainId);
      setSignature(sig);
      setSigning(false);
      setStep(5);
    } catch (err: any) {
      setError(err.message);
      setSigning(false);
    }
  };

  // Step 5 -> 6: Verify signature
  const handleVerify = async () => {
    if (!pocketAddress || !txInput.target || !signature || !decodedInfo) return;

    let calldata = '0x';
    if (txInput.actionType === 'approve' && txInput.spender && txInput.amount) {
      calldata = encodeApprove(txInput.spender, txInput.amount);
    } else if (txInput.actionType === 'transfer' && txInput.recipient && txInput.amount) {
      calldata = encodeTransfer(txInput.recipient, txInput.amount);
    } else if (txInput.actionType === 'custom') {
      calldata = txInput.customData || '0x';
    }

    const dataHash = ethers.keccak256(calldata);

    try {
      const result = await verifyExecIntent({
        pocket: pocketAddress,
        target: txInput.target,
        dataHash,
        nonce,
        expiry,
        signature,
      });

      if (!result.valid) {
        setError(`Signature invalid: ${result.reason}`);
        return;
      }

      setVerified(true);
      setError(null);
      setStep(6);
    } catch (err: any) {
      setError(err.message);
    }
  };

  // Step 6 -> 7: Execute
  const handleExecute = async () => {
    if (!pocketAddress || !txInput.target || !signature || !decodedInfo) return;

    setExecuting(true);
    setError(null);

    try {
      let calldata = '0x';
      if (txInput.actionType === 'approve' && txInput.spender && txInput.amount) {
        calldata = encodeApprove(txInput.spender, txInput.amount);
      } else if (txInput.actionType === 'transfer' && txInput.recipient && txInput.amount) {
        calldata = encodeTransfer(txInput.recipient, txInput.amount);
      } else if (txInput.actionType === 'custom') {
        calldata = txInput.customData || '0x';
      }

      const result = await executePocket({
        pocket: pocketAddress,
        target: txInput.target,
        data: calldata,
        nonce,
        expiry,
        signature,
      });

      setExecResult({ txHash: result.txHash });
      setExecuting(false);
      setStep(7);
    } catch (err: any) {
      setError(err.message);
      setExecuting(false);
    }
  };

  if (pocket?.used || pocket?.burned) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <h2>Pocket has been used or burned</h2>
        <Link to={`/pocket/${pocketAddress}`}>
          <button>Back to Pocket</button>
        </Link>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '700px', margin: '0 auto', padding: '2rem' }}>
      <header style={{ marginBottom: '2rem' }}>
        <Link to={`/pocket/${pocketAddress}`} style={{ marginBottom: '1rem', display: 'block' }}>
          ← Back
        </Link>
        <h1>Execute Transaction</h1>
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
          {[1, 2, 3, 4, 5, 6, 7].map((s) => (
            <div
              key={s}
              style={{
                flex: 1,
                height: '4px',
                background: step >= s ? '#007bff' : '#ddd',
                borderRadius: '2px',
              }}
            />
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.5rem', fontSize: '0.75rem', color: '#666' }}>
          <span>Input</span>
          <span>Decode</span>
          <span>Risk</span>
          <span>Pre-flight</span>
          <span>Sign</span>
          <span>Verify</span>
          <span>Execute</span>
        </div>
      </header>

      {error && <p style={{ color: 'red', marginBottom: '1rem' }}>{error}</p>}

      {/* Step 1: Transaction Input */}
      {step === 1 && (
        <section>
          <h3 style={{ marginBottom: '1rem' }}>Step 1: Transaction Input</h3>
          
          <div style={{ display: 'grid', gap: '1rem' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '0.5rem' }}>Target Contract</label>
              <input
                type="text"
                placeholder="0x..."
                value={txInput.target}
                onChange={(e) => setTxInput({ ...txInput, target: e.target.value })}
                style={{ width: '100%', padding: '0.75rem' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '0.5rem' }}>Action Type</label>
              <select
                value={txInput.actionType}
                onChange={(e) => setTxInput({ ...txInput, actionType: e.target.value as ActionType })}
                style={{ width: '100%', padding: '0.75rem' }}
              >
                <option value="custom">Custom Calldata</option>
                <option value="approve">ERC20 Approve</option>
                <option value="transfer">ERC20 Transfer</option>
              </select>
            </div>

            {txInput.actionType === 'approve' && (
              <>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.5rem' }}>Spender</label>
                  <input
                    type="text"
                    placeholder="0x..."
                    value={txInput.spender}
                    onChange={(e) => setTxInput({ ...txInput, spender: e.target.value })}
                    style={{ width: '100%', padding: '0.75rem' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.5rem' }}>Amount (wei)</label>
                  <input
                    type="text"
                    placeholder="1000000..."
                    value={txInput.amount}
                    onChange={(e) => setTxInput({ ...txInput, amount: e.target.value })}
                    style={{ width: '100%', padding: '0.75rem' }}
                  />
                </div>
              </>
            )}

            {txInput.actionType === 'transfer' && (
              <>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.5rem' }}>Recipient</label>
                  <input
                    type="text"
                    placeholder="0x..."
                    value={txInput.recipient}
                    onChange={(e) => setTxInput({ ...txInput, recipient: e.target.value })}
                    style={{ width: '100%', padding: '0.75rem' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.5rem' }}>Amount (wei)</label>
                  <input
                    type="text"
                    placeholder="1000000..."
                    value={txInput.amount}
                    onChange={(e) => setTxInput({ ...txInput, amount: e.target.value })}
                    style={{ width: '100%', padding: '0.75rem' }}
                  />
                </div>
              </>
            )}

            {txInput.actionType === 'custom' && (
              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem' }}>Calldata (hex)</label>
                <textarea
                  placeholder="0x..."
                  value={txInput.customData}
                  onChange={(e) => setTxInput({ ...txInput, customData: e.target.value })}
                  style={{ width: '100%', padding: '0.75rem', minHeight: '100px' }}
                />
              </div>
            )}

            <button onClick={handleStep1Complete} style={{ marginTop: '1rem' }}>
              Continue
            </button>
          </div>
        </section>
      )}

      {/* Step 2: Decode & Explain */}
      {step === 2 && decodedInfo && (
        <section>
          <h3 style={{ marginBottom: '1rem' }}>Step 2: Decode & Explain</h3>
          
          <div style={{ padding: '1rem', background: '#f9f9f9', borderRadius: '8px', marginBottom: '1rem' }}>
            <div style={{ marginBottom: '0.5rem' }}>
              <strong>Function:</strong> {decodedInfo.function}
            </div>
            {tokenMeta && (
              <div style={{ fontSize: '0.9rem', color: '#666', marginBottom: '0.5rem' }}>
                {tokenMeta.name} ({tokenMeta.symbol})
              </div>
            )}
            <div>
              <strong>Parameters:</strong>
              <pre style={{ margin: '0.5rem 0', fontSize: '0.85rem' }}>
                {JSON.stringify(decodedInfo.args, null, 2)}
              </pre>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '1rem' }}>
            <button onClick={() => setStep(1)}>Back</button>
            <button onClick={handleStep2Complete}>Continue</button>
          </div>
        </section>
      )}

      {/* Step 3: Risk Analysis */}
      {step === 3 && riskTier && (
        <section>
          <h3 style={{ marginBottom: '1rem' }}>Step 3: Risk Analysis</h3>
          
          <div style={{ 
            padding: '1rem', 
            borderRadius: '8px', 
            marginBottom: '1rem',
            background: riskTier.tier >= 3 ? '#fee' : riskTier.tier === 2 ? '#fff3cd' : '#d4edda'
          }}>
            <div style={{ fontSize: '1.25rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>
              Risk Tier: {riskTier.tier}
            </div>
            <div>{riskTier.message}</div>
            {riskTier.tier === 2 && (
              <label style={{ display: 'block', marginTop: '1rem' }}>
                <input 
                  type="checkbox" 
                  checked={riskConfirmed}
                  onChange={(e) => setRiskConfirmed(e.target.checked)}
                  style={{ marginRight: '0.5rem' }}
                />
                I understand the risks and want to proceed
              </label>
            )}
          </div>

          <div style={{ display: 'flex', gap: '1rem' }}>
            <button onClick={() => setStep(2)}>Back</button>
            <button 
              onClick={handleStep3Complete}
              disabled={riskTier.tier >= 3 || (riskTier.tier === 2 && !riskConfirmed)}
            >
              Continue
            </button>
          </div>
        </section>
      )}

      {/* Step 4: Pre-flight Validation */}
      {step === 4 && (
        <section>
          <h3 style={{ marginBottom: '1rem' }}>Step 4: Pre-flight Validation</h3>
          
          <div style={{ padding: '1rem', background: '#f9f9f9', borderRadius: '8px', marginBottom: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
              <span>Simulation:</span>
              <span style={{ color: simResult?.ok ? 'green' : 'red' }}>
                {simResult?.ok ? '✓ Success' : '✗ Failed'}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Estimated Gas:</span>
              <span>{gasEstimate || 'N/A'}</span>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '1rem' }}>
            <button onClick={() => setStep(3)}>Back</button>
            <button onClick={handleSign} disabled={!simResult?.ok || signing}>
              {signing ? 'Signing...' : 'Sign Transaction'}
            </button>
          </div>
        </section>
      )}

      {/* Step 5: Sign Intent */}
      {step === 5 && signature && (
        <section>
          <h3 style={{ marginBottom: '1rem' }}>Step 5: Sign Intent</h3>
          
          <div style={{ padding: '1rem', background: '#d4edda', borderRadius: '8px', marginBottom: '1rem' }}>
            ✓ Signature created
          </div>

          <div style={{ display: 'flex', gap: '1rem' }}>
            <button onClick={() => setStep(4)}>Back</button>
            <button onClick={handleVerify}>Verify Signature</button>
          </div>
        </section>
      )}

      {/* Step 6: Verify Signature */}
      {step === 6 && verified && (
        <section>
          <h3 style={{ marginBottom: '1rem' }}>Step 6: Verify Signature</h3>
          
          <div style={{ padding: '1rem', background: '#d4edda', borderRadius: '8px', marginBottom: '1rem' }}>
            ✓ Signature verified
          </div>

          <div style={{ display: 'flex', gap: '1rem' }}>
            <button onClick={() => setStep(5)}>Back</button>
            <button onClick={handleExecute} disabled={executing}>
              {executing ? 'Executing...' : 'Execute'}
            </button>
          </div>
        </section>
      )}

      {/* Step 7: Execute */}
      {step === 7 && execResult && (
        <section style={{ textAlign: 'center' }}>
          <h3 style={{ marginBottom: '1rem', color: 'green' }}>✓ Transaction Executed</h3>
          
          <div style={{ padding: '1rem', background: '#f9f9f9', borderRadius: '8px', marginBottom: '1rem' }}>
            <div style={{ marginBottom: '0.5rem' }}>Transaction Hash:</div>
            <code style={{ wordBreak: 'break-all' }}>{execResult.txHash}</code>
          </div>

          <Link to={`/pocket/${pocketAddress}`}>
            <button>Back to Pocket</button>
          </Link>
        </section>
      )}
    </div>
  );
}
