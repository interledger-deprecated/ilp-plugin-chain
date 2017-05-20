const chain = require('chain-sdk')
const moment = require('moment')
const crypto = require('crypto')

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

// createLockingTx and createUnlockingTx taken from https://github.com/chain/chain/blob/ivy/ivy/playground/core/index.tsx
  const createLockingTx = ({
    client,
    signer,
    actions
  }) => {
  return client.transactions.build(builder => {
    actions.forEach(action => {
      switch (action.type) {
        case "spendFromAccount":
          builder.spendFromAccount(action)
          break
        case "controlWithReceiver":
          builder.controlWithReceiver(action)
          break
        default:
          break
      }
    })
  }).then((tpl) => {
    tpl.signingInstructions.forEach((instruction) => {
      instruction.witnessComponents.forEach((component) => {
        component.keys.forEach((key) => {
          signer.addKey(key.xpub, client.mockHsm.signerConnection)
        })
      })
    })
    return signer.sign(tpl)
  }).then((tpl) => {
    return client.transactions.submit(tpl)
  }).then((tx) => {
    return client.unspentOutputs.query({"filter": "transaction_id=$1", "filterParams": [tx.id]})
  }).then((utxos) => {
    return utxos.items.find(utxo => utxo.purpose !== 'change')
  })
}

const createUnlockingTx = ({
  client,
  signer,
  actions,
  witness,
  mintimes,
  maxtimes
}) => {
    return client.transactions.build(builder => {
      actions.forEach(action => {
        switch (action.type) {
          case "spendFromAccount":
            builder.spendFromAccount(action)
            break
          case "controlWithReceiver":
            builder.controlWithReceiver(action)
            break
          case "controlWithAccount":
            builder.controlWithAccount(action)
            break
          case "spendUnspentOutput":
            builder.spendAnyUnspentOutput(action)
            break
          default:
            break
        }
      })

      if (mintimes.length > 0) {
        const findMax = (currMax, currVal) => {
          if (currVal.getTime() > currMax.getTime()) {
            return currVal
          }
          return currMax
        }
        const mintime = new Date(mintimes.reduce(findMax, mintimes[0]))
        builder.minTime = new Date(mintime.setSeconds(mintime.getSeconds() + 1))
      }

      if (maxtimes.length > 0) {
        const findMin = (currMin, currVal) => {
          if (currVal.getTime() < currMin.getTime()) {
            return currVal
          }
          return currMin
        }
        const maxtime = maxtimes.reduce(findMin, maxtimes[0])
        builder.maxTime = new Date(maxtime.setSeconds(maxtime.getSeconds() - 1))
      }
    }).then((tpl) => {
      tpl.includesContract = true
      // TODO(boymanjor): Can we depend on contract being on first utxo?
      tpl.signingInstructions[0].witnessComponents = witness
      tpl.signingInstructions.forEach((instruction, idx) => {
        instruction.witnessComponents.forEach((component) => {
          if (component.keys === undefined) {
            return
          }
          component.keys.forEach((key) => {
            signer.addKey(key.xpub, client.mockHsm.signerConnection)
          })
        })
      })
      return signer.sign(tpl)
    }).then((tpl) => {
      witness = tpl.signingInstructions[0].witnessComponents
      if (witness !== undefined) {
        tpl.signingInstructions[0].witnessComponents = witness.map(component => {
          switch(component.type) {
            case "raw_tx_signature":
              return {
                type: "data",
                value: component.signatures[0]
              }
            default:
              return component
          }
        })
      }
      return client.transactions.submit(tpl)
    })
  }

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

function hash (preimage) {
  const h = crypto.createHash('sha256')
  h.update(Buffer.from(preimage, 'hex'))
  return h.digest()
}

const sourceAccountId = 'acc0WT9HZ9M00808'
const destinationAccountId = 'acc0WT9HZ9HG0806'
const amount = 19
const assetId = '3d7e4af97c9635c048f72ee943e6bc2b9fcac763bf0f7d4035a076cfc40319ca'
const expiresAt = moment().add(1, 'days')
const fulfillment = crypto.randomBytes(32).toString('hex')
const condition = hash(fulfillment).toString('hex')

async function runTest () {
  const sourceClient = new chain.Client()
  const sourceSigner = new chain.HsmSigner()
  const sourceReceiver = await sourceClient.accounts.createReceiver({
    accountId: sourceAccountId
  })
  const sourceProgram = sourceReceiver.controlProgram
  console.log('sourceProgram', sourceProgram)

  const destinationClient = new chain.Client()
  const destinationKeys = await destinationClient.mockHsm.keys.create()
  const destinationSigner = new chain.HsmSigner()
  destinationSigner.addKey(destinationKeys.xpub, destinationClient.mockHsm.signerConnection)
  const destinationReceiver = await destinationClient.accounts.createReceiver({
    accountId: destinationAccountId
  })
  const destinationProgram = destinationReceiver.controlProgram
  console.log('destinationProgram', destinationProgram)

  const escrowUtxo = await createEscrow({
    client: sourceClient,
    signer: sourceSigner,
    sourceAccountId,
    sourceProgram,
    destinationAccountId,
    destinationProgram,
    destinationKey: destinationKeys.xpub,
    amount,
    assetId,
    expiresAt,
    condition
  })

  console.log('created escrow utxo: ', escrowUtxo)

  const fulfillTx = await fulfill({
    client: destinationClient,
    signer: destinationSigner,
    fulfillment,
    destinationProgram,
    expiresAt,
    escrowUtxo
  })

  console.log('fulfilled escrow with tx: ', fulfillTx)
}

runTest().catch(err => console.log(err, JSON.stringify(err)))

