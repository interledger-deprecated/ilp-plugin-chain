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
    accountId: 'acc0WZ5E1PRG08CY',
    assetAlias: 'Gold',
    assetId: '0eb8ac24e6c8890469263b414aefc1303ab3f3aad04fcb1b9f7db77b5869a1ae',
    chainCorePrefix: 'test.chain.',
  })

  const receiver = new PluginChain({
    accountAlias: 'Bob',
    accountId: 'acc0WZ5E1PRG08CT',
    assetAlias: 'Gold',
    assetId: '0eb8ac24e6c8890469263b414aefc1303ab3f3aad04fcb1b9f7db77b5869a1ae',
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

  })

  const transferResult = await sender.sendTransfer(transfer)

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
