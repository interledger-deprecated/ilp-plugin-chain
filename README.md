# ilp-plugin-chain
> Interledger.js Ledger Plugin for [Chain Core](https://chain.com/)

<img src="./images/chain.png" alt="Chain Core" height="50px" />
&nbsp;
<img src="./images/plus.png" height="45" />
&nbsp;
<img src="./images/interledgerjs.png" alt="Interledger.js" height="50px" />

This plugin enables [Interledger](https://interledger.org) payments through [Chain Core](https://chain.com).

`ilp-plugin-chain` implements the [Interledger.js Ledger Plugin Interface](https://github.com/interledger/rfcs/blob/master/0004-ledger-plugin-interface/0004-ledger-plugin-interface.md), which allows Chain Core to be used with [`ilp` client](https://github.com/interledgerjs/ilp) and the [`ilp-connector`](https://github.com/interledgerjs/ilp-connector).

## Installation

**Dependencies:**

- Node.js >=v7.10.0
- [Chain Core Developer Edition with Ivy](https://github.com/chain/chain/tree/witness-args)
- `npm link` the [`chain-sdk`](https://github.com/chain/chain/tree/witness-args/sdk/node)

**Setup:**

```sh
git clone https://github.com/emschwartz/ilp-plugin-chain.git
cd ilp-plugin-chain
npm link chain-sdk
npm install
```

