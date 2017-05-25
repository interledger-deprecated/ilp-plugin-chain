const PluginChain = require('./src/plugin')
const crypto = require('crypto')
const moment = require('moment')
const uuid = require('uuid/v4')

const chain = require('chain-sdk')
const client = new chain.Client()
const signer = new chain.HsmSigner()

function hash (fulfillment) {
  const h = crypto.createHash('sha256')
  h.update(Buffer.from(fulfillment, 'base64'))
  return h.digest()
}

const fulfillment = crypto.randomBytes(32).toString('base64')
const condition = hash(fulfillment).toString('base64')
console.log('condition: ', condition, 'fulfillment:', fulfillment)

async function runTest () {
  const sender = new PluginChain({
    accountAlias: 'Alice',
    accountId: 'acc0X0T5TNT008KW',
    assetAlias: 'Gold',
    assetId: '5ae7151dfefd6c8ab0010745b921caf2ace001c0cd447c66e55e85e44b3cba25',
    chainCorePrefix: 'test.chain.',
  })

  const receiver = new PluginChain({
    accountAlias: 'Bob',
    accountId: 'acc0X0T5TNS008KT',
    assetAlias: 'Gold',
    assetId: '5ae7151dfefd6c8ab0010745b921caf2ace001c0cd447c66e55e85e44b3cba25',
    chainCorePrefix: 'test.chain.',
  })

  await sender.connect()
  console.log('sender connected')
  await receiver.connect()
  console.log('receiver connected')
  console.log('sender balance', await sender.getBalance())
  console.log('receiver balance', await receiver.getBalance())

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

  receiver.once('incoming_prepare', async function (transfer) {
    console.log('receiver got incoming prepare notification', transfer)
    console.log('sender balance', await sender.getBalance())
    console.log('receiver balance', await receiver.getBalance())

    try {
      await receiver.fulfillCondition(transfer.id, fulfillment)
    } catch (err) {
      console.log('error submitting fulfillment', err)
    }

    console.log('sender balance', await sender.getBalance())
    console.log('receiver balance', await receiver.getBalance())

    const fulfillmentResult = await sender.getFulfillment(transfer.id)
    console.log('got fulfillment', fulfillmentResult)
  })

  const transferResult = await sender.sendTransfer(transfer)

  await new Promise((resolve) => setTimeout(resolve, 500))

  // It will detect if you try to submit a duplicate transaction
  try {
    const transfer2 = await sender.sendTransfer(transfer)
  } catch (e) {
    console.log('avoided submitting duplicate transaction')
  }

  // Send a transfer that we'll let time out
  const otherTransfer = await sender.sendTransfer(Object.assign({}, transfer, {
    id: uuid()
  }))
}

runTest().catch(err => console.log(err))
