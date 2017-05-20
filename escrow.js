const { createLockingTx, createUnlockingTx } = require('./chain-util')

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

async function createEscrow ({
  client,
  signer,
  sourceAccountId,
  sourceProgram,
  destinationAccountId,
  destinationProgram,
  destinationKey,
  amount,
  assetId,
  expiresAt,
  condition
}) {
  const compiled = await client.ivy.compile({
    contract: ESCROW_CONTRACT_SOURCE,
    args: [{
      string: sourceProgram
    }, {
      string: destinationProgram
    }, {
      string: destinationKey
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
    // don't know what this one is about
    type: 'data',
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

exports.createEscrow = createEscrow
exports.fulfill = fulfill

