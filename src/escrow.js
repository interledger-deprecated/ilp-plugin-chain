const { createLockingTx, createUnlockingTx } = require('./chain-util')
const moment = require('moment')
const debug = require('debug')('ilp-plugin-chain:escrow')

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

async function create ({
  client,
  signer,
  sourceAccountId,
  sourceProgram,
  destinationPubkey,
  amount,
  assetId,
  expiresAt,
  condition,
  globalData
}) {
  debug(`create from ${sourceAccountId} (${sourceProgram}) to key ${destinationPubkey} for ${amount} of asset ${assetId}, condition: ${condition}, expiresAt: ${expiresAt}`)
  const compiled = await client.ivy.compile({
    contract: ESCROW_CONTRACT_SOURCE,
    args: [{
      string: sourceProgram
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
    referenceData: globalData
  }]

  const utxo = await createLockingTx({
    client,
    signer,
    actions,
    globalData
  })
  return utxo
}

async function fulfill ({
  client,
  signer,
  fulfillment,
  escrowUtxo,
  expiresAt,
  destinationKey,
  destinationReceiver
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
  sourceReceiver,
  destinationKey,
  globalData
}) {
  const actions = [{
    type: 'spendUnspentOutput',
    outputId: escrowUtxo.id
  }, {
    type: 'controlWithReceiver',
    amount: escrowUtxo.amount,
    assetId: escrowUtxo.assetId,
    receiver: sourceReceiver,
    referenceData: globalData
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
    maxtimes
  })
  return tx
}

async function timeout ({
  client,
  signer,
  escrowUtxo,
  expiresAt,
  sourceReceiver,
  globalData
}) {
  const actions = [{
    type: 'spendUnspentOutput',
    outputId: escrowUtxo.id
  }, {
    type: 'controlWithReceiver',
    amount: escrowUtxo.amount,
    assetId: escrowUtxo.assetId,
    receiver: sourceReceiver,
    referenceData: globalData
  }]

  const witness = [{
    type: 'data',
    value: '0200000000000000' // timeout clause
  }]
  const maxtimes = []
  const mintimes = [
    moment(expiresAt).toDate()
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

