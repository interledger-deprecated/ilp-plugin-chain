'use strict'

/**
 * This is a script to generate pubkeys for accounts.
 * The output of this script can be passed into the PluginChain
 * constructor to use a static key instead of creating a new one
 * when the plugin is connected.
 *
 * Usage:
 * node scripts/createPubkeyForAccount.js acc0X1RJTW1008Z0 acc0X1RJTVS008YW
 */

const chain = require('chain-sdk')

const client = new chain.Client()
const accounts = process.argv.slice(2)

async function createPubKeys (accounts) {
  for (let account of accounts) {
    const key = await client.accounts.createPubkey({
      accountId: account
    })
    console.log(JSON.stringify(key))
  }
}

createPubKeys(accounts).catch(err => console.log(err))

