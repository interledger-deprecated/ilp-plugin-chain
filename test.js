const chain = require('chain-sdk')
const moment = require('moment')
const crypto = require('crypto')
const { create, fulfill, reject, timeout } = require('./src/escrow')

function hash (preimage) {
  const h = crypto.createHash('sha256')
  h.update(Buffer.from(preimage, 'hex'))
  return h.digest()
}

const sourceAccountId = 'acc0WT9HZ9M00808'
const destinationAccountId = 'acc0WT9HZ9HG0806'
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
  const destinationKey = await destinationClient.mockHsm.keys.create()
  const destinationSigner = new chain.HsmSigner()
  destinationSigner.addKey(destinationKey.xpub, destinationClient.mockHsm.signerConnection)
  const destinationReceiver = await destinationClient.accounts.createReceiver({
    accountId: destinationAccountId
  })
  const destinationProgram = destinationReceiver.controlProgram
  console.log('destinationProgram', destinationProgram)

  // Fulfill

  const escrowUtxo = await create({
    client: sourceClient,
    signer: sourceSigner,
    sourceAccountId,
    sourceProgram,
    destinationAccountId,
    destinationProgram,
    destinationPubkey: destinationKey.xpub,
    amount: 1,
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

  // Timeout

  const earlyExpiry = moment().add(2, 'seconds')
  const escrowUtxo2 = await create({
    client: sourceClient,
    signer: sourceSigner,
    sourceAccountId,
    sourceProgram,
    destinationAccountId,
    destinationProgram,
    destinationPubkey: destinationKey.xpub,
    amount: 2,
    assetId,
    expiresAt: earlyExpiry,
    condition
  })

  console.log('created escrow utxo: ', escrowUtxo)

  await new Promise((resolve) => setTimeout(resolve, 2000))

  const timeoutTx = await timeout({
    client: sourceClient,
    signer: sourceSigner,
    escrowUtxo: escrowUtxo2,
    sourceProgram,
    sourceReceiverExpiresAt: sourceReceiver.expiresAt,
    expiresAt: earlyExpiry
  })

  console.log('expired tx:', timeoutTx)

  // Reject

  const escrowUtxo3 = await create({
    client: sourceClient,
    signer: sourceSigner,
    sourceAccountId,
    sourceProgram,
    destinationAccountId,
    destinationProgram,
    destinationPubkey: destinationKey.xpub,
    amount: 3,
    assetId,
    expiresAt,
    condition
  })

  console.log('created escrow utxo: ', escrowUtxo)

  const rejectTx = await reject({
    client: destinationClient,
    signer: destinationSigner,
    escrowUtxo: escrowUtxo3,
    sourceProgram,
    sourceReceiverExpiresAt: sourceReceiver.expiresAt,
    destinationKey
  })

  console.log('rejected tx:', rejectTx)
}

runTest().catch(err => console.log(err, JSON.stringify(err)))

