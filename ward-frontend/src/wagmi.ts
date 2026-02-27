import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { http } from 'wagmi';
import { sepolia } from 'wagmi/chains';

const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID;

if (!projectId) {
  throw new Error('Missing VITE_WALLETCONNECT_PROJECT_ID');
}

export const config = getDefaultConfig({
  appName: 'WalletGuard',
  projectId,
  chains: [sepolia],
  transports: {
    [sepolia.id]: http(import.meta.env.VITE_RPC_URL),
  },
});
