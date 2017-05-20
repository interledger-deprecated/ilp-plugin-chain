const chain = require('chain-sdk')
const moment = require('moment')
const crypto = require('crypto')
const { createEscrow, fulfill } = require('./escrow')

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

