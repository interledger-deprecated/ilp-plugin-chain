const chain = require('chain-sdk')
const moment = require('moment')

const client = new chain.Client()
const signer = new chain.HsmSigner()

const ESCROW_CONTRACT_SOURCE =
`contract Sha256HashlockTransfer(source: Program,
                destination: Program,
                source_key: PublicKey,
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
  clause timeout(sig: Signature) {
    verify after(expires_at)
    verify checkTxSig(source_key, sig)
    unlock value
  }
}`

const createLockingTx = (actions) => {
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

async function createEscrow ({
  sourceAccountId,
  sourceProgram,
  sourceKey,
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
      string: sourceKey
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

  const utxo = await createLockingTx(actions)
  return utxo
}

createEscrow({
  sourceAccountId: 'acc0WT9HZ9M00808',
  sourceProgram: '766baa20cbef1bd2822daa5e7ecc6f6c166eab613afa7328da43d10952541431f21dc4b45151ad696c00c0',
  sourceKey: 'abcd',
  destinationAccountId: 'acc0WT9HZ9HG0806',
  destinationProgram: '766baa209d4a124b801f32e631a910ff4983a4d069a76dd3e1f946e50cf0f5bdc020b19a5151ad696c00c0',
  destinationKey: 'abcd',
  amount: 13,
  assetId: '3d7e4af97c9635c048f72ee943e6bc2b9fcac763bf0f7d4035a076cfc40319ca',
  expiresAt: moment().add(1, 'days'),
  condition: '5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03'
})
  .then(escrowedTx => console.log(escrowedTx))
  .catch(err => console.log(err))

