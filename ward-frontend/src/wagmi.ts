import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { http } from 'wagmi';
import { bscTestnet } from 'wagmi/chains';

const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID;

if (!projectId) {
  throw new Error('Missing VITE_WALLETCONNECT_PROJECT_ID');
}

export const config = getDefaultConfig({
  appName: 'WalletGuard',
  projectId,
  chains: [bscTestnet],
  transports: {
    [bscTestnet.id]: http(import.meta.env.VITE_RPC_URL),
  },
});
