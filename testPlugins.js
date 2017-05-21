const PluginChain = require('./src/plugin')
const crypto = require('crypto')
const moment = require('moment')
const uuid = require('uuid/v4')

function hash (fulfillment) {
  const h = crypto.createHash('sha256')
  h.update(Buffer.from(fulfillment, 'base64'))
  return h.digest()
}

const fulfillment = crypto.randomBytes(32).toString('base64')
const condition = hash(fulfillment).toString('base64')

async function runTest () {
  const sender = new PluginChain({
    accountAlias: 'Alice',
    accountId: 'acc0WT9HZ9M00808',
    assetAlias: 'Gold',
    assetId: '3d7e4af97c9635c048f72ee943e6bc2b9fcac763bf0f7d4035a076cfc40319ca',
    chainCorePrefix: 'test.chain.',
  })

  const receiver = new PluginChain({
    accountAlias: 'Bob',
    accountId: 'acc0WT9HZ9HG0806',
    assetAlias: 'Gold',
    assetId: '3d7e4af97c9635c048f72ee943e6bc2b9fcac763bf0f7d4035a076cfc40319ca',
    chainCorePrefix: 'test.chain.',
  })

  await sender.connect()
  console.log('sender connected')
  await receiver.connect()
  console.log('receiver connected')
  const balance = await sender.getBalance()
  console.log('balance', balance)

  const transfer = {
    id: uuid(),
    from: sender.getAccount(),
    to: receiver.getAccount(),
    ledger: sender.getInfo().prefix,
    amount: 10,
    ilp: 'blah',
    noteToSelf: {
      'just': 'some stuff'
    },
    executionCondition: condition,
    expiresAt: moment().add(10, 'seconds').toISOString(),
    custom: {
      'other': 'thing'
    }
  }

  const transferResult = await sender.sendTransfer(transfer)

  const fulfillResult = await receiver.fulfillCondition(transfer.id, fulfillment)
}

runTest().catch(err => console.log(err))
