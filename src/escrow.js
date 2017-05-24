const { createLockingTx, createUnlockingTx } = require('./chain-util')
const moment = require('moment')
const debug = require('debug')('ilp-plugin-chain:escrow')
const assert = require('assert')

const ESCROW_CONTRACT_SOURCE =
  `contract InterledgerTransfer(source: Program,
                    destination_key: PublicKey,
                    condition: Hash,
                    expires_at: Time) locks value {
      clause fulfill(fulfillment: String, sig: Signature) {
        verify before(expires_at)
        verify sha256(fulfillment) == condition
        verify checkTxSig(destination_key, sig)
        unlock value
      }
      clause reject(sig: Signature) {
        verify checkTxSig(destination_key, sig)
        lock value with source
      }
      clause timeout() {
        verify after(expires_at)
        lock value with source
      }
    }`

async function verify ({
  client,
  sourceReceiver,
  destinationPubkey,
  amount,
  assetId,
  expiresAt,
  condition,
  utxo
}) {
  debug('check utxo against params', utxo, { sourceReceiver, destinationPubkey, amount, assetId, expiresAt, condition })
  let compiled
  try {
    compiled = await client.ivy.compile({
      contract: ESCROW_CONTRACT_SOURCE,
      args: [{
        string: sourceReceiver.controlProgram
      }, {
        string: destinationPubkey
      }, {
        string: condition
      }, {
        integer: expiresAt.valueOf()
      }]
    })
  } catch (err) {
    debug('error reconstructing escrow contract', err)
    throw err
  }
  const controlProgram = compiled.program
  debug('recompiled contract', controlProgram)
  assert(utxo.controlProgram === controlProgram, 'escrow contract is not an interledger transfer or has the wrong parameters')
  assert(moment().isBefore(expiresAt), 'escrow has already expired')
  debug('verified that control program matches what we expect')
  // TODO do we need to check the expiry of the control program?
}

async function create ({
  client,
  signer,
  sourceAccountId,
  sourceReceiver,
  destinationPubkey,
  amount,
  assetId,
  expiresAt,
  condition,
  transactionData,
  utxoData
}) {
  debug(`create from ${sourceAccountId} to key ${destinationPubkey} for ${amount} of asset ${assetId}, condition: ${condition}, expiresAt: ${expiresAt}`)
  const compiled = await client.ivy.compile({
    contract: ESCROW_CONTRACT_SOURCE,
    args: [{
      string: sourceReceiver.controlProgram
    }, {
      string: destinationPubkey
    }, {
      string: condition
    }, {
      integer: expiresAt.valueOf()
    }]
  })
  const controlProgram = compiled.program

  const actions = [{
    type: 'spendFromAccount',
    accountId: sourceAccountId,
    amount,
    assetId
  }, {
    type: 'controlWithReceiver',
    amount,
    assetId,
    receiver: {
      controlProgram,
      expiresAt: moment(expiresAt).toISOString()
    },
    referenceData: Object.assign({
      sourceReceiver: sourceReceiver
    }, utxoData)
  }]

  const utxo = await createLockingTx({
    client,
    signer,
    actions,
    transactionData
  })
  return utxo
}

async function fulfill ({
  client,
  signer,
  fulfillment,
  escrowUtxo,
  destinationKey,
  destinationReceiver,
  expiresAt
}) {
  const actions = [{
    type: 'spendUnspentOutput',
    outputId: escrowUtxo.id
  }, {
    type: 'controlWithReceiver',
    amount: escrowUtxo.amount,
    assetId: escrowUtxo.assetId,
    receiver: destinationReceiver
  }]

  const witness = [{
    type: 'data',
    value: fulfillment
  }, {
    type: 'raw_tx_signature',
    keys: [
      destinationKey
    ],
    quorum: 1,
    signatures: []
  }, {
    type: 'data', // fulfill clause
    value: '0000000000000000'
  }]

  const maxtimes = [
    moment(expiresAt).toDate()
  ]
  const mintimes = []

  const tx = await createUnlockingTx({
    client,
    signer,
    actions,
    witness,
    mintimes,
    maxtimes
  })
  return tx
}

async function reject ({
  client,
  signer,
  escrowUtxo,
  destinationKey,
  utxoData,
  transactionData
}) {
  const actions = [{
    type: 'spendUnspentOutput',
    outputId: escrowUtxo.id
  }, {
    type: 'controlWithReceiver',
    amount: escrowUtxo.amount,
    assetId: escrowUtxo.assetId,
    receiver: escrowUtxo.referenceData.sourceReceiver,
    referenceData: utxoData
  }]

  const witness = [{
    type: 'raw_tx_signature',
    keys: [
      destinationKey
    ],
    quorum: 1,
    signatures: []
  }, {
    type: 'data',
    value: '0100000000000000' // reject clause
  }]

  const maxtimes = []
  const mintimes = []

  const tx = await createUnlockingTx({
    client,
    signer,
    actions,
    witness,
    mintimes,
    maxtimes,
    transactionData
  })
  return tx
}

async function timeout ({
  client,
  signer,
  escrowUtxo,
  globalData
}) {
  const actions = [{
    type: 'spendUnspentOutput',
    outputId: escrowUtxo.id
  }, {
    type: 'controlWithReceiver',
    amount: escrowUtxo.amount,
    assetId: escrowUtxo.assetId,
    receiver: escrowUtxo.referenceData.sourceReceiver,
    referenceData: globalData
  }]

  const witness = [{
    type: 'data',
    value: '0200000000000000' // timeout clause
  }]
  const maxtimes = []
  const mintimes = [
    new Date(escrowUtxo.referenceData.expiresAt)
  ]

  const tx = await createUnlockingTx({
    client,
    signer,
    actions,
    witness,
    mintimes,
    maxtimes,
    globalData
  })
  return tx
}

exports.create = create
exports.fulfill = fulfill
exports.reject = reject
exports.timeout = timeout
exports.verify = verify

