# SplitPay

A USDC payment app on Arc Testnet. Merchants create a split (up to 10 recipients with percentage shares) and share a payment link. Customers pay USDC into the split, and every recipient can withdraw their share. A fixed 0.2% protocol fee is taken from each payment or payout.

## Features

- Home: your withdrawable balance, withdraw to any address, and an activity feed of payments and withdrawals
- Pay: review who gets what (with a share chart) before paying; optional invoice reference
- Merchant: create and edit splits, copy a payment link or show a QR code
- Payouts: lock money in an escrow (with an optional arbiter), schedule a one-time payout, set up vesting with a cliff, or run payroll in equal steps; recipients claim as money unlocks and senders can cancel plans marked cancellable
- Add money: copy your wallet address or QR code, or buy USDC with a card or bank transfer through Circle's hosted checkout (test mode by default)
- Light and dark themes (follows your device by default, switchable from the header)
- Device-local labels for recipient addresses

Built with [Arc Studio](https://studio.arc.io)

## Tech stack

- React, Vite, TypeScript, Tailwind CSS
- wagmi, viem, ConnectKit
- Solidity 0.8.28 with Foundry and OpenZeppelin

## Development

Prerequisites: [Bun](https://bun.sh) and [Foundry](https://getfoundry.sh).

```bash
bun install
bun run server   # backend for the buy-USDC checkout (port 3001)
bun run dev      # app, proxies /api to the backend
```

Other commands:

```bash
bun run check            # lint and typecheck
bun run contracts:build  # compile contracts
bun run contracts:test   # run contract tests
```

### Environment variables

- `CIRCLE_API_KEY`: Circle API key used only by the backend to open checkout sessions. Use a testnet key for test mode.
- `ONRAMP_API_BASE_URL`: Circle API base URL for the checkout (test: `https://api-test.circle.com`).
- `VITE_ONRAMP_WIDGET_BASE_URL`: checkout widget address, shared by the backend and the app (test: `https://onramp-sandbox.arc.io`).
- `ONRAMP_REFERRER_DOMAIN`: hostname the app is served from, needed for card payments in production.
- `VITE_ARC_NETWORK`: set to `mainnet` to use Arc mainnet (default is testnet). Optional.
- `VITE_SPLITPAY_ADDRESS`, `VITE_SPLITPAY_DEPLOY_BLOCK`, `VITE_PAYOUT_VAULT_ADDRESS`, `VITE_PAYOUT_VAULT_DEPLOY_BLOCK`: where your mainnet contracts are. Required only on mainnet. See `docs/mainnet-deploy.md`.

Without these the rest of the app still works; only Buy USDC is unavailable.
