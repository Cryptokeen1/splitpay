/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ARC_NETWORK?: string
  readonly VITE_SPLITPAY_ADDRESS?: string
  readonly VITE_SPLITPAY_DEPLOY_BLOCK?: string
  readonly VITE_PAYOUT_VAULT_ADDRESS?: string
  readonly VITE_PAYOUT_VAULT_DEPLOY_BLOCK?: string
  readonly VITE_ONRAMP_WIDGET_BASE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
