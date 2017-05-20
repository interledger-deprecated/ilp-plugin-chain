const { createLockingTx, createUnlockingTx } = require('./chain-util')
const debug = require('debug')('ilp-plugin-chain:escrow')

const ESCROW_CONTRACT_SOURCE =
`contract Sha256HashlockTransfer(source: Program,
                destination: Program,
                destination_key: PublicKey,
                hash: Hash,
                expires_at: Time) locks value {
  clause fulfill(string: String) {
    verify before(expires_at)
    verify sha256(string) == hash
    lock value with destination
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
  destinationProgram,
  destinationPubkey,
  amount,
  assetId,
  expiresAt,
  condition
}) {
  debug(`create from ${sourceAccountId} (${sourceProgram}) to ${destinationProgram} for ${amount} of asset ${assetId}, condition: ${condition}, expiresAt: ${expiresAt}`)
  const compiled = await client.ivy.compile({
    contract: ESCROW_CONTRACT_SOURCE,
    args: [{
      string: sourceProgram
    }, {
      string: destinationProgram
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
      expiresAt: expiresAt.toISOString()
    }
  }]

  const utxo = await createLockingTx({
    client,
    signer,
    actions
  })
  return utxo
}

async function fulfill ({
  client,
  signer,
  fulfillment,
  escrowUtxo,
  expiresAt,
  destinationProgram
}) {
  const actions = [{
    type: 'spendUnspentOutput',
    outputId: escrowUtxo.id
  }, {
    type: 'controlWithReceiver',
    amount: escrowUtxo.amount,
    assetId: escrowUtxo.assetId,
    receiver: {
      expiresAt: expiresAt.toISOString(),
      controlProgram: destinationProgram
    }
  }]

  const witness = [{
    type: 'data',
    value: fulfillment
  }, {
    type: 'data', // fulfill clause
    value: '0000000000000000'
  }]

  const maxtimes = [
    expiresAt.toDate()
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
  sourceProgram,
  sourceReceiverExpiresAt,
  destinationKey
}) {
  const actions = [{
    type: 'spendUnspentOutput',
    outputId: escrowUtxo.id
  }, {
    type: 'controlWithReceiver',
    amount: escrowUtxo.amount,
    assetId: escrowUtxo.assetId,
    receiver: {
      expiresAt: sourceReceiverExpiresAt,
      controlProgram: sourceProgram
    }
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
  sourceProgram,
  sourceReceiverExpiresAt
}) {
  const actions = [{
    type: 'spendUnspentOutput',
    outputId: escrowUtxo.id
  }, {
    type: 'controlWithReceiver',
    amount: escrowUtxo.amount,
    assetId: escrowUtxo.assetId,
    receiver: {
      controlProgram: sourceProgram,
      expiresAt: sourceReceiverExpiresAt
    }
  }]

  const witness = [{
    type: 'data',
    value: '0200000000000000' // timeout clause
  }]
  const maxtimes = []
  const mintimes = [
    expiresAt.toDate()
  ]

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

exports.create = create
exports.fulfill = fulfill
exports.reject = reject
exports.timeout = timeout

