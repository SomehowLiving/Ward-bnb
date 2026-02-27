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
    get: (merchant: string) => `/api/merchant/${merchant}`
  },
  activity: {
    credits: (user: string) => `/api/activity/credits/${user}`,
    repayments: (user: string) => `/api/activity/repayments/${user}`,
    pockets: (user: string) => `/api/activity/pockets/${user}`,
    executions: (user: string) => `/api/activity/executions/${user}`,
    merchant: (merchant: string) => `/api/activity/merchant/${merchant}`
  }
};
