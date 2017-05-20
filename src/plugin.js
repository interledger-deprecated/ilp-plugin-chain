'use strict'

const chain = require('chain-sdk')
const debug = require('debug')('ilp-plugin-chain')
const EventEmitter = require('eventemitter3')
const assert = require('assert')

const escrow = require('./escrow')

module.exports = class PluginChain extends EventEmitter {
  constructor (opts) {
    super()

    this._client = opts.client || new chain.Client()
    this._signer = opts.signer || new chain.HsmSigner()
    this._assetAlias = opts.assetAlias
    this._assetId = opts.assetId
    this._prefix = opts.chainCorePrefix + this._assetId + '.'
    this._accountAlias = opts.accountAlias
    this._accountId = opts.accountId
    this._address = opts.address || this._prefix + this._accountId

    this._receiver = null
    this._pubkey = null
  }

  async connect () {
    // TODO: make sure we can connect to the chain core
    debug('connect called')
    try {
      this._receiver = await this._createReceiver()
      this._pubkey = await this._createKey()
    } catch (err) {
      debug('error connecting to chain core:', err)
      throw new Error('Error connecting client: ' + err.message)
    }
    debug('connected')
    return
  }

  async disconnect () {
    // TODO: clean up if necessary
    return Promise.resolve()
  }

  isConnected () {
    return true
  }

  async _createKey () {
    // TODO make this work with the real HSM
    debug('creating new key')
    const key = await this._client.mockHsm.keys.create()
    this._signer.addKey(key.xpub, this._client.mockHsm.signerConnection)
    return key.xpub
  }

  async _createReceiver (alias) {
    debug('creating new receiver with alias: ', alias)
    try {
      const receiver = await this._client.accounts.createReceiver({
        accountId: this._accountId,
        alias: alias ? alias : undefined
      })
      debug('created new receiver with alias:', alias, receiver)
      return receiver
    } catch (err) {
      debug('error creating receiver', err)
      throw err
    }
  }

  getAccount () {
    assert(this.isConnected(), 'must be connected to getAccount')
    return this._prefix
      + this._pubkey
      + '.'
      + this._receiver.controlProgram
      + '.'
      + (new Date(this._receiver.expiresAt)).valueOf()
  }

  _parseAccount (address) {
    debug('parse address', address)
    const split = address.split('.')
    const length = split.length
    try {
      const parsed = {
        prefix: split.slice(0, length - 3).join('.') + '.',
        pubkey: split[length - 3],
        controlProgram: split[length - 2],
        expiresAt: (new Date(parseInt(split[length - 1]))).toISOString()
      }
      return parsed
    } catch (err) {
      debug(`error parsing address ${address}`, err)
      throw new Error(`Cannot understand 'to' address ${address} ${err.message}`)
    }
  }

  getInfo () {
    return {
      prefix: this._prefix,
      currencyScale: 0,
      currencyCode: this._assetAlias
    }
  }

  async getBalance () {
    debug(`requesting ${this._assetAlias} balance for account ${this._accountAlias}`)
    try {
      const queryPage = await this._client.unspentOutputs.query({
        filter: 'account_alias=$1 AND asset_alias=$2',
        filterParams: [this._accountAlias, this._assetAlias],
        pageSize: 100
      })
      // TODO: handle if this isn't the last page
      const utxos = queryPage.items
      const balance = utxos.reduce((balance, utxo) => {
        return balance + utxo.amount
      }, 0)
      return balance
    } catch (err) {
      debug('error getting balance', err)
      throw new Error('Error getting balance: ' + err.message)
    }
  }

  async getFulfillment (transferId) {
    // TODO
  }

  async sendTransfer (transfer) {
    debug('sendTransfer', JSON.stringify(transfer))
    const sourceProgram = (await this._createReceiver(transfer.id)).controlProgram
    debug('sourceProgram', sourceProgram)
    const destination = this._parseAccount(transfer.to)
    const escrowUtxo = await escrow.create({
      client: this._client,
      signer: this._signer,
      assetId: this._assetId,
      sourceAccountId: this._accountId,
      sourceProgram,
      destinationProgram: destination.controlProgram,
      destinationPubkey: destination.pubkey,
      destinationExpiresAt: destination.expiresAt,
      amount: transfer.amount,
      expiresAt: new Date(transfer.expiresAt),
      condition: transfer.executionCondition
    })
    debug('sent conditional transfer', escrowUtxo)
    return
  }

  async fulfillCondition (transferId, fulfillment) {
    // TODO
  }

  async rejectIncomingTransfer (transferId, rejectionReason) {
    // TODO
  }

  async sendMessage (message) {
    // TODO
  }
}
