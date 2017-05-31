# ilp-plugin-chain
> Interledger.js Ledger Plugin for Chain Core

<a href="https://chain.com"><img src="./images/chain.png" alt="Chain Core" height="50px" /></a><img height="45" hspace="5" /><img src="./images/plus.png" height="45" /><img height="45" hspace="5" /><a href="https://interledger.org"><img src="./images/interledgerjs.png" alt="Interledger.js" height="50px" /></a>


This plugin enables [Interledger](https://interledger.org) payments through [Chain Core](https://chain.com).

`ilp-plugin-chain` implements the [Interledger.js Ledger Plugin Interface](https://github.com/interledger/rfcs/blob/master/0004-ledger-plugin-interface/0004-ledger-plugin-interface.md), which allows Chain Core to be used with [`ilp` client](https://github.com/interledgerjs/ilp) and the [`ilp-connector`](https://github.com/interledgerjs/ilp-connector).

## Installation

**Dependencies:**

- Node.js >=v7.10.0
- [Chain Core Developer Edition with Ivy >=v1.2.3](https://chain.com/docs/1.2/ivy-playground/install)
- `npm link` the [`chain-sdk`](https://github.com/chain/chain/tree/ivy/sdk/node)

**Setup:**

```sh
git clone https://github.com/emschwartz/ilp-plugin-chain.git
cd ilp-plugin-chain
npm link chain-sdk
npm install
```

## Usage

Run the [example script](./examples/pluginFunctionality.js) to see the plugin in action. (Note: you'll need to modify the plugin configuration to match your local Chain Core instance)

## How It Works

This plugin uses an [Ivy](https://chain.com/docs/1.2/ivy-playground/tutorial) smart contract ([source](./src/escrow.js#L7-L25)) to escrow senders' funds and implement conditional transfers, as required for [Interledger payments](https://github.com/interledger/rfcs/blob/master/0001-interledger-architecture/0001-interledger-architecture.md). Receivers can use the plugin to get notifications about incoming transfers and fulfill the transfer condition with a valid preimage.

By implementing all of the functions required by the [Ledger Plugin Interface](https://github.com/interledger/rfcs/blob/master/0004-ledger-plugin-interface/0004-ledger-plugin-interface.md), this allows Chain Core to be used by standard Interledger.js components.

For more information about how Interledger works, see [IL-RFC 1: Interledger Architecture](https://github.com/interledger/rfcs/blob/master/0001-interledger-architecture/0001-interledger-architecture.md).

