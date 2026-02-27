export const API = {
  pocket: {
    nextNonce: (address: string) => `/api/pocket/${address}/next-nonce`,
    execute: "/api/pocket/execute"
  },
  credit: {
    state: (user: string) => `/api/credit/state/${user}`,
    request: (requestId: string) => `/api/credit/request/${requestId}`
  },
  merchant: {
    get: (address: string) => `/api/merchant/${address}`
  }
};
