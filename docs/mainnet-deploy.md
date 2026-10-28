# Moving SplitPay to Arc mainnet

Mainnet uses real USDC and every transaction is irreversible. Arc Studio prepared the code and configuration
for mainnet but does not deploy, sign or send anything on mainnet for you. You do these steps yourself, from
your own wallet. The contracts have no admin, no pause and no upgrade path, so a wrong constructor value
cannot be fixed afterwards; you would have to redeploy.

## Before you start

1. Get an independent professional review of `contracts/SplitPay.sol` and `contracts/PayoutVault.sol`. The
   automated review and unit tests done in Arc Studio are not a substitute.
2. Accept the known risk: if the USDC issuer blocklists a contract's address, every withdrawal and claim on
   that contract freezes. Nothing in the contracts can work around that.
3. Decide the fee recipient. This address receives the fixed 0.2% fee and cannot be changed after deploying.
   Use an address you control and back up. Double check every character.
4. Fund your deployer wallet with a little USDC on Arc mainnet. Gas on Arc is paid in USDC.

## Network details

- Chain ID: 5042
- RPC: https://rpc.mainnet.arc.io
- Explorer: https://explorer.arc.io
- USDC (ERC-20, 6 decimals): 0x3600000000000000000000000000000000000000

Re-check these against https://docs.arc.io before you deploy.

## Deploy

Use an encrypted keystore, never a private key pasted into a command.

```bash
cast wallet import deployer --interactive      # one time; stores your key encrypted
export RPC=https://rpc.mainnet.arc.io
export USDC=0x3600000000000000000000000000000000000000
export FEE_RECIPIENT=0xYOUR_FEE_RECIPIENT      # permanent: review it carefully

forge create contracts/SplitPay.sol:SplitPay \
  --rpc-url $RPC --account deployer --broadcast \
  --constructor-args $USDC $FEE_RECIPIENT

forge create contracts/PayoutVault.sol:PayoutVault \
  --rpc-url $RPC --account deployer --broadcast \
  --constructor-args $USDC $FEE_RECIPIENT
```

Each command prints the deployed address and the transaction hash. Get the deployment block for each:

```bash
cast receipt <TX_HASH> blockNumber --rpc-url $RPC
```

## Verify what you deployed

```bash
cast call <SPLITPAY_ADDRESS> "usdc()(address)" --rpc-url $RPC          # must equal $USDC
cast call <SPLITPAY_ADDRESS> "feeRecipient()(address)" --rpc-url $RPC  # must equal $FEE_RECIPIENT
cast call <SPLITPAY_ADDRESS> "FEE_BPS()(uint16)" --rpc-url $RPC        # 20
cast call <VAULT_ADDRESS> "usdc()(address)" --rpc-url $RPC
cast call <VAULT_ADDRESS> "feeRecipient()(address)" --rpc-url $RPC
cast call <VAULT_ADDRESS> "FEE_BPS()(uint16)" --rpc-url $RPC
```

Also open both addresses on the explorer and confirm the bytecode is the contract you intended.

## Point the app at mainnet

Add to `.env` (then restart the dev server, because `.env` is only read at startup):

```
VITE_ARC_NETWORK=mainnet
VITE_SPLITPAY_ADDRESS=0x...
VITE_SPLITPAY_DEPLOY_BLOCK=...
VITE_PAYOUT_VAULT_ADDRESS=0x...
VITE_PAYOUT_VAULT_DEPLOY_BLOCK=...
```

Until all four deployment values are set, the app shows a setup screen instead of the tabs. While on mainnet
the app shows a "real USDC" banner. To return to the test network, remove `VITE_ARC_NETWORK` and restart.

## First transactions

Start with very small amounts: create a split with two addresses you own, pay it a small amount, withdraw,
and confirm the fee arrived at the fee recipient. Do the same for one escrow and one short plan.

## Buy USDC (card or bank) in production

The Buy USDC checkout stays hidden on mainnet while it is in test mode. To enable it you need a mainnet
Circle API key, business verification (KYB) on the Onramp Kit page of the Circle Console
(https://console.circle.com/app-kits/onramp, about 48 hours), `ONRAMP_REFERRER_DOMAIN` set to the exact
hostname you registered, and the sandbox values removed from `ONRAMP_API_BASE_URL` and
`VITE_ONRAMP_WIDGET_BASE_URL`. Keep the mainnet key server-side only.

## Things to know

- Gas on Arc is paid in USDC from the same balance you spend; the app keeps a small reserve on "use max".
  Check the reserve against current mainnet fees.
- The app reads history in small block windows to stay under the RPC's limit. Confirm the mainnet RPC
  behaves the same way before relying on the activity feed and lists.
- Testnet contracts and balances do not carry over. Splits, escrows and plans have to be created again.
