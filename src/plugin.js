'use strict'

const chain = require('chain-sdk')
const debug = require('debug')('ilp-plugin-chain')
const EventEmitter = require('eventemitter3')
const assert = require('assert')
const moment = require('moment')

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

    this._connected = false
    this._receiver = null
    this._key = null
    this._expiryWatchers = {}
  }

  async _handleNotification (tx) {
    // TODO is some trick someone can play with multiple outputs?
    for (let output of tx.outputs) {
      // TODO how do we verify the controlProgram used?
      // TODO what's the right way to determine which output is a) for us and b) related to ilp?
      if (output.referenceData && output.referenceData.destinationPubkey && output.referenceData.destinationPubkey === this._key.pubkey) {
        // check that the incoming transfer is locked with the right control program
        await escrow.verify({
          utxo: output,
          client: this._client,
          sourceReceiver: output.referenceData.sourceReceiver,
          destinationPubkey: this._key.pubkey,
          amount: output.amount,
          assetId: output.assetId,
          // TODO decide on which part of the codebase is dealing with which date format
          expiresAt: moment(output.referenceData.expiresAt).valueOf(),
          condition: Buffer.from(output.referenceData.executionCondition, 'base64').toString('hex')
        })
        // TODO check that all the referenceData we expect is there
        const transfer = {
          id: output.referenceData.id,
          amount: output.amount,
          ledger: this._prefix,
          // TODO need a field that the sender cannot forge
          from: this._prefix + output.referenceData.sourcePubkey,
          to: this.getAccount(),
          executionCondition: output.referenceData.executionCondition,
          ilp: output.referenceData.ilp,
          custom: output.referenceData.custom,
          expiresAt: output.referenceData.expiresAt
        }
        debug('emitting incoming_prepare', transfer)
        try {
          this.emit('incoming_prepare', transfer)
        } catch (err) {
          console.error('error in event handler', err)
        }
      }
    }
  }

  async _listenForNotifications () {
    debug(`subscribing to transactionFeed for asset: ${this._assetId} pubkey: ${this._key.pubkey}`)

    const feed = await this._client.transactionFeeds.create({
      alias: this._key.pubkey,
      filter: `outputs(asset_id='${this._assetId}' AND reference_data.destinationPubkey='${this._key.pubkey}')`
    })

    const processingLoop = (tx, next, done, fail) => {
      // TODO handle errors
      this._handleNotification(tx)
        .then(() => next(true))
        .catch(err => debug('error processing notification', err))
    }
    feed.consume(processingLoop)
  }

  async connect () {
    // TODO make sure we reclaim all the previous escrows that expired
    debug('connect called')
    try {
      this._receiver = await this._createReceiver()
      this._key = await this._createKey()
      await this._listenForNotifications()
    } catch (err) {
      debug('error connecting to chain core:', err)
      throw new Error('Error connecting client: ' + err.message)
    }
    this._connected = true
    debug('connected')
    return
  }

  async disconnect () {
    // TODO: clean up if necessary
    await this._feed.delete({
      alias: this._key.pubkey
    })
  }

  isConnected () {
    return true
  }

  async _createKey () {
    // TODO make this work with the real HSM
    debug('creating new key')
    const key = await this._client.accounts.createPubkey({
      accountId: this._accountId
    })
    // rename fields to make them work with other parts of the chain SDK
    this._signer.addKey(key.rootXpub, this._client.mockHsm.signerConnection)
    debug('created key', key)
    return key
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
      + this._key.pubkey
  }

  _parseAccount (address) {
    debug('parse address', address)
    const split = address.split('.')
    const length = split.length
    try {
      const parsed = {
        prefix: split.slice(0, length - 2).join('.') + '.',
        pubkey: split[length - 1]
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
        filter: 'account_id=$1 AND asset_id=$2',
        filterParams: [this._accountId, this._assetId],
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

  async _getTransfer (transferId) {
    debug('_getTransfer', transferId)
    try {
      const queryPage = await this._client.unspentOutputs.query({
        filter: 'asset_id=$1 AND reference_data.id=$2',
        filterParams: [this._assetId, transferId],
        pageSize: 100
      })
      const utxos = queryPage.items
      // TODO there should only be one item, handle the case where there are more
      return utxos[0]
    } catch (err) {
      debug(`error getting transfer ${transferId}`, err)
      throw err
    }
  }

  async _expireTransfer (escrowUtxo) {
    debug('attempting to expire transfer:', escrowUtxo.referenceData.id)
    // TODO handle if the transfer is already fulfilled
    try {
      await escrow.timeout({
        client: this._client,
        signer: this._signer,
        escrowUtxo
      })
    } catch (err) {
      debug('error expiring transfer:' + escrowUtxo.referenceData.id, JSON.stringify(err))
    }
  }

  async sendTransfer (transfer) {
    // TODO ensure transfer id is unique
    debug('sendTransfer', JSON.stringify(transfer))
    const sourceReceiver = await this._createReceiver(transfer.id)
    const destination = this._parseAccount(transfer.to)
    const escrowUtxo = await escrow.create({
      client: this._client,
      signer: this._signer,
      assetId: this._assetId,
      sourceAccountId: this._accountId,
      sourceReceiver,
      destinationPubkey: destination.pubkey,
      amount: transfer.amount,
      expiresAt: new Date(transfer.expiresAt),
      condition: Buffer.from(transfer.executionCondition, 'base64').toString('hex'),
      utxoData: {
        // TODO minimize the data sent here
        id: transfer.id,
        sourcePubkey: this._key.pubkey,
        destinationPubkey: destination.pubkey,
        ilp: transfer.ilp,
        executionCondition: transfer.executionCondition,
        expiresAt: transfer.expiresAt,
        custom: transfer.custom,
        // TODO can this be put into "local" data?
        noteToSelf: transfer.noteToSelf
      }
    })
    debug(`sent conditional transfer ${transfer.id}, utxo: ${escrowUtxo.id}`)

    // Start timer for when transfer expires
    const expiryWatcher = setTimeout(() => {
      this._expireTransfer(escrowUtxo)
      delete this._expiryWatchers[transfer.id]
    }, moment(transfer.expiresAt).diff(moment()) + 1000) // expire it after the real expiresAt in case chain's clock is different
    this._expiryWatchers[transfer.id] = expiryWatcher

    return null
  }

  async fulfillCondition (transferId, fulfillment) {
    debug(`fulfillCondition for transfer ${transferId} with ${fulfillment}`)
    // TODO check if the transfer is already fulfilled
    const escrowUtxo = await this._getTransfer(transferId)
    if (!escrowUtxo) {
      // TODO make this a proper ledger plugin error
      throw new Error(`Transfer not found: ${tranfserId}`)
    }
    const destinationReceiver = await this._createReceiver(transferId)
    try {
      const fulfillTx = await escrow.fulfill({
        client: this._client,
        signer: this._signer,
        fulfillment: Buffer.from(fulfillment, 'base64').toString('hex'),
        expiresAt: escrowUtxo.referenceData.expiresAt,
        destinationKey: {
          xpub: this._key.rootXpub,
          derivationPath: this._key.pubkeyDerivationPath
        },
        destinationReceiver,
        escrowUtxo
      })
      debug(`fulfilled transfer ${transferId}`, fulfillTx)
      return null
    } catch (err) {
      debug(`error fulfilling transfer ${transferId}`, err)
      throw err
    }
  }

  async rejectIncomingTransfer (transferId, rejectionReason) {
    debug('rejectIncomingTransfer', transferId, rejectionReason)
    const escrowUtxo = await this._getTransfer(transferId)
    debug('fetched utxo:', escrowUtxo)
    if (!escrowUtxo) {
      // TODO make this a proper ledger plugin error
      throw new Error(`Transfer not found: ${tranfserId}`)
    }
    try {
      const rejectTx = await escrow.reject({
        client: this._client,
        signer: this._signer,
        destinationKey: {
          xpub: this._key.rootXpub,
          derivationPath: this._key.pubkeyDerivationPath
        },
        escrowUtxo,
        globalData: {
          rejectionReason
        }
      })
      debug(`rejected transfer ${transferId}`, fulfillTx)
      return null
    } catch (err) {
      debug(`error rejecting transfer ${transferId}`, err)
      throw err
    }
  }

  async sendMessage (message) {
    // TODO
  }
}
