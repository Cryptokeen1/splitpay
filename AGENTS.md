# [App Name]

> Built with Arc Studio - money-powered apps in minutes

This is the **project memory** - what Arc Studio remembers about building this app. It helps future agents (or humans) understand and extend the project.

---

## What This App Does

[Brief description of what the app does and its primary use case]

## Tech Stack

- Frontend: React 18, Vite, TypeScript, Tailwind CSS
- Web3: wagmi v2, viem v2, ConnectKit
- Contracts: Solidity 0.8.28 + Foundry. Sources in `contracts/`, unit tests in `contracts/test/*.t.sol`. Build with `bun run contracts:build` (`forge build`), test with `bun run contracts:test` (`forge test`).
- Wallet: injected (MetaMask, etc.)
- Chain: Arc Testnet (Chain ID: 5042002, imported from `viem/chains`)
- Token: USDC (6 decimals) (Address: 0x3600000000000000000000000000000000000000, Chain: Arc Testnet)
- Toasts: Sonner

## Key Files

- `src/App.tsx` - Main application logic
- `src/components/` - UI components
- `src/config.ts` - wagmi config (chains, connectors, transports)

## To Run

```bash
bun install
bun run dev
```

---

## SplitPay (project notes)

- Contract: `contracts/SplitPay.sol`, immutable, no admin. Constructor `(usdc, feeRecipient)`; fixed 0.2% fee.
- Deployed on Arc Testnet: `0x42c7cc566ccbba542c4ef8ed66ad468cad22626b` (deploy block 0x421f5c0). USDC `0x3600000000000000000000000000000000000000`. Fee recipient `0x27333d03C446C4A074CDc39720434B903CA3E731`.
- Pull model: `pay(splitId, amount, expectedVersion, ref)` credits balances; recipients call `withdraw(to)`.
- App: `src/splitpay.ts` (address, ABI, tx hook), `src/components/` (Pay, Merchant, Earnings tabs). Payment links use `/?split=<id>`.

## PayoutVault (project notes)

- Contract: `contracts/PayoutVault.sol`, immutable, no admin. Escrow (payer/arbiter release, seller/arbiter refund, anyone settles after deadline), plans for vesting, scheduled and payroll. Fee 0.2% only on payouts to recipients/sellers.
- Deployed on Arc Testnet: `0xfd4767731c41b2069eac5b87208a0f4e42d436d3` (deploy block 0x4220f1b). Constructor `(usdc, feeRecipient)` same values as SplitPay.
- Known accepted risk: USDC issuer blocklisting the vault would freeze all claims and withdrawals.
- App: `src/payoutvault.ts` (address, ABI), `src/lib/usePayoutData.ts`, `src/components/Payout*.tsx`. Tests in `contracts/test/PayoutVault.*.t.sol`.

## Arc notes learned the hard way

- `eth_getLogs` on the Arc RPC rejects ranges above ~5,000 blocks (about 40 minutes of chain time). Always read history through `src/lib/logScan.ts`, which reads 3,000-block windows and caches results.
- Gas is paid in USDC from the same balance. The app keeps `GAS_RESERVE` back on "use max" and shows `GasNotice` when the wallet is nearly empty.

## Onramp (buy USDC)

- Backend: `server/index.ts` (run `bun run server`, port 3001; Vite proxies `/api`). Mints Circle onramp sessions only for a wallet that signed a short-lived message (`src/lib/onrampAuth.ts`); the session destination must be the signer's own address.
- Client: `src/components/BuyUsdc.tsx`, inside the Home "Add money" card. Sandbox by default: sandbox test funds land on Ethereum, not Arc Testnet.
- Going live needs a mainnet API key, KYB on the Circle Console Onramp Kit page, matching `ONRAMP_REFERRER_DOMAIN`, and the sandbox URLs removed.

## Mainnet

- Network and deployment addresses come from `src/network.ts`. Testnet is the default; mainnet needs `VITE_ARC_NETWORK=mainnet` plus the four deployment variables. Until they are set the app shows `MainnetSetup`.
- Nothing has been deployed to mainnet by Arc Studio. The user deploys with their own wallet; steps in `docs/mainnet-deploy.md`.

### Mainnet deployment (done by the user with their own wallet via Remix)

- SplitPay: `0xbfCbfFd48F813b4e46961deC7a4FE048Af91d992`, block 28169870 (tx `0x65af73cb...cec88`).
- PayoutVault: `0xb53088b5ba3ec15b2bff6de6529f9e1cb4d4b2a5`, block 28171508 (tx `0x85d5883b...b819`).
- Both read back with usdc = 0x3600...0000, feeRecipient = 0x27333d03C446C4A074CDc39720434B903CA3E731, FEE_BPS = 20. `.env` has `VITE_ARC_NETWORK=mainnet`; remove it to return to testnet.
