import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAccount, useChainId } from 'wagmi';
import { ethers } from 'ethers';
import { 
  getPocket, 
  getPocketNextNonce,
  getPocketAssets,
  getControllerPocket,
  signBurnIntent,
  burnPocket,
  sweepPocket,
  calculateFee,
  Pocket,
  PocketAsset
} from '../api';

declare global {
  interface Window {
    ethereum?: any;
  }
}

export default function PocketDetail() {
  const { address: pocketAddress } = useParams<{ address: string }>();
  const navigate = useNavigate();
  const { isConnected, address: userAddress } = useAccount();
  const chainId = useChainId();
  
  const [pocket, setPocket] = useState<Pocket | null>(null);
  const [controllerInfo, setControllerInfo] = useState<{ valid: boolean; owner: string } | null>(null);
  const [signer, setSigner] = useState<ethers.JsonRpcSigner | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [burning, setBurning] = useState(false);
  const [sweepForm, setSweepForm] = useState({ token: '', receiver: '', amount: '' });
  const [sweepFee, setSweepFee] = useState<{ tier: number; feeFormatted: string; netFormatted: string; symbol: string } | null>(null);
  const [sweeping, setSweeping] = useState(false);
  const [nativeBalance, setNativeBalance] = useState<string>('0');
  const [assets, setAssets] = useState<PocketAsset[]>([]);
  const [assetsLoading, setAssetsLoading] = useState(false);


  useEffect(() => {
    if (!isConnected || !pocketAddress || !userAddress) {
      navigate('/');
      return;
    }
    initSigner();
    fetchPocket(); 
    fetchAssets();
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
      const [p, c] = await Promise.all([
        getPocket(pocketAddress),
        getControllerPocket(pocketAddress),
      ]);
      setPocket(p);
      setControllerInfo(c);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };
const fetchAssets = async () => {
  if (!pocketAddress) return;

  setAssetsLoading(true);

  try {
    const response = await getPocketAssets(pocketAddress);

    // update only if fetch succeeded
    setNativeBalance(response.formattedNativeBalance);
    setAssets(response.assets);

  } catch (err) {
    console.error('Asset indexing failed', err);
    // keep previous values — do NOT overwrite with 0
  } finally {
    setAssetsLoading(false);
  }
};



  const handleBurn = async () => {
    if (!signer || !pocketAddress || pocket?.burned) return;
    if (!confirm('Are you sure you want to burn this pocket? This cannot be undone.')) return;
    
    setBurning(true);
    setError(null);
    try {
      const nonce = await getPocketNextNonce(pocketAddress);
      const expiry = Math.floor(Date.now() / 1000) + 3600;
      const signature = await signBurnIntent(signer, pocketAddress, nonce, expiry, chainId);
      await burnPocket({ pocket: pocketAddress, nonce, expiry, signature });
      navigate('/');
    } catch (err: any) {
      setError(err.message);
    }
    setBurning(false);
  };

  const handleSweepFee = async () => {
    if (!sweepForm.token || !sweepForm.amount) return;
    try {
      setError(null);
      const fee = await calculateFee(sweepForm.amount, sweepForm.token);
      setSweepFee({
        tier: fee.tier,
        feeFormatted: fee.feeFormatted,
        netFormatted: fee.netFormatted,
        symbol: fee.symbol
      });
    } catch (err: any) {
      setSweepFee(null);
      setError(err.message || 'Fee calculation failed');
    }
  };

  const handleSweep = async () => {
    if (!signer || !pocketAddress || !sweepForm.token || !sweepForm.receiver || !sweepForm.amount) return;
    if (!sweepFee) return;
    
    setSweeping(true);
    setError(null);
    try {
      await sweepPocket({
        pocketAddress,
        tokenAddress: sweepForm.token,
        receiverAddress: sweepForm.receiver,
        amount: sweepForm.amount,
      });
      alert('Sweep successful!');
      setSweepForm({ token: '', receiver: '', amount: '' });
      setSweepFee(null);
      await fetchAssets();
    } catch (err: any) {
      setError(err.message);
    }
    setSweeping(false);
  };

  if (loading) {
    return <div style={{ padding: '2rem', textAlign: 'center' }}>Loading...</div>;
  }

  if (error && !pocket) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <p style={{ color: 'red' }}>{error}</p>
        <button onClick={() => navigate('/')}>Back to Dashboard</button>
      </div>
    );
  }

  if (!pocket || !controllerInfo) {
    return <div style={{ padding: '2rem', textAlign: 'center' }}>Pocket not found</div>;
  }

  const executeDisabled = pocket.used || pocket.burned;
  const sweepDisabled = pocket.burned;
  const burnDisabled = pocket.burned;

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', padding: '2rem' }}>
      <header style={{ marginBottom: '2rem' }}>
        <button onClick={() => navigate('/')} style={{ marginBottom: '1rem' }}>
          ← Back
        </button>
        <h1>Pocket</h1>
        <code style={{ display: 'block', padding: '0.5rem', background: '#f5f5f5', borderRadius: '4px' }}>
          {pocket.address}
        </code>
      </header>

      <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', marginBottom: '2rem' }}>
        <div style={{ padding: '1rem', border: '1px solid #ddd', borderRadius: '8px' }}>
          <div style={{ fontSize: '0.8rem', color: '#666', marginBottom: '0.5rem' }}>Owner</div>
          <div>{pocket.owner?.slice(0, 6)}...{pocket.owner?.slice(-4)}</div>
        </div>
        <div style={{ padding: '1rem', border: '1px solid #ddd', borderRadius: '8px' }}>
          <div style={{ fontSize: '0.8rem', color: '#666', marginBottom: '0.5rem' }}>Status</div>
          <div style={{ 
            color: pocket.burned ? 'red' : pocket.used ? 'orange' : 'green',
            fontWeight: 'bold'
          }}>
            {pocket.burned ? 'Burned' : pocket.used ? 'Used' : 'Active'}
          </div>
        </div>
        <div style={{ padding: '1rem', border: '1px solid #ddd', borderRadius: '8px' }}>
          <div style={{ fontSize: '0.8rem', color: '#666', marginBottom: '0.5rem' }}>Controller</div>
          <div>{controllerInfo.valid ? '✓ Valid' : '✗ Invalid'}</div>
        </div>
      </section>
      <section style={{ marginBottom: '2rem', padding: '1rem', border: '1px solid #ddd', borderRadius: '8px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <h3 style={{ margin: 0 }}>Pocket Assets</h3>
          <button onClick={fetchAssets} disabled={assetsLoading}>
            {assetsLoading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
        <div style={{ marginBottom: '0.75rem', color: '#333' }}>
          Native Balance: <strong>{nativeBalance} ETH</strong>
        </div>
        {assets.length === 0 ? (
          <div style={{ color: '#666', fontSize: '0.9rem' }}>
            No ERC20 assets indexed for this pocket yet.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', borderBottom: '1px solid #eee', padding: '0.5rem 0.25rem' }}>Token</th>
                  <th style={{ textAlign: 'left', borderBottom: '1px solid #eee', padding: '0.5rem 0.25rem' }}>Symbol</th>
                  <th style={{ textAlign: 'right', borderBottom: '1px solid #eee', padding: '0.5rem 0.25rem' }}>Balance</th>
                  <th style={{ textAlign: 'left', borderBottom: '1px solid #eee', padding: '0.5rem 0.25rem' }}>Address</th>
                </tr>
              </thead>
              <tbody>
                {assets.map((asset) => (
                  <tr key={asset.address}>
                    <td style={{ padding: '0.5rem 0.25rem' }}>{asset.name}</td>
                    <td style={{ padding: '0.5rem 0.25rem' }}>{asset.symbol}</td>
                    <td style={{ padding: '0.5rem 0.25rem', textAlign: 'right', color: asset.hasBalance ? '#111' : '#777' }}>
                      {asset.formattedBalance}
                    </td>
                    <td style={{ padding: '0.5rem 0.25rem', fontFamily: 'monospace' }}>
                      {asset.address.slice(0, 8)}...{asset.address.slice(-6)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {error && <p style={{ color: 'red', marginBottom: '1rem' }}>{error}</p>}

      <section style={{ display: 'grid', gap: '1rem' }}>
        {/* Execute Action */}
        <div style={{ padding: '1.5rem', border: '1px solid #ddd', borderRadius: '8px' }}>
          <h3 style={{ marginBottom: '1rem' }}>Execute Transaction</h3>
          <p style={{ color: '#666', marginBottom: '1rem', fontSize: '0.9rem' }}>
            Execute a protected transaction from this pocket
          </p>
          <Link to={`/pocket/${pocket.address}/execute`}>
            <button disabled={executeDisabled}>
              {executeDisabled ? 'Pocket Used/Burned' : 'Execute Transaction'}
            </button>
          </Link>
        </div>       

        {/* Sweep Funds */}
        <div style={{ padding: '1.5rem', border: '1px solid #ddd', borderRadius: '8px' }}>
          <h3 style={{ marginBottom: '1rem' }}>Sweep Funds</h3>
          <div style={{ display: 'grid', gap: '0.5rem', marginBottom: '1rem' }}>
            <input
              type="text"
              placeholder="Token Address (0x...)"
              value={sweepForm.token}
              onChange={(e) => setSweepForm({ ...sweepForm, token: e.target.value })}
              disabled={sweepDisabled}
            />
            <input
              type="text"
              placeholder="Receiver Address (0x...)"
              value={sweepForm.receiver}
              onChange={(e) => setSweepForm({ ...sweepForm, receiver: e.target.value })}
              disabled={sweepDisabled}
            />
            <input
              type="text"
              placeholder="Amount (token units, e.g. 500.5)"
              value={sweepForm.amount}
              onChange={(e) => setSweepForm({ ...sweepForm, amount: e.target.value })}
              disabled={sweepDisabled}
            />
            {!sweepFee && (
              <button onClick={handleSweepFee} disabled={sweepDisabled || !sweepForm.token || !sweepForm.amount}>
                Calculate Fee
              </button>
            )}
          </div>
          {sweepFee && (
            <div style={{ marginBottom: '1rem', padding: '0.75rem', background: '#f9f9f9', borderRadius: '4px' }}>
              <div>Fee: {sweepFee.feeFormatted} {sweepFee.symbol}</div>
              <div>Net: {sweepFee.netFormatted} {sweepFee.symbol}</div>
              <div>Risk Tier: {sweepFee.tier}</div>
            </div>
          )}
          {sweepFee && (
            <button 
              onClick={handleSweep} 
              disabled={sweepDisabled || sweeping}
            >
              {sweeping ? 'Sweeping...' : 'Sweep'}
            </button>
          )}
        </div>

        {/* Burn Pocket */}
        <div style={{ padding: '1.5rem', border: '1px solid #ddd', borderRadius: '8px' }}>
          <h3 style={{ marginBottom: '1rem' }}>Burn Pocket</h3>
          <p style={{ color: '#666', marginBottom: '1rem', fontSize: '0.9rem' }}>
            Permanently disable this pocket. Cannot be undone.
          </p>
          <button 
            onClick={handleBurn} 
            disabled={burnDisabled || burning}
            style={{ background: '#dc3545', color: 'white' }}
          >
            {burning ? 'Burning...' : 'Burn Pocket'}
          </button>
        </div>
      </section>
    </div>
  );
}
